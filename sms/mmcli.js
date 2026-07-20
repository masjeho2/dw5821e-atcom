/**
 * SMS via ModemManager (mmcli) — same approach as OpenWrt modem_sms.sh
 * Uses: mmcli --messaging-list-sms + mmcli -s <id> -K
 */
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

async function run(cmd, timeout = 10000) {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout });
    return (stdout || stderr || '').trim();
  } catch (err) {
    return (err.stdout || err.stderr || err.message || '').toString().trim();
  }
}

async function getModemIndex() {
  const list = await run('mmcli -L 2>/dev/null');
  const m = list.match(/Modem\/(\d+)/);
  return m ? m[1] : null;
}

/** Parse mmcli -K key:value output (OpenWrt style) */
function parseKeyValue(raw) {
  const info = {};
  for (const line of String(raw || '').split('\n')) {
    const m = line.match(/^([^\s:]+)\s*:\s*(.*)$/);
    if (m) info[m[1].trim()] = m[2].trim();
  }
  return info;
}

/** Fallback parse pretty mmcli table output */
function parsePretty(raw) {
  const info = {};
  for (const line of String(raw || '').split('\n')) {
    const m = line.match(/\|\s+([\w\s\/()-]+)\s*:\s+(.+)/);
    if (m) info[m[1].trim()] = m[2].trim();
  }
  return info;
}

function toMessage(path, info) {
  return {
    source: 'mmcli',
    path,
    index: String(path).split('/').pop(),
    number: info['sms.content.number'] || info.number || '',
    text: info['sms.content.text'] || info.text || '',
    timestamp: info['sms.properties.timestamp'] || info.timestamp || info.date || '',
    state: info['sms.properties.state'] || info.state || 'unknown',
    storage: info['sms.properties.storage'] || info.storage || 'unknown',
    smsc: info['sms.properties.smsc'] || info.smsc || '',
    pduType: info['sms.properties.pdu-type'] || info['pdu type'] || ''
  };
}

async function listPaths() {
  const idx = await getModemIndex();
  if (!idx) return { idx: null, paths: [] };
  const listRaw = await run(`mmcli -m ${idx} --messaging-list-sms 2>/dev/null`);
  if (!listRaw || /No sms/i.test(listRaw)) return { idx, paths: [] };

  const paths = listRaw.split('\n')
    .map((l) => l.trim().split(/\s+/)[0])
    .filter((p) => p.includes('/org/freedesktop/ModemManager1/SMS/'));
  return { idx, paths };
}

async function readOne(pathOrId) {
  // OpenWrt uses: mmcli -s <id> -K
  const id = String(pathOrId).includes('/')
    ? String(pathOrId).split('/').pop()
    : String(pathOrId);
  const path = String(pathOrId).startsWith('/org/')
    ? String(pathOrId)
    : `/org/freedesktop/ModemManager1/SMS/${id}`;

  let raw = await run(`mmcli -s ${id} -K 2>/dev/null`);
  let info = parseKeyValue(raw);
  if (!info['sms.content.text'] && !info['sms.content.number']) {
    raw = await run(`mmcli -s ${path} 2>/dev/null`);
    info = parsePretty(raw);
  }
  if (!info['sms.content.text'] && !info.text && !info.number && !info['sms.content.number']) {
    return null;
  }
  return toMessage(path, info);
}

async function listMessages() {
  const { paths } = await listPaths();
  const messages = [];
  for (const p of paths) {
    const msg = await readOne(p);
    if (msg && (msg.text || msg.number)) messages.push(msg);
  }
  return messages;
}

async function deleteOne(idOrPath) {
  const idx = await getModemIndex();
  if (!idx) return { success: false, error: 'No modem' };
  let path = String(idOrPath || '');
  if (!path.startsWith('/org/')) {
    path = `/org/freedesktop/ModemManager1/SMS/${path}`;
  }
  const result = await run(`mmcli -m ${idx} --messaging-delete-sms=${path} 2>&1`);
  return {
    success: /successfully deleted|success/i.test(result),
    message: result,
    path
  };
}

async function deleteAll() {
  const { idx, paths } = await listPaths();
  if (!idx) return { success: false, error: 'No modem' };
  if (!paths.length) return { success: true, deleted: 0, message: 'No SMS' };
  let deleted = 0;
  for (const p of paths) {
    const r = await run(`mmcli -m ${idx} --messaging-delete-sms=${p} 2>&1`);
    if (/successfully deleted|success/i.test(r)) deleted++;
  }
  return { success: true, deleted, message: `Deleted ${deleted} SMS` };
}

async function send(number, text) {
  const idx = await getModemIndex();
  if (!idx) return { success: false, error: 'No modem' };
  if (!number || !text) return { success: false, error: 'number and text required' };

  const num = String(number).replace(/'/g, `'\\''`);
  const msg = String(text).replace(/'/g, `'\\''`);
  const create = await run(
    `mmcli -m ${idx} --messaging-create-sms="number='${num}',text='${msg}'" 2>&1`,
    15000
  );
  const pathMatch = create.match(/\/org\/freedesktop\/ModemManager1\/SMS\/\d+/);
  if (!pathMatch) return { success: false, error: create || 'Failed to create SMS' };

  const smsPath = pathMatch[0];
  const sendOut = await run(`mmcli -s ${smsPath} --send 2>&1`, 20000);
  await run(`mmcli -m ${idx} --messaging-delete-sms=${smsPath} 2>/dev/null`);
  return {
    success: /successfully sent/i.test(sendOut),
    message: sendOut,
    path: smsPath
  };
}

module.exports = {
  getModemIndex,
  listPaths,
  readOne,
  listMessages,
  deleteOne,
  deleteAll,
  send
};

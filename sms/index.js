/**
 * SMS facade — wires mmcli / AT / local history modules
 * Keep server.js thin: only call these exports.
 */
const mmcli = require('./mmcli');
const at = require('./at');
const history = require('./history');

/**
 * @param {(cmd:string, timeout?:number)=>Promise<string>} execAT
 */
async function listInbox(execAT, opts = {}) {
  const includeHistory = opts.includeHistory !== false;
  const live = [];

  // 1) ModemManager live list (primary on DW5821e / OpenWrt style)
  try {
    const mm = await mmcli.listMessages();
    live.push(...mm);
  } catch (_) {}

  // 2) AT storage secondary
  try {
    const atMsgs = await at.listMessages(execAT);
    live.push(...atMsgs);
  } catch (_) {}

  // 3) Persist + merge with local history so UI can show more than "current 1"
  let messages = includeHistory ? history.mergeLive(live) : live;

  // de-dupe display list by key/number+text+timestamp
  const seen = new Set();
  messages = messages.filter((m) => {
    const k = m.key || history.msgKey(m);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  messages.sort((a, b) => {
    const ta = a.timestamp || a.lastSeenAt || '';
    const tb = b.timestamp || b.lastSeenAt || '';
    return String(tb).localeCompare(String(ta));
  });

  return {
    success: true,
    count: messages.length,
    liveCount: live.length,
    messages,
    sources: {
      mmcli: live.filter((m) => m.source === 'mmcli').length,
      at: live.filter((m) => m.source === 'at').length,
      history: includeHistory
    }
  };
}

/**
 * @param {(cmd:string, timeout?:number)=>Promise<string>} execAT
 */
async function getStorage(execAT) {
  return at.getStorage(execAT);
}

/**
 * @param {(cmd:string, timeout?:number)=>Promise<string>} execAT
 */
async function setupReception(execAT) {
  return at.setupReception(execAT);
}

async function deleteSms(idOrPath) {
  // Try mmcli delete first
  const mm = await mmcli.deleteOne(idOrPath);
  // Always remove from local history too
  history.removeByKeyOrId(idOrPath);
  if (idOrPath) {
    // also try index form
    const idx = String(idOrPath).split('/').pop();
    history.removeByKeyOrId(idx);
  }
  return mm.success ? mm : { ...mm, historyCleaned: true };
}

async function deleteAll(execAT) {
  const mm = await mmcli.deleteAll();
  // clear local history as well (inbox delete-all intent)
  history.clear();
  // optional AT wipe of all (flag 4 = all) — best effort
  try {
    if (execAT) await execAT('AT+CMGD=1,4', 5000);
  } catch (_) {}
  return {
    success: true,
    deleted: mm.deleted || 0,
    message: `${mm.message || 'MM cleared'}; local history cleared`
  };
}

async function sendSms(number, text) {
  return mmcli.send(number, text);
}

function listHistoryOnly() {
  return {
    success: true,
    count: history.list().length,
    messages: history.list()
  };
}

function clearHistory() {
  return history.clear();
}

module.exports = {
  listInbox,
  getStorage,
  setupReception,
  deleteSms,
  deleteAll,
  sendSms,
  listHistoryOnly,
  clearHistory,
  // expose submodules if needed later
  mmcli,
  at,
  history
};

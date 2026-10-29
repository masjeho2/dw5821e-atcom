/**
 * SMS via AT commands (OpenWrt-compatible setup)
 * Key commands from DW5821e OpenWrt manager:
 *   AT+CMGF=1
 *   AT+CPMS="ME","ME","ME" or "SM","SM","SM"
 *   AT+CNMI=2,1,0,0,0
 *   AT+CMGL="ALL"
 */

/**
 * Some DW5821e firmwares return the SMS body as a hex dump instead of text
 * (common with operator class-0 / 8-bit data SMS, even in CMGF=1 mode).
 * Detect strict-hex bodies and decode: UCS-2BE if high bytes are mostly 0x00,
 * else plain ASCII/UTF-8.
 */
function decodeHexBody(text) {
  const clean = String(text || '').replace(/\s+/g, '');
  if (clean.length < 16 || clean.length % 2 !== 0 || !/^[0-9A-Fa-f]+$/.test(clean)) {
    return null;
  }
  const buf = Buffer.from(clean, 'hex');

  let zeroHigh = 0;
  for (let i = 0; i < buf.length; i += 2) {
    if (buf[i] === 0) zeroHigh++;
  }

  let decoded;
  if (zeroHigh >= buf.length / 6) {
    // UCS-2BE: pairs of (00, char)
    let s = '';
    for (let i = 0; i + 1 < buf.length; i += 2) {
      s += String.fromCharCode((buf[i] << 8) | buf[i + 1]);
    }
    decoded = s;
  } else {
    decoded = buf.toString('utf8');
  }

  // Sanity check: decoded must be mostly printable, else it wasn't hex text
  let printable = 0;
  for (const ch of decoded) {
    const c = ch.codePointAt(0);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127)) printable++;
  }
  return printable / decoded.length >= 0.9 ? decoded : null;
}

function parseCmgl(raw) {
  if (!raw || raw === 'OK' || /ERROR/i.test(raw)) return [];
  const list = [];
  const lines = String(raw).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    // +CMGL: idx,"STAT","number",,"timestamp"
    const m = lines[i].match(/\+CMGL:\s*(\d+),"([^"]*)","([^"]*)",?,"?([^"]*)"?/);
    if (!m) continue;

    // body may span multiple lines until next +CMGL / OK / ERROR
    const bodyLines = [];
    let j = i + 1;
    while (j < lines.length) {
      const l = lines[j];
      if (/^\+CMGL:/.test(l) || /^OK\s*$/.test(l) || /^ERROR\s*$/.test(l)) break;
      bodyLines.push(l);
      j++;
    }
    const body = bodyLines.join('\n').trim();
    const decoded = decodeHexBody(body);
    list.push({
      source: 'at',
      path: null,
      index: m[1],
      number: m[3],
      text: decoded || body,
      timestamp: m[4] || '',
      state: m[2] || 'unknown',
      storage: 'at',
      encoded: decoded ? 'hex' : 'text'
    });
    i = j - 1;
  }
  return list;
}

/**
 * Setup SMS reception like OpenWrt init:
 * text mode + preferred storage + new-message indications
 * @param {(cmd:string, timeout?:number)=>Promise<string>} execAT
 */
async function setupReception(execAT) {
  const steps = [];
  const runStep = async (cmd, timeout = 4000) => {
    const response = await execAT(cmd, timeout);
    const ok = response && !/ERROR/i.test(response);
    steps.push({ cmd, ok, response: String(response || '').slice(0, 200) });
    return response;
  };

  await runStep('AT+CMGF=1');
  // Prefer ME (modem) first — DW5821e often stores here via MM
  await runStep('AT+CPMS="ME","ME","ME"');
  // Enable unsolicited new message indications (OpenWrt uses 2,1,0,0,0)
  await runStep('AT+CNMI=2,1,0,0,0');

  const cnmi = await runStep('AT+CNMI?');
  const cpms = await runStep('AT+CPMS?');
  return {
    success: steps.some((s) => s.ok),
    steps,
    cnmi,
    cpms
  };
}

/**
 * @param {(cmd:string, timeout?:number)=>Promise<string>} execAT
 */
async function listMessages(execAT) {
  await execAT('AT+CMGF=1', 3000);
  // Try ALL first
  let raw = await execAT('AT+CMGL="ALL"', 8000);
  let list = parseCmgl(raw);
  if (!list.length) {
    // Some firmwares want numeric status
    raw = await execAT('AT+CMGL=4', 8000);
    list = parseCmgl(raw);
  }
  return list;
}

/**
 * @param {(cmd:string, timeout?:number)=>Promise<string>} execAT
 */
async function getStorage(execAT) {
  await execAT('AT+CMGF=1', 3000);
  const raw = await execAT('AT+CPMS?', 4000);
  const m = raw && raw.match(/\+CPMS:\s*"(\w+)",(\d+),(\d+)/);
  if (m) {
    return {
      success: true,
      storage: m[1],
      used: parseInt(m[2], 10),
      total: parseInt(m[3], 10),
      raw
    };
  }
  return { success: true, raw: raw || null };
}

/**
 * @param {(cmd:string, timeout?:number)=>Promise<string>} execAT
 */
async function deleteByIndex(execAT, index) {
  const raw = await execAT(`AT+CMGD=${parseInt(index, 10)}`, 4000);
  return {
    success: raw && /OK/i.test(raw) && !/ERROR/i.test(raw),
    message: raw
  };
}

module.exports = {
  decodeHexBody,
  parseCmgl,
  setupReception,
  listMessages,
  getStorage,
  deleteByIndex
};

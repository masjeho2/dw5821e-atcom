/**
 * Local SMS history store
 * ModemManager often only keeps "live" messages (sometimes 1 item).
 * We persist every seen SMS so Inbox can show more than current MM list.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'sms');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const MAX_ITEMS = 500;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function msgKey(m) {
  // stable-ish key for de-dupe
  const base = [
    m.number || '',
    m.text || '',
    m.timestamp || '',
    m.path || m.index || ''
  ].join('|');
  return crypto.createHash('sha1').update(base).digest('hex').slice(0, 16);
}

function load() {
  try {
    ensureDir();
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    return Array.isArray(data.messages) ? data.messages : [];
  } catch {
    return [];
  }
}

function save(messages) {
  ensureDir();
  const trimmed = messages.slice(0, MAX_ITEMS);
  fs.writeFileSync(
    HISTORY_FILE,
    JSON.stringify({ updatedAt: new Date().toISOString(), messages: trimmed }, null, 2)
  );
  return trimmed;
}

/**
 * Merge live modem messages into local history.
 * Returns full history (newest first).
 */
function mergeLive(liveMessages) {
  const history = load();
  const byKey = new Map(history.map((m) => [m.key || msgKey(m), m]));

  for (const live of liveMessages || []) {
    const key = msgKey(live);
    const prev = byKey.get(key);
    byKey.set(key, {
      ...prev,
      ...live,
      key,
      firstSeenAt: prev?.firstSeenAt || new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    });
  }

  const merged = Array.from(byKey.values());
  merged.sort((a, b) => {
    const ta = a.timestamp || a.lastSeenAt || a.firstSeenAt || '';
    const tb = b.timestamp || b.lastSeenAt || b.firstSeenAt || '';
    return String(tb).localeCompare(String(ta));
  });
  return save(merged);
}

function removeByKeyOrId(id) {
  const history = load();
  const next = history.filter((m) => {
    if (!id) return true;
    const s = String(id);
    return m.key !== s && m.path !== s && String(m.index) !== s;
  });
  save(next);
  return { success: true, removed: history.length - next.length };
}

function clear() {
  save([]);
  return { success: true };
}

function list() {
  return load();
}

module.exports = {
  load,
  save,
  mergeLive,
  removeByKeyOrId,
  clear,
  list,
  msgKey,
  HISTORY_FILE
};

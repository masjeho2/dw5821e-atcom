const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const crypto = require('crypto');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const app = express();
const PORT = process.env.PORT || 3100;
const HOST = process.env.HOST || '0.0.0.0';
const PASSWORD = (process.env.AUTH_PASSWORD || 'admin123').trim();
const AT_PORT_DEFAULT = process.env.AT_PORT || '/dev/ttyUSB1';
let currentPort = AT_PORT_DEFAULT;
const AVAILABLE_PORTS = ['/dev/ttyUSB0', '/dev/ttyUSB1'];

// Persistent session store (survives pm2 restart)
const SESSION_FILE = path.join(__dirname, 'data', 'sessions.json');
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours
const sessions = new Map();

function loadSessions() {
  try {
    if (!fs.existsSync(SESSION_FILE)) return;
    const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    const now = Date.now();
    for (const [token, session] of Object.entries(data)) {
      if (now - session.created < SESSION_TTL) {
        sessions.set(token, session);
      }
    }
  } catch (e) {
    console.log('[AUTH] Failed to load sessions:', e.message);
  }
}

function saveSessions() {
  try {
    const dir = path.dirname(SESSION_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const obj = {};
    for (const [token, session] of sessions.entries()) {
      obj[token] = session;
    }
    fs.writeFileSync(SESSION_FILE, JSON.stringify(obj));
  } catch (e) {
    console.log('[AUTH] Failed to save sessions:', e.message);
  }
}

loadSessions();

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { created: Date.now() });
  saveSessions();
  return token;
}

function deleteSession(token) {
  if (token && sessions.has(token)) {
    sessions.delete(token);
    saveSessions();
  }
}

function isValidSession(token) {
  if (!token || !sessions.has(token)) return false;
  const session = sessions.get(token);
  if (Date.now() - session.created >= SESSION_TTL) {
    deleteSession(token);
    return false;
  }
  return true;
}

function getTokenFromReq(req) {
  const cookie = req.headers.cookie || '';
  const tokenMatch = cookie.match(/(?:^|;\s*)token=([^;]+)/);
  return tokenMatch ? tokenMatch[1] : (req.headers['x-auth-token'] || null);
}

function authMiddleware(req, res, next) {
  // Skip auth for login assets and login API
  const publicPaths = ['/login.html', '/api/login', '/css/login.css'];
  if (publicPaths.includes(req.path) || req.path.startsWith('/js/login')) {
    return next();
  }

  const token = getTokenFromReq(req);
  if (isValidSession(token)) {
    return next();
  }

  // API requests get 401
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Redirect to login
  res.redirect('/login.html');
}

app.use(express.json());
app.use(authMiddleware);
app.use(express.static(path.join(__dirname, 'public')));

// AT Command executor with queue
let atQueue = [];
let atProcessing = false;

async function execAT(command, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    atQueue.push({ command, timeoutMs, resolve, reject });
    processATQueue();
  });
}

async function processATQueue() {
  if (atProcessing || atQueue.length === 0) return;
  atProcessing = true;

  while (atQueue.length > 0) {
    const { command, timeoutMs, resolve } = atQueue.shift();
    // Cap timeout so UI stays responsive (default 3s, max 8s)
    const effectiveTimeout = Math.min(Math.max(timeoutMs || 3000, 1000), 8000);
    let result = null;
    let lastErr = null;

    // At most 2 attempts (not 3) — first failure usually means port busy
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // Short settle only on retry
        if (attempt > 0) {
          // Clear any leftover at_exec holding the port
          try { await execAsync('pkill -f "at_exec /dev/ttyUSB" || true', { timeout: 1000 }); } catch (_) {}
          await new Promise(r => setTimeout(r, 150));
        }

        // Use JSON.stringify so quotes/commas in AT commands are shell-safe
        // e.g. AT^NV=550,9,"08,3A,..."
        const cmd = `at_exec ${JSON.stringify(currentPort)} ${JSON.stringify(command)} ${effectiveTimeout}`;
        const { stdout, stderr } = await execAsync(cmd, { timeout: effectiveTimeout + 1000 });
        const output = (stdout || '').trim() || (stderr || '').trim();

        if (output && (output.includes('OK') || output.includes('ERROR') || output.length > 5)) {
          result = output;
          break;
        }
        // Empty/no useful response — retry once
        lastErr = new Error('Empty AT response');
      } catch (err) {
        lastErr = err;
        // Prefer stdout/stderr from failed command if any
        const fallback = (err.stdout || err.stderr || '').toString().trim();
        if (fallback) {
          result = fallback;
          break;
        }
      }
    }

    resolve(
      result ||
      (lastErr && `ERROR: ${lastErr.message}`) ||
      'ERROR: No response after retries'
    );
  }

  atProcessing = false;
}

// Check AT port (just check if device exists and is accessible)
async function checkPort() {
  try {
    const { stdout } = await execAsync(`test -c ${currentPort} && test -w ${currentPort} && echo OK`, { timeout: 2000 });
    return stdout.trim() === 'OK';
  } catch {
    return false;
  }
}

// === AUTH API ===
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === PASSWORD) {
    const token = createSession();
    res.setHeader('Set-Cookie', `token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, error: 'Wrong password' });
  }
});

app.post('/api/logout', (req, res) => {
  deleteSession(getTokenFromReq(req));
  res.setHeader('Set-Cookie', 'token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  res.json({ success: true, authenticated: true });
});

// API: Send AT command
app.post('/api/at', async (req, res) => {
  try {
    const { command, timeout } = req.body;
    if (!command) return res.json({ success: false, error: 'Command required' });

    const result = await execAT(command, timeout || 5000);
    const isError = result.includes('ERROR') || result.includes('NO_RESPONSE') || result.includes('Cannot open');

    res.json({
      success: !isError,
      command,
      response: result,
      port: currentPort,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Check port status
app.get('/api/status', async (req, res) => {
  const portOk = await checkPort();
  res.json({
    port: currentPort,
    availablePorts: AVAILABLE_PORTS,
    portOk,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// API: Switch port
app.post('/api/port', async (req, res) => {
  const { port } = req.body;
  if (!port || !AVAILABLE_PORTS.includes(port)) {
    return res.json({ success: false, error: 'Invalid port', available: AVAILABLE_PORTS });
  }
  currentPort = port;
  const portOk = await checkPort();
  res.json({ success: true, port: currentPort, portOk });
});

// === IMEI MANAGEMENT ===
const IMEI_BACKUP_DIR = path.join(__dirname, 'data', 'imei');

// Ensure backup dir exists
if (!fs.existsSync(IMEI_BACKUP_DIR)) {
  fs.mkdirSync(IMEI_BACKUP_DIR, { recursive: true });
}

// GET /api/imei — read current IMEI from modem
app.get('/api/imei', async (req, res) => {
  try {
    const result = await execAT('ATI', 5000);
    // Parse IMEI from ATI output: "IMEI: 863364053563504"
    const match = result.match(/IMEI:\s*(\d{15})/);
    const imei = match ? match[1] : null;
    res.json({ success: !!imei, imei, raw: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/imei/backup — backup current IMEI to file
app.post('/api/imei/backup', async (req, res) => {
  try {
    // Read IMEI from modem via ATI
    const result = await execAT('ATI', 5000);
    const match = result.match(/IMEI:\s*(\d{15})/);
    const imei = match ? match[1] : null;

    if (!imei) {
      return res.json({ success: false, error: 'Could not read IMEI from modem', raw: result });
    }

    // Save to file with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(IMEI_BACKUP_DIR, `imei_${imei}_${timestamp}.json`);
    const backupData = {
      imei,
      port: currentPort,
      backedUpAt: new Date().toISOString(),
      modemInfo: null
    };

    // Also get modem info
    const infoResult = await execAT('ATI', 5000);
    backupData.modemInfo = infoResult;

    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));

    // Also save as latest
    const latestFile = path.join(IMEI_BACKUP_DIR, 'latest.json');
    fs.writeFileSync(latestFile, JSON.stringify(backupData, null, 2));

    res.json({
      success: true,
      imei,
      backupFile: path.basename(backupFile),
      message: `IMEI ${imei} backed up successfully`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/imei/backup — list all IMEI backups
app.get('/api/imei/backup', (req, res) => {
  try {
    const files = fs.readdirSync(IMEI_BACKUP_DIR)
      .filter(f => f.startsWith('imei_') && f.endsWith('.json'))
      .sort()
      .reverse();

    const backups = files.map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(IMEI_BACKUP_DIR, f), 'utf8'));
        return { file: f, imei: data.imei, backedUpAt: data.backedUpAt };
      } catch {
        return { file: f, error: 'corrupted' };
      }
    });

    res.json({ success: true, count: backups.length, backups });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Convert IMEI to Qualcomm NV550 format (from OpenWrt DW5821e manager)
// Algorithm:
//   1. Prepend "80A" to IMEI
//   2. Split into byte pairs
//   3. Swap nibbles in each pair
//   4. Join with commas
// Example: 354068084899466 → 08,3A,45,60,08,48,98,49,66
// Command: AT^NV=550,9,"08,3A,45,60,08,48,98,49,66"
function imeiToHex(imei) {
  const raw = '80A' + String(imei);
  const result = [];
  for (let i = 0; i < raw.length; i += 2) {
    const hi = raw.charAt(i);
    const lo = raw.charAt(i + 1) || '0';
    result.push((lo + hi).toUpperCase());
  }
  return result.join(',');
}

// Luhn check for IMEI (last digit is check digit)
function isValidImeiLuhn(imei) {
  if (!/^\d{15}$/.test(imei)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = parseInt(imei[i], 10);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

// POST /api/imei/restore — save IMEI + AT steps for manual apply (NO AUTO-APPLY)
app.post('/api/imei/restore', (req, res) => {
  try {
    const { imei } = req.body;
    if (!imei || !/^\d{15}$/.test(imei)) {
      return res.json({ success: false, error: 'Invalid IMEI format (must be 15 digits)' });
    }

    const imeiHex = imeiToHex(imei);
    const luhnOk = isValidImeiLuhn(imei);

    // Save restore command to file (DO NOT execute automatically)
    const restoreFile = path.join(IMEI_BACKUP_DIR, 'pending_restore.json');
    const restoreData = {
      imei,
      imeiHex,
      luhnOk,
      method: 'Qualcomm NV550 (80A + nibble-swap) — same as OpenWrt DW5821e manager',
      createdAt: new Date().toISOString(),
      status: 'pending',
      warning: 'DO NOT auto-apply. Send AT commands manually one by one.'
    };

    fs.writeFileSync(restoreFile, JSON.stringify(restoreData, null, 2));

    // Generate AT commands matching OpenWrt 3-step flow (manual only)
    const atCommands = [
      { step: 1, desc: 'Baca blok IMEI saat ini (simpan output!)', command: 'AT^NV=550' },
      { step: 2, desc: 'Clear NV550 (hapus partisi IMEI)', command: 'AT^NV=550,"0"' },
      { step: 3, desc: `Write IMEI (NV550: ${imeiHex})`, command: `AT^NV=550,9,"${imeiHex}"` },
      { step: 4, desc: 'Restart modem agar IMEI aktif', command: 'AT+CFUN=1,1' },
      { step: 5, desc: 'Verifikasi IMEI (setelah modem up ~30s)', command: 'ATI' }
    ];

    res.json({
      success: true,
      imei,
      imeiHex,
      luhnOk,
      status: 'saved_to_file',
      message: `IMEI ${imei} (NV550: ${imeiHex}) saved. NOT applied.`,
      steps: atCommands,
      warning: luhnOk
        ? 'Kirim AT command MANUAL satu-satu. Format NV550 sudah match OpenWrt. Jangan auto-apply!'
        : 'Peringatan: IMEI gagal Luhn check. Tetap bisa disimpan, tapi pastikan IMEI benar. Kirim AT command MANUAL.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/imei/pending — check pending restore
app.get('/api/imei/pending', (req, res) => {
  try {
    const restoreFile = path.join(IMEI_BACKUP_DIR, 'pending_restore.json');
    if (!fs.existsSync(restoreFile)) {
      return res.json({ success: true, pending: false });
    }
    const data = JSON.parse(fs.readFileSync(restoreFile, 'utf8'));
    res.json({ success: true, pending: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/imei/pending — cancel pending restore
app.delete('/api/imei/pending', (req, res) => {
  try {
    const restoreFile = path.join(IMEI_BACKUP_DIR, 'pending_restore.json');
    if (fs.existsSync(restoreFile)) {
      fs.unlinkSync(restoreFile);
    }
    res.json({ success: true, message: 'Pending restore cancelled' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/imei/preview — convert IMEI to NV550 only (no modem write)
app.post('/api/imei/preview', (req, res) => {
  try {
    const { imei } = req.body;
    if (!imei || !/^\d{15}$/.test(imei)) {
      return res.json({ success: false, error: 'Invalid IMEI format (must be 15 digits)' });
    }
    const imeiHex = imeiToHex(imei);
    res.json({
      success: true,
      imei,
      imeiHex,
      luhnOk: isValidImeiLuhn(imei),
      command: `AT^NV=550,9,"${imeiHex}"`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/imei/step — apply ONE IMEI step with confirmation (no full auto)
// step: 1=read, 2=clear, 3=write, 4=restart, 5=verify
app.post('/api/imei/step', async (req, res) => {
  try {
    const step = parseInt(req.body.step, 10);
    const confirm = !!req.body.confirm;

    if (![1, 2, 3, 4, 5].includes(step)) {
      return res.json({ success: false, error: 'Invalid step (1-5)' });
    }

    // Dangerous steps require explicit confirm=true
    if ([2, 3, 4].includes(step) && !confirm) {
      return res.json({
        success: false,
        error: 'Confirmation required',
        needConfirm: true,
        step
      });
    }

    const restoreFile = path.join(IMEI_BACKUP_DIR, 'pending_restore.json');
    let pending = null;
    if (fs.existsSync(restoreFile)) {
      pending = JSON.parse(fs.readFileSync(restoreFile, 'utf8'));
    }

    // Write step requires prepared IMEI
    if (step === 3) {
      if (!pending?.imei || !pending?.imeiHex) {
        return res.json({
          success: false,
          error: 'Belum ada IMEI pending. Klik "Siapkan Steps" dulu.'
        });
      }
    }

    let command = null;
    let timeout = 8000;
    let note = '';

    switch (step) {
      case 1:
        command = 'AT^NV=550';
        note = 'Read NV550 (safe)';
        break;
      case 2:
        command = 'AT^NV=550,"0"';
        note = 'Clear NV550 — dangerous if not followed by write';
        break;
      case 3:
        command = `AT^NV=550,9,"${pending.imeiHex}"`;
        note = `Write IMEI ${pending.imei}`;
        break;
      case 4:
        command = 'AT+CFUN=1,1';
        timeout = 5000;
        note = 'Restart modem — connection will drop ~30s';
        break;
      case 5:
        command = 'ATI';
        note = 'Verify IMEI';
        break;
    }

    const response = await execAT(command, timeout);
    const ok = response && !response.includes('ERROR: No response') && !response.includes('Cannot open');

    // Track progress on pending file
    if (pending) {
      pending.lastStep = step;
      pending.lastStepAt = new Date().toISOString();
      pending.lastCommand = command;
      pending.lastResponse = response;
      if (step === 3 && ok) pending.status = 'written';
      if (step === 4 && ok) pending.status = 'restarted';
      if (step === 5 && ok) pending.status = 'verified';
      fs.writeFileSync(restoreFile, JSON.stringify(pending, null, 2));
    }

    res.json({
      success: ok,
      step,
      command,
      response,
      note,
      pending: pending ? {
        imei: pending.imei,
        imeiHex: pending.imeiHex,
        status: pending.status
      } : null
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Multiple commands
app.post('/api/at/batch', async (req, res) => {
  try {
    const { commands, timeout } = req.body;
    if (!Array.isArray(commands)) return res.json({ success: false, error: 'Commands array required' });

    const results = [];
    for (const cmd of commands) {
      const result = await execAT(cmd, timeout || 5000);
      results.push({ command: cmd, response: result });
    }
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === SMS INBOX (modular: ./sms/*) ===
// sms/mmcli.js  -> ModemManager list/read/send/delete
// sms/at.js     -> AT CMGL/CPMS/CNMI setup
// sms/history.js-> local history so UI can show > current MM list
// sms/index.js  -> facade used by routes below
const sms = require('./sms');

app.get('/api/sms/inbox', async (req, res) => {
  try {
    const data = await sms.listInbox(execAT, { includeHistory: true });
    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/sms', async (req, res) => {
  try {
    const data = await sms.listInbox(execAT, { includeHistory: true });
    res.json(data.messages || []);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/sms/storage', async (req, res) => {
  try {
    const data = await sms.getStorage(execAT);
    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// OpenWrt-style SMS reception setup: CMGF + CPMS + CNMI
app.post('/api/sms/setup', async (req, res) => {
  try {
    const data = await sms.setupReception(execAT);
    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/sms/history', (req, res) => {
  try {
    res.json(sms.listHistoryOnly());
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/sms/history', (req, res) => {
  try {
    res.json(sms.clearHistory());
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/sms/send', async (req, res) => {
  try {
    const { number, text, message } = req.body || {};
    const result = await sms.sendSms(number, text || message);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/sms/:id', async (req, res) => {
  try {
    const result = await sms.deleteSms(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/sms', async (req, res) => {
  try {
    const result = await sms.deleteAll(execAT);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start
app.listen(PORT, HOST, async () => {
  const portOk = await checkPort();
  console.log(`
╔══════════════════════════════════════════════╗
║         AT TERMINAL v1.0                     ║
║   DW5821e AT Command Web Interface           ║
║   http://${HOST}:${PORT}                       ║
║   AT Port: ${currentPort} ${portOk ? '✅' : '❌'}               ║
╚══════════════════════════════════════════════╝
  `);
});

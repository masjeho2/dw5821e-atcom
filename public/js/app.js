// App bootstrap / UI shell

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === `tab-${name}`);
  });

  if (name === 'terminal') {
    document.getElementById('at-input')?.focus();
  }
  if (name === 'imei') {
    Imei.checkPending();
  }
  if (name === 'inbox') {
    if (typeof Inbox !== 'undefined') Inbox.onShow();
  } else if (typeof Inbox !== 'undefined') {
    Inbox.stopAuto();
  }
}

async function checkStatus() {
  try {
    const data = await apiGet('/api/status');
    const portStatus = document.getElementById('port-status');
    const portSelect = document.getElementById('port-select');
    const portName = document.getElementById('port-name');

    if (data.portOk) {
      portStatus.textContent = 'ONLINE';
      portStatus.className = 'badge badge-green';
    } else {
      portStatus.textContent = 'OFFLINE';
      portStatus.className = 'badge badge-red';
    }
    if (portSelect) portSelect.value = data.port;
    if (portName) portName.textContent = data.port;
  } catch {
    const portStatus = document.getElementById('port-status');
    if (portStatus) {
      portStatus.textContent = 'ERROR';
      portStatus.className = 'badge badge-red';
    }
  }
}

async function switchPort(port) {
  try {
    const data = await apiPost('/api/port', { port });
    if (data.success) {
      Terminal.addLine(`[PORT] Switched to ${data.port}`, 'info');
      await checkStatus();
    } else {
      Terminal.addLine(`[PORT ERROR] ${data.error}`, 'err');
    }
  } catch (err) {
    Terminal.addLine(`[PORT ERROR] ${err.message}`, 'err');
  }
}

async function doLogout() {
  if (!confirm('Logout?')) return;
  try {
    await apiPost('/api/logout');
  } catch (_) {}
  window.location.href = '/login.html';
}

// Global wrappers used by HTML onclick
function sendCommand() { return Terminal.send(); }
function quick(cmd) { return Terminal.quick(cmd); }
function confirmQuick(cmd, msg) { return Terminal.confirmQuick(cmd, msg); }
function clearTerminal() { return Terminal.clear(); }

function readIMEI() { return Imei.read(); }
function backupIMEI() { return Imei.backup(); }
function listBackup() { return Imei.listBackup(); }
function prepareIMEI() { return Imei.prepare(); }
function previewIMEI() { return Imei.preview(); }
function checkPending() { return Imei.checkPending(); }
function cancelPending() { return Imei.cancelPending(); }
function applyImeiStep(step) { return Imei.applyStep(step); }

// Init
document.addEventListener('DOMContentLoaded', () => {
  Terminal.bind();
  checkStatus();
  setInterval(checkStatus, 30000);
  setTimeout(() => Imei.read(), 1500);
  Imei.checkPending();
});

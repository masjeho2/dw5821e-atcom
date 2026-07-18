// IMEI management tab
const Imei = (() => {
  let pending = null;

  function setStatus(msg, type = 'info') {
    const el = document.getElementById('imei-status');
    if (!el) return;
    const colors = {
      info: 'var(--muted)',
      ok: 'var(--green)',
      err: 'var(--red)',
      warn: 'var(--yellow)'
    };
    el.style.color = colors[type] || colors.info;
    el.textContent = msg;
  }

  function logStep(msg, type = 'info') {
    const el = document.getElementById('imei-step-log');
    if (!el) return;
    const div = document.createElement('div');
    div.className = type;
    div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
  }

  function imeiToNV550(imei) {
    const raw = '80A' + imei;
    const result = [];
    for (let i = 0; i < raw.length; i += 2) {
      const hi = raw.charAt(i);
      const lo = raw.charAt(i + 1) || '0';
      result.push((lo + hi).toUpperCase());
    }
    return result.join(',');
  }

  function preview() {
    const imei = document.getElementById('imei-input')?.value.trim() || '';
    const previewEl = document.getElementById('nv550-preview');
    const writeCmd = document.getElementById('step-write-cmd');
    if (!previewEl) return;

    if (/^\d{15}$/.test(imei)) {
      const hex = imeiToNV550(imei);
      previewEl.textContent = hex;
      if (writeCmd) writeCmd.textContent = `AT^NV=550,9,"${hex}"`;
    } else {
      previewEl.textContent = imei.length ? `Butuh 15 digit (${imei.length}/15)` : '--';
      if (writeCmd) writeCmd.textContent = 'AT^NV=550,9,"..."';
    }
  }

  function updatePendingUI() {
    const pendingEl = document.getElementById('pending-imei');
    const btn2 = document.getElementById('btn-step-2');
    const btn3 = document.getElementById('btn-step-3');
    const btn4 = document.getElementById('btn-step-4');

    if (pendingEl) pendingEl.textContent = pending?.imei || '-';

    // Step 2/3/4 only unlocked after prepare
    const ready = !!(pending?.imei && pending?.imeiHex);
    if (btn2) btn2.disabled = !ready;
    if (btn3) btn3.disabled = !ready;
    if (btn4) btn4.disabled = !ready;

    if (ready) {
      const writeCmd = document.getElementById('step-write-cmd');
      if (writeCmd) writeCmd.textContent = `AT^NV=550,9,"${pending.imeiHex}"`;
      const previewEl = document.getElementById('nv550-preview');
      if (previewEl) previewEl.textContent = pending.imeiHex;
      const input = document.getElementById('imei-input');
      if (input && !input.value) input.value = pending.imei;
    }
  }

  async function read() {
    setStatus('Membaca IMEI...', 'info');
    try {
      const data = await apiGet('/api/imei');
      if (data.success) {
        document.getElementById('current-imei').textContent = data.imei;
        setStatus(`IMEI: ${data.imei}`, 'ok');
        Terminal.addLine(`[IMEI] Current: ${data.imei}`, 'ok');
      } else {
        setStatus('Gagal baca IMEI', 'err');
      }
    } catch (err) {
      setStatus(`Error: ${err.message}`, 'err');
    }
  }

  async function backup() {
    setStatus('Backup IMEI...', 'info');
    try {
      const data = await apiPost('/api/imei/backup');
      if (data.success) {
        document.getElementById('current-imei').textContent = data.imei;
        setStatus(`Backup OK: ${data.imei}`, 'ok');
        Terminal.addLine(`[IMEI] Backup: ${data.imei}`, 'ok');
        logStep(`Backup OK: ${data.imei}`, 'ok');
      } else {
        setStatus(data.error || 'Backup gagal', 'err');
      }
    } catch (err) {
      setStatus(`Error: ${err.message}`, 'err');
    }
  }

  async function listBackup() {
    try {
      const data = await apiGet('/api/imei/backup');
      const el = document.getElementById('imei-backup-list');
      if (!el) return;
      if (!data.count) {
        el.innerHTML = '<div class="backup-item">Belum ada backup</div>';
        return;
      }
      el.innerHTML = data.backups.map(b =>
        `<div class="backup-item">📱 ${b.imei || '?'} | ${b.backedUpAt || '?'} | ${b.file}</div>`
      ).join('');
      setStatus(`${data.count} backup ditemukan`, 'ok');
    } catch (err) {
      setStatus(`Error: ${err.message}`, 'err');
    }
  }

  async function prepare() {
    const imei = document.getElementById('imei-input')?.value.trim() || '';
    if (!/^\d{15}$/.test(imei)) {
      setStatus('IMEI harus 15 digit', 'err');
      return;
    }

    setStatus('Menyiapkan steps...', 'info');
    try {
      const data = await apiPost('/api/imei/restore', { imei });
      if (!data.success) {
        setStatus(data.error || 'Gagal prepare', 'err');
        return;
      }

      pending = {
        imei: data.imei,
        imeiHex: data.imeiHex,
        luhnOk: data.luhnOk,
        status: 'pending'
      };
      updatePendingUI();

      setStatus(`Siap: ${data.imei} | NV550: ${data.imeiHex}`, data.luhnOk ? 'ok' : 'warn');
      logStep(`Prepared IMEI ${data.imei}`, 'ok');
      logStep(`NV550: ${data.imeiHex}`, 'info');
      logStep(data.luhnOk ? 'Luhn OK' : 'Luhn GAGAL — cek IMEI', data.luhnOk ? 'ok' : 'warn');
      Terminal.addLine(`[IMEI] Prepared ${data.imei} (NOT applied)`, 'info');
      Terminal.addLine(`[IMEI] NV550: ${data.imeiHex}`, 'info');
    } catch (err) {
      setStatus(`Error: ${err.message}`, 'err');
    }
  }

  async function checkPending() {
    try {
      const data = await apiGet('/api/imei/pending');
      if (data.pending) {
        pending = data.data;
        updatePendingUI();
        setStatus(`Pending: ${data.data.imei} (${data.data.status || 'pending'})`, 'warn');
        logStep(`Pending loaded: ${data.data.imei}`, 'warn');
      } else {
        pending = null;
        updatePendingUI();
        setStatus('Tidak ada pending', 'info');
      }
    } catch (err) {
      setStatus(`Error: ${err.message}`, 'err');
    }
  }

  async function cancelPending() {
    try {
      const data = await apiDelete('/api/imei/pending');
      pending = null;
      updatePendingUI();
      setStatus(data.message || 'Pending dibatalkan', 'ok');
      logStep('Pending dibatalkan', 'warn');
    } catch (err) {
      setStatus(`Error: ${err.message}`, 'err');
    }
  }

  async function applyStep(step) {
    const labels = {
      1: 'Baca NV550 (aman)',
      2: 'CLEAR NV550 — IMEI partisi akan dihapus',
      3: 'WRITE IMEI baru ke NVRAM',
      4: 'RESTART modem — internet putus ~30 detik',
      5: 'Verifikasi IMEI'
    };

    if ([2, 3, 4].includes(step)) {
      if (step === 3 && !pending?.imeiHex) {
        setStatus('Siapkan IMEI dulu', 'err');
        return;
      }
      const extra = step === 3 ? `\nIMEI: ${pending.imei}\nNV550: ${pending.imeiHex}` : '';
      if (!confirm(`Yakin jalankan Step ${step}?\n\n${labels[step]}${extra}\n\nIni akan dikirim ke modem.`)) {
        return;
      }
    }

    logStep(`Menjalankan step ${step}: ${labels[step]}...`, 'warn');
    Terminal.addLine(`[IMEI] Step ${step}: ${labels[step]}`, 'info');

    try {
      const data = await apiPost('/api/imei/step', {
        step,
        confirm: [2, 3, 4].includes(step)
      });

      if (data.command) Terminal.addLine(`AT> ${data.command}`, 'cmd');

      if (data.success) {
        const lines = String(data.response || '').split('\n');
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          if (t === 'OK') {
            Terminal.addLine('OK', 'ok');
            logStep(`Step ${step} OK`, 'ok');
          } else if (t === 'ERROR') {
            Terminal.addLine('ERROR', 'err');
            logStep(`Step ${step} ERROR`, 'err');
          } else {
            Terminal.addLine(t, 'response');
          }
        }
        setStatus(`Step ${step} selesai`, 'ok');
        if (data.pending) {
          pending = { ...pending, ...data.pending };
          updatePendingUI();
        }
        if (step === 5) {
          // refresh current imei display from ATI response if possible
          const m = String(data.response || '').match(/IMEI:\s*(\d{15})/);
          if (m) document.getElementById('current-imei').textContent = m[1];
        }
      } else {
        setStatus(data.error || 'Step gagal', 'err');
        logStep(`Step ${step} gagal: ${data.error || data.response}`, 'err');
        Terminal.addLine(`ERROR: ${data.error || data.response}`, 'err');
      }
    } catch (err) {
      setStatus(`Error: ${err.message}`, 'err');
      logStep(`Step ${step} error: ${err.message}`, 'err');
    }
  }

  return {
    preview,
    read,
    backup,
    listBackup,
    prepare,
    checkPending,
    cancelPending,
    applyStep,
    updatePendingUI
  };
})();

// Presets detailed execution logging module

const PresetsLog = (() => {
  function getLogEl() {
    // Always re-query to avoid caching null if DOM not ready or element added later
    return document.getElementById('preset-log-content');
  }

  function append(text, cls = '') {
    // Prefer preset log box only — never dump into main terminal
    let el = getLogEl();
    if (!el || el.offsetParent === null) {
      if (typeof switchTab === 'function') switchTab('presets');
      el = getLogEl();
    }
    if (!el) {
      console.warn('[PresetsLog] #preset-log-content not found. Output:', text);
      return;
    }

    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = text;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;

    // keep max lines
    while (el.children.length > 150) {
      el.removeChild(el.firstChild);
    }
  }

  function clear() {
    const el = getLogEl();
    if (el) el.innerHTML = '';
  }

  function formatResponse(resp) {
    if (!resp) return '(no response)';
    return String(resp).trim();
  }

  // Simple parsers for common commands
  function parseResponse(cmd, resp) {
    const lines = String(resp || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const out = [];

    if (cmd === 'ATI' || cmd.toUpperCase().startsWith('ATI')) {
      lines.forEach(l => {
        if (l.includes('IMEI:')) out.push('IMEI: ' + l.split(':')[1].trim());
        else if (l.includes('Model:')) out.push(l);
        else if (l.includes('Revision:')) out.push(l);
        else if (l.includes('Manufacturer:')) out.push(l);
      });
    } else if (cmd === 'AT+CSQ') {
      const m = resp.match(/\+CSQ:\s*(\d+),(\d+)/);
      if (m) {
        const rssi = parseInt(m[1], 10);
        const qual = (rssi === 99) ? 'unknown' : Math.round((rssi / 31) * 100) + '%';
        out.push(`RSSI: ${rssi} (${qual})`);
      }
    } else if (cmd === 'AT+COPS?') {
      const m = resp.match(/\+COPS:\s*(.+)/);
      if (m) out.push('Operator: ' + m[1]);
    } else if (cmd === 'AT^DEBUG?') {
      const m = resp.match(/BAND:\s*(\d+)/);
      if (m) out.push('Band: ' + m[1]);
      const bw = resp.match(/BW:\s*([\d.]+)/);
      if (bw) out.push('Bandwidth: ' + bw[1] + ' MHz');
    }

    return out.length ? out.join(' | ') : null;
  }

  async function run(cmd, label = '') {
    // Force switch to the Presets tab so the log box is visible
    if (typeof switchTab === 'function') {
      switchTab('presets');
    }

    // Re-query after possible tab switch
    const el = getLogEl();
    if (!el) {
      console.warn('[Presets] preset-log-content not found even after switching tab for command:', cmd);
      return;
    }

    const ts = new Date().toLocaleTimeString();
    const displayLabel = label || cmd;

    append(`[${ts}] ▶ ${displayLabel}`, 'cmd');
    append(`    CMD: ${cmd}`, 'info');

    const start = performance.now();

    try {
      const data = await apiPost('/api/at', { command: cmd, timeout: 8000 });
      const dur = (performance.now() - start).toFixed(0);

      if (data.success) {
        append(`    OK (${dur}ms)`, 'ok');
        const parsed = parseResponse(cmd, data.response);
        if (parsed) {
          append(`    PARSED: ${parsed}`, 'resp');
        }
        append(`    RAW:\n${formatResponse(data.response)}`, 'resp');
      } else {
        append(`    ERR (${dur}ms)`, 'err');
        append(`    ${formatResponse(data.response || data.error)}`, 'err');
      }
    } catch (e) {
      append(`    EXCEPTION: ${e.message}`, 'err');
    }

    append('────────────────────────────────────', 'info');
  }

  // Expose for HTML onclick if needed
  window.runPreset = run;
  window.clearPresetLog = clear;

  return {
    run,
    clear
  };
})();

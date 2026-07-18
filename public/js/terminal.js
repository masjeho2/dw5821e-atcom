// Terminal tab logic
const Terminal = (() => {
  let history = [];
  let historyIdx = -1;
  let sending = false;

  function els() {
    return {
      terminal: document.getElementById('terminal'),
      input: document.getElementById('at-input'),
      btnSend: document.getElementById('btn-send'),
      historyCount: document.getElementById('history-count')
    };
  }

  function addLine(text, type = 'info') {
    const { terminal } = els();
    if (!terminal) return;
    const div = document.createElement('div');
    div.className = `line ${type}`;
    div.textContent = text;
    terminal.appendChild(div);
    terminal.scrollTop = terminal.scrollHeight;
    while (terminal.children.length > 500) terminal.removeChild(terminal.firstChild);
  }

  function clear() {
    const { terminal } = els();
    if (!terminal) return;
    terminal.innerHTML = '<div class="line info">Terminal cleared.</div>';
  }

  async function send(cmdFromOutside) {
    const { input, btnSend, historyCount } = els();
    const cmd = (cmdFromOutside ?? input?.value ?? '').trim();
    if (!cmd || sending) return;

    sending = true;
    if (btnSend) {
      btnSend.disabled = true;
      btnSend.textContent = '...';
    }

    history.push(cmd);
    historyIdx = history.length;
    if (historyCount) historyCount.textContent = history.length;
    if (input && !cmdFromOutside) input.value = '';

    addLine(`AT> ${cmd}`, 'cmd');

    try {
      const data = await apiPost('/api/at', { command: cmd, timeout: 8000 });
      if (data.success) {
        const lines = String(data.response || '').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed === 'OK') addLine('OK', 'ok');
          else if (trimmed === 'ERROR') addLine('ERROR', 'err');
          else addLine(trimmed, 'response');
        }
      } else {
        addLine(`ERROR: ${data.response || data.error}`, 'err');
      }
    } catch (err) {
      addLine(`CONNECTION ERROR: ${err.message}`, 'err');
    }

    sending = false;
    if (btnSend) {
      btnSend.disabled = false;
      btnSend.textContent = 'Kirim';
    }
    input?.focus();
  }

  function quick(cmd) {
    const { input } = els();
    if (input) input.value = cmd;
    return send(cmd);
  }

  function confirmQuick(cmd, message) {
    if (!confirm(message || `Jalankan ${cmd}?`)) return;
    return quick(cmd);
  }

  function bind() {
    const { input } = els();
    if (!input) return;

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        send();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (historyIdx > 0) {
          historyIdx--;
          input.value = history[historyIdx] || '';
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (historyIdx < history.length - 1) {
          historyIdx++;
          input.value = history[historyIdx] || '';
        } else {
          historyIdx = history.length;
          input.value = '';
        }
      }
    });
  }

  return { addLine, clear, send, quick, confirmQuick, bind };
})();

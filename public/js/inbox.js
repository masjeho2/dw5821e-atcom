// SMS Inbox tab module
const Inbox = (() => {
  let autoTimer = null;

  function els() {
    return {
      list: document.getElementById('inbox-list'),
      status: document.getElementById('inbox-status'),
      count: document.getElementById('inbox-count'),
      storage: document.getElementById('inbox-storage')
    };
  }

  function setStatus(msg, type = 'info') {
    const { status } = els();
    if (!status) return;
    const colors = {
      info: 'var(--muted)',
      ok: 'var(--green)',
      err: 'var(--red)',
      warn: 'var(--yellow)'
    };
    status.style.color = colors[type] || colors.info;
    status.textContent = msg;
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function render(messages) {
    const { list, count } = els();
    if (!list) return;

    if (count) count.textContent = String(messages.length || 0);

    if (!messages.length) {
      list.innerHTML = '<div class="inbox-empty">Tidak ada SMS</div>';
      return;
    }

    list.innerHTML = messages.map((m) => {
      const id = m.path || m.index || '';
      const state = (m.state || 'unknown').toLowerCase();
      const badge = state.includes('receiv') || state.includes('unread')
        ? 'badge-new'
        : 'badge-old';
      return `
        <div class="inbox-item">
          <div class="inbox-item-top">
            <div class="inbox-from">📱 ${escapeHtml(m.number || 'Unknown')}</div>
            <div class="inbox-meta">
              <span class="inbox-badge ${badge}">${escapeHtml(m.state || 'unknown')}</span>
              <span class="inbox-time">${escapeHtml(m.timestamp || '--')}</span>
            </div>
          </div>
          <div class="inbox-body">${escapeHtml(m.text || '')}</div>
          <div class="inbox-actions">
            <span class="inbox-source">${escapeHtml(m.source || '')} · ${escapeHtml(m.storage || '')}</span>
            <button class="btn btn-sm btn-danger" onclick="Inbox.remove('${escapeHtml(id)}')">Hapus</button>
          </div>
        </div>
      `;
    }).join('');
  }

  async function refresh() {
    setStatus('Refresh: setup SMS + muat inbox...', 'info');
    try {
      // Gabung setup CNMI/CPMS ke Refresh (tanpa tombol terpisah)
      try {
        await apiPost('/api/sms/setup', {});
      } catch (setupErr) {
        // setup gagal tidak boleh gagalkan baca inbox
        console.warn('[SMS setup]', setupErr);
      }

      const data = await apiGet('/api/sms/inbox');
      if (!data.success && data.error) {
        setStatus(data.error, 'err');
        render([]);
        return;
      }
      render(data.messages || []);
      const live = data.liveCount != null ? data.liveCount : (data.count || 0);
      const total = data.count || 0;
      setStatus(
        total === live
          ? `Inbox: ${total} pesan`
          : `Inbox: ${total} pesan (live modem: ${live}, +history lokal)`,
        'ok'
      );

      // storage info optional
      try {
        const st = await apiGet('/api/sms/storage');
        const { storage } = els();
        if (storage && st) {
          if (st.used != null) {
            storage.textContent = `Storage ${st.storage || ''}: ${st.used}/${st.total}`;
          } else {
            storage.textContent = st.raw ? 'Storage: OK' : 'Storage: --';
          }
        }
      } catch (_) {}
    } catch (e) {
      setStatus(`Error: ${e.message}`, 'err');
    }
  }

  async function remove(id) {
    if (!id) return;
    if (!confirm('Hapus SMS ini?')) return;
    setStatus('Menghapus...', 'warn');
    try {
      const data = await apiDelete('/api/sms/' + encodeURIComponent(id));
      if (data.success) {
        setStatus('SMS dihapus', 'ok');
        refresh();
      } else {
        setStatus(data.error || data.message || 'Gagal hapus', 'err');
      }
    } catch (e) {
      setStatus(`Error: ${e.message}`, 'err');
    }
  }

  async function removeAll() {
    if (!confirm('Hapus SEMUA SMS?')) return;
    setStatus('Menghapus semua...', 'warn');
    try {
      const data = await apiDelete('/api/sms');
      if (data.success) {
        setStatus(data.message || 'Semua SMS dihapus', 'ok');
        refresh();
      } else {
        setStatus(data.error || 'Gagal hapus semua', 'err');
      }
    } catch (e) {
      setStatus(`Error: ${e.message}`, 'err');
    }
  }

  async function send() {
    const number = document.getElementById('sms-number')?.value.trim();
    const text = document.getElementById('sms-text')?.value.trim();
    if (!number || !text) {
      setStatus('Isi nomor dan pesan', 'err');
      return;
    }
    setStatus('Mengirim SMS...', 'info');
    try {
      const data = await apiPost('/api/sms/send', { number, text });
      if (data.success) {
        setStatus('SMS terkirim', 'ok');
        const t = document.getElementById('sms-text');
        if (t) t.value = '';
        refresh();
      } else {
        setStatus(data.error || data.message || 'Gagal kirim', 'err');
      }
    } catch (e) {
      setStatus(`Error: ${e.message}`, 'err');
    }
  }

  function startAuto() {
    stopAuto();
    autoTimer = setInterval(() => {
      // only refresh if inbox tab active
      const panel = document.getElementById('tab-inbox');
      if (panel && panel.classList.contains('active')) refresh();
    }, 15000);
  }

  function stopAuto() {
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = null;
  }

  function onShow() {
    refresh();
    startAuto();
  }

  return { refresh, remove, removeAll, send, onShow, stopAuto };
})();

// HTML helpers
function refreshInbox() { return Inbox.refresh(); }
function deleteAllInbox() { return Inbox.removeAll(); }
function sendInboxSms() { return Inbox.send(); }

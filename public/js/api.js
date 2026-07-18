// API helpers
async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Unauthorized');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data.error && !data.message) {
    throw new Error(`HTTP ${res.status}`);
  }
  return data;
}

async function apiGet(path) {
  return api(path);
}

async function apiPost(path, body = {}) {
  return api(path, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

async function apiDelete(path) {
  return api(path, { method: 'DELETE' });
}

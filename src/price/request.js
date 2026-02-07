export async function fetchJson(url, { timeoutMs = 4000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...headers,
      },
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      err.body = text.slice(0, 200);
      throw err;
    }
    try {
      return JSON.parse(text);
    } catch (_e) {
      const err = new Error('Invalid JSON');
      err.body = text.slice(0, 200);
      throw err;
    }
  } finally {
    clearTimeout(timer);
  }
}


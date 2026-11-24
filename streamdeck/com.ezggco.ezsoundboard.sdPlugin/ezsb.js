// Talks to the EZ Soundboard app on this PC (it must be running).
'use strict';
const EZSB = (() => {
  const BASE = 'http://127.0.0.1:41720/v1';
  const HEADERS = { 'X-EZSB': '1', 'Content-Type': 'application/json' };
  async function call(path, body) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    try {
      const res = await fetch(BASE + path, body === undefined
        ? { headers: HEADERS, signal: ctl.signal, cache: 'no-store' }
        : { method: 'POST', headers: HEADERS, body: JSON.stringify(body), signal: ctl.signal });
      const j = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !j.ok) throw new Error(j.error || 'EZ Soundboard said no (' + res.status + ')');
      return j;
    } finally {
      clearTimeout(t);
    }
  }
  return {
    sounds: () => call('/sounds'),
    state: () => call('/state'),
    play: (id, name) => call('/play', { id, name }),
    stopAll: () => call('/stopall', {}),
    tts: (text) => call('/tts', { text }),
    mic: () => call('/mic', {})
  };
})();

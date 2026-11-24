'use strict';
/* global EZ */
/*
 * The soundboard page's link to the Rust backend.
 *
 * It provides the same `window.api` the Electron preload did and an `AudioEngine` with the same
 * methods app.js already uses, so the UI code stays (almost) unchanged. The difference: all audio
 * now runs in Rust (WASAPI), not in this page. The page only shows what's going on.
 */
(() => {
  const { invoke, listen } = EZ;
  const raw = (cmd, bytes, headers) => invoke(cmd, bytes, { headers });

  /* ---------------- settings push (sliders feel instant) ---------------- */
  let pushQueued = false;
  function pushSettings() {
    if (pushQueued || typeof lib === 'undefined' || !lib) return;
    pushQueued = true;
    queueMicrotask(() => {
      pushQueued = false;
      invoke('sb_settings', { settings: lib.settings }).catch(() => {});
    });
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const route = () => invoke('sb_route').catch(() => ({ monitor: false, mic: false, micInput: false }));

  /* ---------------- the engine, as seen by the page ---------------- */
  class AudioEngine {
    constructor() {
      this.voices = new Map();
      this.onChange = () => {};
      this.monAnalyser = 'mon';
      this.micAnalyser = 'mic';
      this.voiceAnalyser = 'voice';
      this.tap = null;
      this.pinned = new Set();
      this.cacheLimit = 0;
      this.cacheBytes = 0;
      this._levels = { mon: 0, mic: 0, voice: 0 };
      this._levelAt = 0;
      this._levelBusy = false;
      this._analysis = new Map();
      listen('sb-voices', (list) => this._setVoices(list));
      invoke('sb_voices').then((r) => this._setVoices(r.voices)).catch(() => {});
    }

    _setVoices(list) {
      const next = new Map();
      for (const v of list || []) next.set(v.id, { ...v, stopping: false });
      this.voices = next;
      try { this.onChange(); } catch (e) { console.error(e); }
    }

    /* power / routing: the backend handles these itself; settings changes go straight to it */
    resume() {}
    async wake() {}
    async sleep() {}
    isAsleep() { return false; }
    updateDuck() {}
    async setMonitorSink() { pushSettings(); await sleep(150); return (await route()).monitor; }
    async setMicSink(id) { pushSettings(); if (!id) return false; await sleep(250); return (await route()).mic; }
    async setDirect() { pushSettings(); }
    async setMicInput() { pushSettings(); await sleep(150); return (await route()).micInput !== false; }
    setVolumes() { pushSettings(); }
    setSoundsToMic() { pushSettings(); }
    setLimiter() { pushSettings(); }
    setDuck() { pushSettings(); }
    setCacheLimit() {}
    isCached() { return true; }
    forget(file) { invoke('sb_forget', { file }).catch(() => {}); this._analysis.clear(); }

    /** Decodes in Rust and returns { peaks, rms, duration } (+ `file` if it had to be converted). */
    async analyse(file, buckets = 96) {
      const key = file + '|' + buckets;
      if (this._analysis.has(key)) return this._analysis.get(key);
      let r;
      try {
        r = await invoke('sb_analyse', { file, buckets });
      } catch (e) {
        // A format the Rust decoders don't read (e.g. Opus): the page decodes it once and the
        // backend keeps it as a .wav from then on.
        const newFile = await convertToWav(file);
        r = { ...(await invoke('sb_analyse', { file: newFile, buckets })), file: newFile };
      }
      this._analysis.set(key, r);
      if (this._analysis.size > 300) this._analysis.delete(this._analysis.keys().next().value);
      return r;
    }
    async getBuffer(file) { return this.analyse(file); }

    setVoiceVolume(soundId, volume) { invoke('sb_voice_volume', { soundId, volume }).catch(() => {}); }
    stop(id) { const v = this.voices.get(id); if (v) v.stopping = true; invoke('sb_stop', { id }).catch(() => {}); }
    stopSound(soundId) { for (const v of this.voices.values()) if (v.soundId === soundId) v.stopping = true; invoke('sb_stop_sound', { soundId }).catch(() => {}); }
    stopAll() { for (const v of this.voices.values()) v.stopping = true; invoke('sb_stop_all').catch(() => {}); }
    voicesFor(soundId) { return [...this.voices.values()].filter((v) => v.soundId === soundId && !v.stopping); }
    micVoiceCount() { let n = 0; for (const v of this.voices.values()) if (v.toMic && !v.stopping) n++; return n; }
    isDucking() { return !!(lib && lib.settings.duck && this.micVoiceCount() > 0); }

    progress(v) {
      const el = (Date.now() - v.startedAt) / 1000;
      if (el <= 0 || !v.length) return 0;
      return v.loop ? (el % v.length) / v.length : Math.min(1, el / v.length);
    }

    /** Meter levels: polled from the backend at most once per frame. */
    level(which) {
      const now = performance.now();
      if (!this._levelBusy && now - this._levelAt > 25) {
        this._levelBusy = true;
        this._levelAt = now;
        invoke('sb_levels').then((l) => {
          for (const k of ['mon', 'mic', 'voice']) this._levels[k] = l[k] || 0;
        }).catch(() => {}).finally(() => { this._levelBusy = false; });
      }
      const v = this._levels[which] || 0;
      this._levels[which] = v * 0.5; // the backend reports peaks since the last poll
      return v;
    }

    static normGain(rms) {
      if (!rms) return 1;
      return Math.min(4, Math.max(0.2, 0.16 / rms));
    }
  }
  window.AudioEngine = AudioEngine;

  /* ---------------- formats only the webview can decode ---------------- */
  async function convertToWav(file) {
    const bytes = await invoke('sb_read_file', { file });
    const ctx = new OfflineAudioContext(2, 1, 48000);
    const buf = await ctx.decodeAudioData(bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer);
    const wav = encodeWav(buf);
    return raw('sb_write_wav', new Uint8Array(wav), { 'x-old': file });
  }

  function encodeWav(buf) {
    const ch = Math.min(2, buf.numberOfChannels);
    const frames = buf.length;
    const data = frames * ch * 4;
    const out = new ArrayBuffer(44 + data);
    const v = new DataView(out);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + data, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 3, true); v.setUint16(22, ch, true);
    v.setUint32(24, buf.sampleRate, true); v.setUint32(28, buf.sampleRate * ch * 4, true);
    v.setUint16(32, ch * 4, true); v.setUint16(34, 32, true);
    str(36, 'data'); v.setUint32(40, data, true);
    const chans = [];
    for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
    let o = 44;
    for (let i = 0; i < frames; i++) for (let c = 0; c < ch; c++) { v.setFloat32(o, chans[c][i], true); o += 4; }
    return out;
  }

  /* ---------------- dropped files (webviews don't give paths, so we send the bytes) ---------------- */
  const AUDIO_RE = /\.(mp3|wav|ogg|oga|flac|m4a|aac|webm|opus|mp4)$/i;
  async function collectEntries(entry, out, depth = 0) {
    if (!entry || depth > 6 || out.length > 3000) return;
    if (entry.isFile) {
      if (AUDIO_RE.test(entry.name)) out.push(await new Promise((res, rej) => entry.file(res, rej)).catch(() => null));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((res) => reader.readEntries(res, () => res([])));
        if (!batch.length) break;
        for (const e of batch) await collectEntries(e, out, depth + 1);
      }
    }
  }
  async function importDropped(dt) {
    const files = [];
    const items = [...(dt.items || [])];
    if (items.length && items[0].webkitGetAsEntry) {
      const entries = items.map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
      for (const e of entries) await collectEntries(e, files);
    } else {
      files.push(...[...(dt.files || [])].filter((f) => AUDIO_RE.test(f.name)));
    }
    const out = [];
    for (const f of files.filter(Boolean)) {
      if (f.size > 300 * 1024 * 1024) continue;
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        out.push(await raw('sb_import_bytes', bytes, { 'x-name': encodeURIComponent(f.name) }));
      } catch (e) { console.warn('import failed', f.name, e); }
    }
    return out;
  }

  /* ---------------- typing guard for bare-key hotkeys ---------------- */
  const isTyping = () => {
    const ae = document.activeElement;
    return !!(ae && (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && ['text', 'number', 'search', ''].includes(ae.type))));
  };
  document.addEventListener('focusin', () => invoke('sb_typing', { on: isTyping() }).catch(() => {}));
  document.addEventListener('focusout', () => setTimeout(() => invoke('sb_typing', { on: isTyping() }).catch(() => {}), 0));

  /* ---------------- window.api (same shape as the Electron preload) ---------------- */
  const on = (ev) => (cb) => listen(ev, cb);
  window.api = {
    platform: 'win32',
    loadLib: async () => { const l = await invoke('sb_load_lib'); invoke('sb_attach').catch(() => {}); return l; },
    saveLib: (data) => invoke('sb_save_lib', { data }),
    pickFiles: () => invoke('sb_pick_files'),
    pickFolder: () => invoke('sb_pick_folder'),
    importPaths: (paths) => invoke('sb_import', { paths }),
    importDropped,
    starterSounds: () => invoke('sb_starter'),
    deleteSound: (file) => invoke('sb_delete', { file }),
    revealSound: (file) => invoke('sb_reveal', { file }),
    getPathForFile: () => '',

    setHotkeys: (bindings) => invoke('sb_set_hotkeys', { bindings }),
    hotkeyBackend: async () => 'native',
    suspendHotkeys: (on2) => { invoke('sb_suspend_hotkeys', { on: !!on2 }).catch(() => {}); if ((window.__EZ_FLAVOR || 'suite') === 'suite') invoke('xh_pause_hotkey', { pause: !!on2 }).catch(() => {}); },
    onHotkey: () => {},

    apo: {
      available: () => invoke('sb_apo_available'),
      list: () => invoke('sb_apo_list'),
      apply: (enable, disable) => invoke('sb_apo_apply', { enable, disable }),
      start: async () => true,
      stop: () => {},
      push: () => {},
      setVoice: () => {},
      onStatus: on('sb-apo-status')
    },

    pttDown: () => {},
    pttUp: () => {},

    win: {
      min: () => invoke('win_min'),
      max: () => invoke('win_max').then((m) => document.body.classList.toggle('maximized', !!m)),
      close: () => invoke('win_close'),
      setCloseToTray: (v) => invoke('app_set_close_to_tray', { on: !!v }),
      onMaximized: (cb) => window.addEventListener('resize', () => invoke('win_is_maximized').then(cb).catch(() => {}))
    },
    importUrl: (url) => invoke('sb_import_url', { url }),

    tts: {
      voices: (refresh) => invoke('sb_tts_voices', { refresh: !!refresh }),
      speak: (o) => invoke('sb_tts_speak', { text: o.text || '', voice: o.voice || '', rate: Number(o.rate) || 1 }),
      keep: (file) => invoke('sb_tts_keep', { file })
    },

    update: {
      state: () => invoke('update_state'),
      check: () => invoke('update_check'),
      download: () => invoke('update_download'),
      install: () => invoke('update_install'),
      openPage: () => invoke('update_open'),
      setEnabled: (on2) => invoke('update_set_enabled', { on: !!on2 }),
      onState: on('update-state')
    },
    appVersion: () => invoke('app_version'),

    remote: {
      status: () => invoke('sb_remote_status'),
      setEnabled: (on2) => invoke('sb_remote_set_enabled', { on: !!on2 }),
      installPlugin: () => invoke('sb_remote_install_plugin'),
      setLibrary: () => {},
      setPlaying: () => {},
      onCommand: () => {},
      onStatus: on('sb-remote-status')
    },

    openExternal: (url) => invoke('app_open_external', { url }),
    getHardwareAcceleration: () => invoke('sb_get_hw_accel'),
    setHardwareAcceleration: (on2) => invoke('sb_set_hw_accel', { on: !!on2 }),

    // New in EZ Suite
    sb: {
      trigger: (id, monitorOnly, sound) => invoke('sb_trigger', { id, monitorOnly: !!monitorOnly, sound: sound || null }),
      playClip: (sound, monitorOnly) => invoke('sb_play_clip', { sound, monitorOnly: !!monitorOnly }),
      devices: () => invoke('sb_devices'),
      pushSettings,
      onPlayed: on('sb-played'),
      onPtt: on('sb-ptt'),
      onSettingsPatch: on('sb-settings-patch'),
      onToast: on('sb-toast'),
      onRoute: on('sb-route')
    }
  };
})();

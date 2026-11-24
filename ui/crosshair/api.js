'use strict';
/* global EZ, Crosshair */
/*
 * The crosshair designer's link to the Rust backend: the same `window.api` the Electron preload
 * gave editor.js, so the designer code is unchanged. Designs are cleaned up here with
 * crosshair.js (the backend stores them as-is).
 */
(() => {
  const { invoke, listen } = EZ;
  let triggers = null;

  /** Raw key/button events -> the "trigger" events crosshair animations understand. */
  function makeTriggerInput(cb) {
    const held = new Set();
    return ({ code, down }) => {
      if (!triggers) return;
      const name = Crosshair.canonKey(code);
      const actions = Crosshair.actionsFor(triggers, name);
      const active = (a) => triggers[a].some((n) => held.has(n));
      if (down) {
        if (held.has(name)) return; // key auto-repeat
        const was = actions.map(active);
        held.add(name);
        actions.forEach((a, i) => { if (!was[i]) cb({ type: 'trigger', action: a, down: true }); });
      } else {
        if (!held.delete(name)) return;
        actions.forEach((a) => { if (!active(a)) cb({ type: 'trigger', action: a, down: false }); });
      }
    };
  }
  window.EZTriggers = { make: makeTriggerInput, set: (t) => { triggers = t ? Crosshair.sanitizeTriggers(t) : null; } };

  const keep = (s) => { if (s && s.triggers) triggers = Crosshair.sanitizeTriggers(s.triggers); return s; };
  const pause = (p) => {
    invoke('xh_pause_hotkey', { pause: !!p }).catch(() => {});
    invoke('sb_suspend_hotkeys', { on: !!p }).catch(() => {});
    return Promise.resolve(true);
  };

  window.api = {
    getConfig: () => invoke('xh_get_config').then(keep),
    setCrosshair: (c) => invoke('xh_set_crosshair', { design: Crosshair.sanitizeDesign(c) }),
    saveProfile: (name, c) => invoke('xh_save_profile', { name, design: Crosshair.sanitizeDesign(c) }),
    loadProfile: (name) => invoke('xh_load_profile', { name }),
    deleteProfile: (name) => invoke('xh_delete_profile', { name }),
    setProfileHotkey: (name, accel) => invoke('xh_set_profile_hotkey', { name, accel: accel || null }),
    setCheckUpdates: (on) => invoke('update_set_enabled', { on: !!on }).then((s) => s.enabled),
    checkUpdate: async () => {
      const s = await invoke('update_check');
      const c = await invoke('xh_get_config');
      return { ok: s.phase !== 'error', update: c.update };
    },
    openUpdate: () => invoke('update_open'),
    downloadUpdate: () => invoke('update_download'),
    installUpdate: () => invoke('update_install'),
    setOverlay: (v) => invoke('xh_set_overlay', { visible: !!v }),
    setDisplayMode: (m) => invoke('xh_set_mode', { mode: String(m) }),
    setTriggers: (t) => invoke('xh_set_triggers', { triggers: Crosshair.sanitizeTriggers(t) }).then((r) => { triggers = r; return r; }),
    setHotkey: (accel, which) => invoke('xh_set_hotkey', { accel: String(accel || ''), which: which || 'toggle' }),
    setSettings: (p) => invoke('xh_set_settings', { p: p || {} }),
    setGames: (p) => invoke('xh_set_games', { p: p || {} }),
    listProcs: () => invoke('xh_list_procs'),
    getDiag: () => invoke('xh_get_diag'),
    setGuide: (on) => invoke('xh_set_guide', { on: !!on }),
    relaunch: () => invoke('app_relaunch'),
    getPerf: () => invoke('xh_get_perf'),
    exportBackup: () => invoke('xh_export_backup'),
    importBackup: () => invoke('xh_import_backup'),
    pauseHotkey: pause,
    listDisplays: () => invoke('xh_list_displays'),
    setDisplay: (id) => invoke('xh_set_display', { id: Number.isInteger(id) ? id : (id === '' || id == null ? null : Number(id)) }),
    setAutoStart: (v) => invoke('xh_set_autostart', { on: !!v }),
    clipboardWrite: (t) => invoke('app_clipboard_write', { text: String(t) }),
    clipboardRead: () => invoke('app_clipboard_read'),
    onState: (cb) => listen('xh-state', (s) => cb(keep(s))),
    onCrosshair: (cb) => listen('xh-crosshair', cb),
    onInput: (cb) => { const f = makeTriggerInput(cb); return listen('xh-input', f); }
  };
})();

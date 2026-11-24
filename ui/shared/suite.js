'use strict';
/* EZ Suite shell shared by both pages: the Tauri bridge, the app bar (Soundboard | Crosshair tabs +
   window buttons) and telling the backend whether the page is on screen.
   The standalone EZ Reticle / EZ Soundboard use the same pages: no tabs, their own name. */
(() => {
  const T = window.__TAURI__;
  const invoke = (cmd, args, opts) => T.core.invoke(cmd, args, opts);
  const listen = (ev, cb) => T.event.listen(ev, (e) => cb(e.payload));
  const page = document.documentElement.dataset.page || 'soundboard';
  // Set by the backend: 'suite', 'reticle' or 'soundboard'.
  const flavor = window.__EZ_FLAVOR || 'suite';
  const suite = flavor === 'suite';
  const WORD = { suite: 'SUITE', reticle: 'RETICLE', soundboard: 'SOUNDBOARD' }[flavor] || 'SUITE';
  const APP_NAME = { suite: 'EZ Suite', reticle: 'EZ Reticle', soundboard: 'EZ Soundboard' }[flavor] || 'EZ Suite';

  const LOGO = '<svg class="ez-mark" viewBox="16 191 1870 680"><polygon fill="#adadad" points="207,191 1000,191 813,354 413,354 392,433 985,433 785,592 348,592 323,681 860,681 619,871 16,871"/><polygon fill="#fdcc14" points="1055,191 1886,191 1290,681 1763,681 1538,871 680,871 1352,354 868,354"/></svg>';
  const TABS = [
    ['soundboard', 'Soundboard', '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10"/>'],
    ['crosshair', 'Crosshair', '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>']
  ];
  const WIN_BTNS = `
    <div class="ez-win">
      <button data-ezwin="min" title="Minimize"><svg viewBox="0 0 12 12"><path d="M2 6h8"/></svg></button>
      <button data-ezwin="max" title="Maximize"><svg viewBox="0 0 12 12"><rect x="2.5" y="2.5" width="7" height="7" rx="1"/></svg></button>
      <button data-ezwin="close" class="close" title="Close to tray (keeps running)"><svg viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6"/></svg></button>
    </div>`;

  function tabsHtml() {
    if (!suite) return '<nav class="ez-tabs"></nav>';
    return `<nav class="ez-tabs">${TABS.map(([id, label, ic]) =>
      `<button class="ez-tab ${id === page ? 'on' : ''}" data-ezpage="${id}"><svg viewBox="0 0 24 24">${ic}</svg>${label}</button>`).join('')}</nav>`;
  }

  function goto(p) {
    if (p === page) return;
    invoke('app_goto', { page: p });
  }

  function bindBar(root) {
    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-ezpage]');
      if (t) { goto(t.dataset.ezpage); return; }
      const w = e.target.closest('[data-ezwin]');
      if (!w) return;
      if (w.dataset.ezwin === 'min') invoke('win_min');
      else if (w.dataset.ezwin === 'max') invoke('win_max').then((m) => document.body.classList.toggle('maximized', !!m));
      else invoke('win_close');
    });
  }

  function mount() {
    document.body.classList.add('ez-suite', 'ez-page-' + page, 'ez-flavor-' + flavor);
    document.title = suite ? document.title : APP_NAME;
    const existing = document.getElementById('titlebar');
    if (existing) {
      // The soundboard already has a title bar: add the tabs to it.
      existing.setAttribute('data-tauri-drag-region', '');
      existing.querySelectorAll('.brand, .flex').forEach((el) => el.setAttribute('data-tauri-drag-region', ''));
      const brand = existing.querySelector('.brand');
      const word = brand.querySelector('span');
      if (word) word.textContent = WORD;
      const nav = document.createElement('div');
      nav.innerHTML = tabsHtml();
      brand.after(nav.firstElementChild);
      bindBar(existing);
    } else {
      const bar = document.createElement('header');
      bar.className = 'ez-bar';
      bar.setAttribute('data-tauri-drag-region', '');
      bar.innerHTML = `<div class="ez-brand" data-tauri-drag-region>${LOGO}<span data-tauri-drag-region>${WORD}</span></div>${tabsHtml()}<div class="ez-flex" data-tauri-drag-region></div>${WIN_BTNS}`;
      document.body.prepend(bar);
      bindBar(bar);
    }
    invoke('win_is_maximized').then((m) => document.body.classList.toggle('maximized', !!m)).catch(() => {});
    window.addEventListener('resize', () => invoke('win_is_maximized').then((m) => document.body.classList.toggle('maximized', !!m)).catch(() => {}));
  }

  // Tell the backend whether this page is on screen (it pauses work nobody can see).
  let lastVis = null;
  function reportVisibility() {
    const v = !document.hidden;
    if (v === lastVis) return;
    lastVis = v;
    invoke('app_ui_state', { page, visible: v }).catch(() => {});
  }
  document.addEventListener('visibilitychange', reportVisibility);

  window.ezGoto = goto;
  window.EZ = { invoke, listen, page, flavor, appName: APP_NAME };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { mount(); reportVisibility(); });
  else { mount(); reportVisibility(); }
})();

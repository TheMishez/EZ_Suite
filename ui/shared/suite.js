'use strict';
/* EZ Suite shell shared by both pages: the Tauri bridge, the app bar (Soundboard | Crosshair tabs +
   window buttons) and telling the backend whether the page is on screen. */
(() => {
  const T = window.__TAURI__;
  const invoke = (cmd, args, opts) => T.core.invoke(cmd, args, opts);
  const listen = (ev, cb) => T.event.listen(ev, (e) => cb(e.payload));
  const page = document.documentElement.dataset.page || 'soundboard';

  const LOGO = '<svg class="ez-mark" viewBox="24 58 222 124"><g fill="currentColor" transform="translate(120 120) skewX(-11) translate(-120 -120)"><rect x="40" y="65" width="22" height="110"/><rect x="40" y="65" width="70" height="22"/><rect x="40" y="109" width="54" height="22"/><rect x="40" y="153" width="70" height="22"/><rect x="122" y="65" width="78" height="22"/><rect x="122" y="153" width="78" height="22"/><polyline points="192,87 170,104 181,113 151,131 162,140 132,153" fill="none" stroke="currentColor" stroke-width="15" stroke-linejoin="miter" stroke-miterlimit="10"/></g></svg>';
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
    document.body.classList.add('ez-suite', 'ez-page-' + page);
    const existing = document.getElementById('titlebar');
    if (existing) {
      // The soundboard already has a title bar: add the tabs to it.
      existing.setAttribute('data-tauri-drag-region', '');
      existing.querySelectorAll('.brand, .flex').forEach((el) => el.setAttribute('data-tauri-drag-region', ''));
      const brand = existing.querySelector('.brand');
      const nav = document.createElement('div');
      nav.innerHTML = tabsHtml();
      brand.after(nav.firstElementChild);
      bindBar(existing);
    } else {
      const bar = document.createElement('header');
      bar.className = 'ez-bar';
      bar.setAttribute('data-tauri-drag-region', '');
      bar.innerHTML = `<div class="ez-brand" data-tauri-drag-region>${LOGO}<span data-tauri-drag-region>EZ SUITE</span></div>${tabsHtml()}<div class="ez-flex" data-tauri-drag-region></div>${WIN_BTNS}`;
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
  window.EZ = { invoke, listen, page };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { mount(); reportVisibility(); });
  else { mount(); reportVisibility(); }
})();

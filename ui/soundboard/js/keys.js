'use strict';
/* Hotkey helpers shared by the UI: combo strings look like "Ctrl+Shift+KeyA", "Numpad1", "Mouse4". */
const Keys = (() => {
  const MOD_CODES = new Set(['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);
  const NAMES = {
    Space: 'Space', Enter: 'Enter', NumpadEnter: 'Num Enter', Tab: 'Tab', Backspace: 'Bksp', Escape: 'Esc',
    Insert: 'Ins', Delete: 'Del', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Minus: '-', Equal: '=',
    BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',',
    Period: '.', Slash: '/', Backquote: '`', CapsLock: 'Caps', NumLock: 'NumLk', ScrollLock: 'ScrLk',
    PrintScreen: 'PrtSc', Pause: 'Pause', NumpadAdd: 'Num +', NumpadSubtract: 'Num -',
    NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadDecimal: 'Num .',
    ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl',
    AltLeft: 'L Alt', AltRight: 'R Alt', Mouse4: 'Mouse 4', Mouse5: 'Mouse 5'
  };

  function keyName(code) {
    let m;
    if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
    if ((m = /^Digit(\d)$/.exec(code))) return m[1];
    if ((m = /^Numpad(\d)$/.exec(code))) return 'Num ' + m[1];
    return NAMES[code] || code;
  }

  function label(combo) {
    if (!combo) return '';
    return combo.split('+').map((p) => (['Ctrl', 'Alt', 'Shift', 'Win'].includes(p) ? p : keyName(p))).join(' + ');
  }

  function mods(e) {
    return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Win'].filter(Boolean);
  }

  /** DOM mouse button -> our name (3 = back/Mouse4, 4 = forward/Mouse5). */
  function mouseName(button) {
    return button === 3 ? 'Mouse4' : button === 4 ? 'Mouse5' : null;
  }

  return { MOD_CODES, keyName, label, mods, mouseName };
})();

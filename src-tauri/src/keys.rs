//! Hotkey strings -> Windows virtual keys.
//!
//! Two formats are accepted, because the two halves of the app record keys differently:
//!  - soundboard: modifiers + KeyboardEvent.code, e.g. "Ctrl+Shift+KeyA", "Numpad1", "Mouse4"
//!  - crosshair:  Electron-style accelerators, e.g. "Shift+F9", "Ctrl+A", "Up", "num5"

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Combo {
    pub vk: u8,
    /// 0 = only non-extended, 1 = only extended, 2 = either (Enter vs Num Enter etc.)
    pub ext: u8,
    /// bit 1 Ctrl, 2 Alt, 4 Shift, 8 Win. Must match exactly.
    pub mods: u8,
    /// 0 = keyboard, 4 = Mouse 4 (back), 5 = Mouse 5 (forward)
    pub mouse: u8,
}

pub const MOD_CTRL: u8 = 1;
pub const MOD_ALT: u8 = 2;
pub const MOD_SHIFT: u8 = 4;
pub const MOD_WIN: u8 = 8;

fn code_vk(code: &str) -> Option<(u8, u8)> {
    let b = code.as_bytes();
    if let Some(c) = code.strip_prefix("Key") {
        if c.len() == 1 && c.as_bytes()[0].is_ascii_uppercase() {
            return Some((c.as_bytes()[0], 2));
        }
    }
    if let Some(d) = code.strip_prefix("Digit") {
        if d.len() == 1 && d.as_bytes()[0].is_ascii_digit() {
            return Some((0x30 + (d.as_bytes()[0] - b'0'), 2));
        }
    }
    if let Some(d) = code.strip_prefix("Numpad") {
        if d.len() == 1 && d.as_bytes()[0].is_ascii_digit() {
            return Some((0x60 + (d.as_bytes()[0] - b'0'), 2));
        }
    }
    if b.len() >= 2 && b[0] == b'F' {
        if let Ok(n) = code[1..].parse::<u8>() {
            if (1..=24).contains(&n) {
                return Some((0x6f + n, 2));
            }
        }
    }
    Some(match code {
        "Space" => (0x20, 2),
        "Enter" => (0x0d, 0),
        "NumpadEnter" => (0x0d, 1),
        "Tab" => (0x09, 2),
        "Backspace" => (0x08, 2),
        "Escape" => (0x1b, 2),
        "CapsLock" => (0x14, 2),
        "ShiftLeft" => (0xa0, 2),
        "ShiftRight" => (0xa1, 2),
        "ControlLeft" => (0xa2, 2),
        "ControlRight" => (0xa3, 2),
        "AltLeft" => (0xa4, 2),
        "AltRight" => (0xa5, 2),
        "MetaLeft" => (0x5b, 2),
        "MetaRight" => (0x5c, 2),
        "ContextMenu" => (0x5d, 2),
        "Backquote" => (0xc0, 2),
        "Minus" => (0xbd, 2),
        "Equal" => (0xbb, 2),
        "BracketLeft" => (0xdb, 2),
        "BracketRight" => (0xdd, 2),
        "Backslash" => (0xdc, 2),
        "IntlBackslash" => (0xe2, 2),
        "Semicolon" => (0xba, 2),
        "Quote" => (0xde, 2),
        "Comma" => (0xbc, 2),
        "Period" => (0xbe, 2),
        "Slash" => (0xbf, 2),
        // Extended only, so the numpad (with Num Lock off) doesn't trigger them.
        "Insert" => (0x2d, 1),
        "Delete" => (0x2e, 1),
        "Home" => (0x24, 1),
        "End" => (0x23, 1),
        "PageUp" => (0x21, 1),
        "PageDown" => (0x22, 1),
        "ArrowUp" => (0x26, 1),
        "ArrowDown" => (0x28, 1),
        "ArrowLeft" => (0x25, 1),
        "ArrowRight" => (0x27, 1),
        "NumpadMultiply" => (0x6a, 2),
        "NumpadAdd" => (0x6b, 2),
        "NumpadSubtract" => (0x6d, 2),
        "NumpadDecimal" => (0x6e, 2),
        "NumpadDivide" => (0x6f, 2),
        "NumLock" => (0x90, 2),
        "ScrollLock" => (0x91, 2),
        "Pause" => (0x13, 2),
        "PrintScreen" => (0x2c, 2),
        "MediaPlayPause" => (0xb3, 2),
        "MediaTrackNext" => (0xb0, 2),
        "MediaTrackPrevious" => (0xb1, 2),
        "MediaStop" => (0xb2, 2),
        _ => return None,
    })
}

/// Electron accelerator key names (what the crosshair editor records from KeyboardEvent.key).
fn accel_vk(key: &str) -> Option<(u8, u8)> {
    let lower = key.to_ascii_lowercase();
    if key.chars().count() == 1 {
        let c = key.chars().next().unwrap();
        if c.is_ascii_alphabetic() {
            return Some((c.to_ascii_uppercase() as u8, 2));
        }
        if c.is_ascii_digit() {
            return Some((c as u8, 2));
        }
        return char_vk(c).map(|v| (v, 2));
    }
    if let Some(d) = lower.strip_prefix("num") {
        if d.len() == 1 && d.as_bytes()[0].is_ascii_digit() {
            return Some((0x60 + (d.as_bytes()[0] - b'0'), 2));
        }
    }
    Some(match lower.as_str() {
        "space" => (0x20, 2),
        "enter" | "return" => (0x0d, 2),
        "tab" => (0x09, 2),
        "backspace" => (0x08, 2),
        "esc" | "escape" => (0x1b, 2),
        "insert" => (0x2d, 2),
        "delete" => (0x2e, 2),
        "home" => (0x24, 2),
        "end" => (0x23, 2),
        "pageup" => (0x21, 2),
        "pagedown" => (0x22, 2),
        "up" | "arrowup" => (0x26, 2),
        "down" | "arrowdown" => (0x28, 2),
        "left" | "arrowleft" => (0x25, 2),
        "right" | "arrowright" => (0x27, 2),
        "plus" => (0xbb, 2),
        "capslock" => (0x14, 2),
        "numlock" => (0x90, 2),
        "scrolllock" => (0x91, 2),
        "pause" => (0x13, 2),
        "printscreen" => (0x2c, 2),
        "contextmenu" => (0x5d, 2),
        "numadd" => (0x6b, 2),
        "numsub" => (0x6d, 2),
        "nummult" => (0x6a, 2),
        "numdiv" => (0x6f, 2),
        "numdec" => (0x6e, 2),
        "mediaplaypause" => (0xb3, 2),
        "medianexttrack" => (0xb0, 2),
        "mediaprevioustrack" => (0xb1, 2),
        "mediastop" => (0xb2, 2),
        "volumeup" | "audiovolumeup" => (0xaf, 2),
        "volumedown" | "audiovolumedown" => (0xae, 2),
        "volumemute" | "audiovolumemute" => (0xad, 2),
        _ => return None,
    })
}

#[cfg(windows)]
fn char_vk(c: char) -> Option<u8> {
    let mut buf = [0u16; 2];
    let s = c.encode_utf16(&mut buf);
    if s.len() != 1 {
        return None;
    }
    let r = unsafe { windows_sys::Win32::UI::Input::KeyboardAndMouse::VkKeyScanW(s[0]) };
    if r == -1 {
        None
    } else {
        Some((r & 0xff) as u8)
    }
}

#[cfg(not(windows))]
fn char_vk(_c: char) -> Option<u8> {
    None
}

pub fn parse(combo: &str) -> Option<Combo> {
    let combo = combo.trim();
    if combo.is_empty() || combo.len() > 60 {
        return None;
    }
    // "Ctrl++" means Ctrl and the plus key.
    let (body, plus_key) = if combo.ends_with("++") { (&combo[..combo.len() - 2], true) } else { (combo, false) };
    let mut parts: Vec<&str> = body.split('+').filter(|s| !s.is_empty()).collect();
    let key = if plus_key { "+" } else { parts.pop()? };
    let mut mods = 0u8;
    for m in parts {
        match m.to_ascii_lowercase().as_str() {
            "ctrl" | "control" | "commandorcontrol" | "cmdorctrl" => mods |= MOD_CTRL,
            "alt" | "option" | "altgr" => mods |= MOD_ALT,
            "shift" => mods |= MOD_SHIFT,
            "win" | "super" | "meta" | "cmd" | "command" => mods |= MOD_WIN,
            _ => return None,
        }
    }
    if let Some(n) = key.strip_prefix("Mouse") {
        return match n {
            "4" => Some(Combo { vk: 0, ext: 2, mods, mouse: 4 }),
            "5" => Some(Combo { vk: 0, ext: 2, mods, mouse: 5 }),
            _ => None,
        };
    }
    let (vk, ext) = code_vk(key).or_else(|| accel_vk(key))?;
    Some(Combo { vk, ext, mods, mouse: 0 })
}

// ---- Raw Input scan codes -> KeyboardEvent.code names (what the crosshair triggers use)

pub fn scan_to_code(scan: u16, e0: bool) -> Option<&'static str> {
    if e0 {
        return Some(match scan {
            0x1C => "NumpadEnter",
            0x1D => "ControlRight",
            0x35 => "NumpadDivide",
            0x37 => "PrintScreen",
            0x38 => "AltRight",
            0x45 => "NumLock",
            0x47 => "Home",
            0x48 => "ArrowUp",
            0x49 => "PageUp",
            0x4B => "ArrowLeft",
            0x4D => "ArrowRight",
            0x4F => "End",
            0x50 => "ArrowDown",
            0x51 => "PageDown",
            0x52 => "Insert",
            0x53 => "Delete",
            0x5B => "MetaLeft",
            0x5C => "MetaRight",
            0x5D => "ContextMenu",
            _ => return None,
        });
    }
    const DIGITS: [&str; 10] = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0"];
    const ROW1: [&str; 10] = ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP"];
    const ROW2: [&str; 9] = ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL"];
    const ROW3: [&str; 7] = ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM"];
    const FKEYS: [&str; 10] = ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10"];
    const FHIGH: [&str; 11] = ["F13", "F14", "F15", "F16", "F17", "F18", "F19", "F20", "F21", "F22", "F23"];
    let s = scan as usize;
    if (0x02..=0x0B).contains(&s) {
        return Some(DIGITS[s - 0x02]);
    }
    if (0x10..=0x19).contains(&s) {
        return Some(ROW1[s - 0x10]);
    }
    if (0x1E..=0x26).contains(&s) {
        return Some(ROW2[s - 0x1E]);
    }
    if (0x2C..=0x32).contains(&s) {
        return Some(ROW3[s - 0x2C]);
    }
    if (0x3B..=0x44).contains(&s) {
        return Some(FKEYS[s - 0x3B]);
    }
    if (0x64..=0x6E).contains(&s) {
        return Some(FHIGH[s - 0x64]);
    }
    Some(match scan {
        0x01 => "Escape",
        0x0C => "Minus",
        0x0D => "Equal",
        0x0E => "Backspace",
        0x0F => "Tab",
        0x1A => "BracketLeft",
        0x1B => "BracketRight",
        0x1C => "Enter",
        0x1D => "ControlLeft",
        0x27 => "Semicolon",
        0x28 => "Quote",
        0x29 => "Backquote",
        0x2A => "ShiftLeft",
        0x2B => "Backslash",
        0x33 => "Comma",
        0x34 => "Period",
        0x35 => "Slash",
        0x36 => "ShiftRight",
        0x37 => "NumpadMultiply",
        0x38 => "AltLeft",
        0x39 => "Space",
        0x3A => "CapsLock",
        0x45 => "NumLock",
        0x46 => "ScrollLock",
        0x47 => "Numpad7",
        0x48 => "Numpad8",
        0x49 => "Numpad9",
        0x4A => "NumpadSubtract",
        0x4B => "Numpad4",
        0x4C => "Numpad5",
        0x4D => "Numpad6",
        0x4E => "NumpadAdd",
        0x4F => "Numpad1",
        0x50 => "Numpad2",
        0x51 => "Numpad3",
        0x52 => "Numpad0",
        0x53 => "NumpadDecimal",
        0x56 => "IntlBackslash",
        0x57 => "F11",
        0x58 => "F12",
        0x76 => "F24",
        _ => return None,
    })
}

/// Push-to-talk keys: KeyboardEvent.code / "Mouse4" -> what SendInput needs.
pub enum PttKey {
    Key { vk: u8, ext: bool },
    Mouse { xbutton: u32 },
}

pub fn ptt_key(code: &str) -> Option<PttKey> {
    match code {
        "Mouse4" => return Some(PttKey::Mouse { xbutton: 1 }),
        "Mouse5" => return Some(PttKey::Mouse { xbutton: 2 }),
        _ => {}
    }
    let ext = matches!(
        code,
        "NumpadEnter"
            | "ControlRight"
            | "AltRight"
            | "Insert"
            | "Delete"
            | "Home"
            | "End"
            | "PageUp"
            | "PageDown"
            | "ArrowUp"
            | "ArrowDown"
            | "ArrowLeft"
            | "ArrowRight"
            | "NumpadDivide"
            | "NumLock"
            | "PrintScreen"
    );
    let (vk, _) = code_vk(code)?;
    Some(PttKey::Key { vk, ext })
}

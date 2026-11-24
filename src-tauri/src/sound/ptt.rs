//! Auto push-to-talk: holds your in-game / Discord voice key while a sound plays into the mic.
//! Sends both the virtual key and the hardware scan code, which is what games using raw input
//! (CS2, Valorant...) read. Straight SendInput calls: no helper process.
use crate::keys::{ptt_key, PttKey};
use parking_lot::Mutex;

static HELD: Mutex<Option<String>> = parking_lot::const_mutex(None);

pub fn down(code: &str) {
    if HELD.lock().is_some() {
        up();
    }
    if send(code, false) {
        *HELD.lock() = Some(code.to_string());
    }
}

pub fn up() {
    let held = HELD.lock().take();
    if let Some(code) = held {
        send(&code, true);
    }
}

pub fn is_held() -> bool {
    HELD.lock().is_some()
}

#[cfg(windows)]
fn send(code: &str, release: bool) -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
    let Some(k) = ptt_key(code) else { return false };
    unsafe {
        let mut input: INPUT = std::mem::zeroed();
        match k {
            PttKey::Key { vk, ext } => {
                input.r#type = INPUT_KEYBOARD;
                let scan = MapVirtualKeyW(vk as u32, MAPVK_VK_TO_VSC) as u16;
                let mut flags = 0;
                if ext {
                    flags |= KEYEVENTF_EXTENDEDKEY;
                }
                if release {
                    flags |= KEYEVENTF_KEYUP;
                }
                input.Anonymous.ki = KEYBDINPUT { wVk: vk as u16, wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 };
            }
            PttKey::Mouse { xbutton } => {
                input.r#type = INPUT_MOUSE;
                input.Anonymous.mi = MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: xbutton as _,
                    dwFlags: if release { MOUSEEVENTF_XUP } else { MOUSEEVENTF_XDOWN },
                    time: 0,
                    dwExtraInfo: 0,
                };
            }
        }
        SendInput(1, &input, std::mem::size_of::<INPUT>() as i32) == 1
    }
}

#[cfg(not(windows))]
fn send(code: &str, _release: bool) -> bool {
    ptt_key(code).is_some()
}

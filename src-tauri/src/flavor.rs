//! Which app this build is. The same backend builds three apps:
//!
//!   EZ Suite       (default)                       soundboard + crosshair
//!   EZ Reticle     `--features flavor-reticle`     crosshair only
//!   EZ Soundboard  `--features flavor-soundboard`  soundboard only
//!
//! The part a standalone app doesn't have is never started, so it costs nothing at runtime.

#[cfg(all(feature = "flavor-reticle", feature = "flavor-soundboard"))]
compile_error!("pick one of flavor-reticle / flavor-soundboard, not both");

/// Has the soundboard (audio engine, mic plugin, Stream Deck, sound hotkeys).
pub const SOUND: bool = !cfg!(feature = "flavor-reticle");
/// Has the crosshair (overlay, designer, per-game profiles).
pub const CROSSHAIR: bool = !cfg!(feature = "flavor-soundboard");

#[cfg(not(any(feature = "flavor-reticle", feature = "flavor-soundboard")))]
mod names {
    pub const ID: &str = "suite";
    pub const NAME: &str = "EZ Suite";
    pub const DATA_DIR: &str = "EZ Suite";
    pub const TRAY_PNG: &[u8] = include_bytes!("../icons/tray.png");
}

#[cfg(feature = "flavor-reticle")]
mod names {
    pub const ID: &str = "reticle";
    pub const NAME: &str = "EZ Reticle";
    // Not %APPDATA%\EZ Reticle: that folder belongs to the old Electron app (we import from it).
    pub const DATA_DIR: &str = "EZGGco\\EZ Reticle";
    pub const TRAY_PNG: &[u8] = include_bytes!("../icons/reticle/tray.png");
}

#[cfg(feature = "flavor-soundboard")]
mod names {
    pub const ID: &str = "soundboard";
    pub const NAME: &str = "EZ Soundboard";
    pub const DATA_DIR: &str = "EZGGco\\EZ Soundboard";
    pub const TRAY_PNG: &[u8] = include_bytes!("../icons/soundboard/tray.png");
}

pub use names::*;

/// True when this release asset is this app's installer.
/// EZ Suite keeps Tauri's name ("EZ.Suite_2.1.0_x64-setup.exe"), so EZ Suite 2.0.x, which takes
/// the first asset ending in "-setup.exe", keeps finding the right one. The standalone apps'
/// installers are renamed to "EZ-Reticle-Setup-2.1.0.exe" / "EZ-Soundboard-Setup-2.1.0.exe".
pub fn is_my_installer(asset_name: &str) -> bool {
    let n = asset_name.to_ascii_lowercase();
    match ID {
        "reticle" => n.starts_with("ez-reticle-setup-") && n.ends_with(".exe"),
        "soundboard" => n.starts_with("ez-soundboard-setup-") && n.ends_with(".exe"),
        _ => n.ends_with("-setup.exe") && n.contains("suite"),
    }
}

/// One EZ app at a time may run each part: two audio engines would both write into the mic
/// plugin, two overlays would draw two crosshairs. Returns the app that already has one.
#[cfg(windows)]
pub fn claim_parts() -> Result<(), String> {
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
    use windows_sys::Win32::System::Threading::CreateMutexW;
    fn claim(name: &str) -> bool {
        let w: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            let h = CreateMutexW(std::ptr::null(), 0, w.as_ptr());
            // The handle is kept for the life of the process on purpose.
            !h.is_null() && GetLastError() != ERROR_ALREADY_EXISTS
        }
    }
    if SOUND && !claim("Local\\EZGG.Part.Soundboard") {
        return Err("soundboard".into());
    }
    if CROSSHAIR && !claim("Local\\EZGG.Part.Crosshair") {
        return Err("crosshair".into());
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn claim_parts() -> Result<(), String> {
    Ok(())
}

/// Tells the user another EZ app already runs that part (before any window exists).
#[cfg(windows)]
pub fn explain_conflict(part: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONINFORMATION, MB_OK};
    let other = if part == "soundboard" { "EZ Suite or EZ Soundboard" } else { "EZ Suite or EZ Reticle" };
    let text = format!(
        "{other} is already running the {part}.\n\nOnly one of them can run it at a time. Quit the other one from its tray icon, then start {NAME} again."
    );
    let w = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let (t, c) = (w(&text), w(NAME));
    unsafe {
        MessageBoxW(std::ptr::null_mut(), t.as_ptr(), c.as_ptr(), MB_OK | MB_ICONINFORMATION);
    }
}

#[cfg(not(windows))]
pub fn explain_conflict(_part: &str) {}

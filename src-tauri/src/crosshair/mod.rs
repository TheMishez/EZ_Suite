//! EZ Reticle: crosshair overlay, saved crosshairs, per-game switching, hotkeys.
//!
//! How the overlay stays (almost) free while you play:
//!  - A static crosshair is shown by a tiny native layered window (still.rs) holding one bitmap.
//!    There is no browser engine behind it at all: Windows just keeps compositing it.
//!  - Only animated crosshairs (click/key triggers, GIF layers), the alignment guide, or an open
//!    designer use the webview overlay (ui/overlay), which draws with crosshair.js.
//!  - The bitmap is drawn by that same crosshair.js once (in a hidden webview that is closed
//!    straight after), so both modes look identical.
pub mod still;

use crate::input;
use crate::util::{self, clamp, jbool, jf64, jstr};
use parking_lot::Mutex;
use serde_json::{json, Map, Value};
use std::sync::mpsc;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const MIN_OVERLAY: f64 = 48.0;
const MAX_OVERLAY: f64 = 1000.0;
const OWN_PROCS: &[&str] = &["ez-suite", "ez suite", "ezsuite", "msedgewebview2", "ez reticle", "ez-reticle", "ez soundboard"];

#[derive(Clone, Copy, Default, PartialEq)]
struct Meta {
    radius: f64,
    animated: bool,
    moving: bool,
    known: bool,
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Mode {
    Hidden,
    Web,
    Still,
}

struct Xh {
    cfg: Value,
    meta: Meta,
    active_profile: Option<String>,
    guide: bool,
    guide_until: Option<Instant>,
    follow: Option<(f64, f64)>,
    game_front: bool,
    watcher_on: bool,
    auto_active: bool,
    revert: Option<(Value, Option<String>)>,
    editor_open: bool,
    hook_running: bool,
    /// What the still bitmap shows; it's only used while this matches still_key().
    still_have: String,
    capture_pending: Option<(String, Instant)>,
    mode: Mode,
    rect: (i32, i32, i32, i32),
    hotkeys_paused: bool,
}

static XH: OnceLock<Mutex<Xh>> = OnceLock::new();
static KICK: OnceLock<Mutex<mpsc::Sender<()>>> = OnceLock::new();

fn xh() -> parking_lot::MutexGuard<'static, Xh> {
    XH.get().expect("crosshair not initialised").lock()
}

fn cfg_path() -> std::path::PathBuf {
    util::data_dir().join("crosshair.json")
}

/// Asks the control thread to bring windows in line with the state (coalesced).
pub fn kick() {
    if let Some(k) = KICK.get() {
        let _ = k.lock().send(());
    }
}

// ------------------------------------------------------------------ config

fn exe_key(v: &str) -> String {
    let s = v.trim().to_lowercase();
    let s = s.strip_suffix(".exe").unwrap_or(&s).to_string();
    s.chars().filter(|c| c.is_ascii_alphanumeric() || " _.-".contains(*c)).take(60).collect()
}

fn blocked(n: &str) -> bool {
    matches!(n, "__proto__" | "constructor" | "prototype")
}

const TRIGGER_DEFAULTS: &[(&str, &[&str])] =
    &[("shoot", &["Mouse1"]), ("aim", &["Mouse2"]), ("reload", &["R"]), ("jump", &["Space"]), ("move", &["W", "A", "S", "D"]), ("run", &["Shift"])];

fn clean_triggers(t: Option<&Value>) -> Value {
    let re = regex::Regex::new(r"^[A-Za-z0-9+\-]{1,14}$").unwrap();
    let mut out = Map::new();
    for (id, def) in TRIGGER_DEFAULTS {
        let arr = t.and_then(|t| t.get(*id)).and_then(Value::as_array);
        let v: Vec<Value> = def
            .iter()
            .enumerate()
            .map(|(i, d)| {
                let s = arr.and_then(|a| a.get(i)).and_then(Value::as_str).filter(|s| re.is_match(s)).unwrap_or(d);
                Value::String(s.to_string())
            })
            .collect();
        out.insert(id.to_string(), Value::Array(v));
    }
    Value::Object(out)
}

fn clean_games(g: Option<&Value>) -> Value {
    let mut out = Map::new();
    if let Some(m) = g.and_then(Value::as_object) {
        for (k, v) in m {
            let key = exe_key(k);
            let Some(s) = v.as_str() else { continue };
            if key.is_empty() || blocked(&key) || s.is_empty() || out.len() >= 60 {
                continue;
            }
            out.insert(key, Value::String(s.chars().take(40).collect()));
        }
    }
    Value::Object(out)
}

fn clean_profile_hotkeys(raw: Option<&Value>, profiles: &Map<String, Value>) -> Value {
    let mut out = Map::new();
    let mut used = std::collections::HashSet::new();
    if let Some(m) = raw.and_then(Value::as_object) {
        for (k, v) in m {
            let Some(s) = v.as_str() else { continue };
            if !profiles.contains_key(k) || s.is_empty() || s.len() > 40 || !used.insert(s.to_string()) {
                continue;
            }
            out.insert(k.clone(), Value::String(s.to_string()));
        }
    }
    Value::Object(out)
}

fn normalize(raw: &Value) -> Value {
    let mut profiles = Map::new();
    if let Some(m) = raw.get("profiles").and_then(Value::as_object) {
        for (k, v) in m {
            let name: String = k.trim().chars().take(40).collect();
            if name.is_empty() || blocked(&name) || profiles.len() >= 200 || !v.is_object() {
                continue;
            }
            profiles.insert(name, v.clone());
        }
    }
    let fps = raw.get("fpsCap").and_then(Value::as_i64).filter(|v| [0, 30, 60, 120].contains(v)).unwrap_or(60);
    let accent = raw
        .get("accentColor")
        .and_then(Value::as_str)
        .filter(|s| s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit()))
        .map(|s| s.to_lowercase())
        .unwrap_or_else(|| "#fcc800".into());
    let mem = raw.get("memoryMode").and_then(Value::as_str).filter(|s| ["balanced", "low", "lowest"].contains(s)).unwrap_or("low");
    let hk = |k: &str, d: &str| raw.get(k).and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or(d).to_string();
    let phk = clean_profile_hotkeys(raw.get("profileHotkeys"), &profiles);
    json!({
        "crosshair": raw.get("crosshair").filter(|v| v.is_object()).cloned().unwrap_or(Value::Null),
        "displayMode": if jstr(raw, "displayMode") == "fullscreen" { "fullscreen" } else { "borderless" },
        "triggers": clean_triggers(raw.get("triggers")),
        "hotkeyNext": hk("hotkeyNext", "F9"),
        "hotkeyPrev": hk("hotkeyPrev", "Shift+F9"),
        "overlayScale": clamp(jf64(raw, "overlayScale", 1.0), 0.5, 3.0),
        "overlayOpacity": clamp(jf64(raw, "overlayOpacity", 1.0), 0.2, 1.0),
        "fpsCap": fps,
        "lowPriority": jbool(raw, "lowPriority", true),
        "startHidden": jbool(raw, "startHidden", false),
        "accentColor": accent,
        "memoryMode": mem,
        "overlayVisible": jbool(raw, "overlayVisible", true),
        "hotkey": hk("hotkey", "F8"),
        "displayId": raw.get("displayId").and_then(Value::as_i64).map(Value::from).unwrap_or(Value::Null),
        "autoStart": jbool(raw, "autoStart", false),
        "overlayOffsetX": clamp(jf64(raw, "overlayOffsetX", 0.0), -100.0, 100.0).round(),
        "overlayOffsetY": clamp(jf64(raw, "overlayOffsetY", 0.0), -100.0, 100.0).round(),
        "autoSwitch": jbool(raw, "autoSwitch", false),
        "gameOnly": jbool(raw, "gameOnly", false),
        "hideFromCapture": jbool(raw, "hideFromCapture", false),
        "onboarded": jbool(raw, "onboarded", false),
        "autoRevert": jbool(raw, "autoRevert", true),
        "followWindow": jbool(raw, "followWindow", false),
        "gameProfiles": clean_games(raw.get("gameProfiles")),
        "profileHotkeys": phk,
        "profiles": Value::Object(profiles),
    })
}

fn load_config() -> Value {
    let p = cfg_path();
    if let Some(v) = util::read_json(&p) {
        return normalize(&v);
    }
    if p.exists() {
        let _ = std::fs::copy(&p, p.with_extension("json.corrupt"));
    }
    // First start: bring over everything from the standalone EZ Reticle (or its old name).
    for old in ["EZ Reticle", "Mishez Xhair"] {
        if let Some(dir) = util::old_app_dir(old) {
            if let Some(mut v) = util::read_json(&dir.join("settings.json")) {
                // Electron display ids don't mean anything here: use the primary display.
                if let Some(o) = v.as_object_mut() {
                    o.insert("displayId".into(), Value::Null);
                }
                let n = normalize(&v);
                let _ = util::write_json_atomic(&p, &n, true);
                return n;
            }
        }
    }
    normalize(&json!({}))
}

fn save_now(cfg: &Value) {
    if let Err(e) = util::write_json_atomic(&cfg_path(), cfg, true) {
        util::log(format!("crosshair save failed: {e}"));
    }
}

static SAVE_AT: Mutex<Option<Instant>> = parking_lot::const_mutex(None);
fn save_soon() {
    *SAVE_AT.lock() = Some(Instant::now() + Duration::from_millis(300));
    kick();
}

// ------------------------------------------------------------------ public state

fn public_state(x: &Xh) -> Value {
    let c = &x.cfg;
    json!({
        "overlayVisible": c["overlayVisible"],
        "hotkey": c["hotkey"],
        "displayId": c["displayId"],
        "displayMode": c["displayMode"],
        "triggers": c["triggers"],
        "hotkeyNext": c["hotkeyNext"],
        "hotkeyPrev": c["hotkeyPrev"],
        "overlayScale": c["overlayScale"],
        "overlayOpacity": c["overlayOpacity"],
        "fpsCap": c["fpsCap"],
        "lowPriority": c["lowPriority"],
        "startHidden": c["startHidden"],
        "accentColor": c["accentColor"],
        "memoryMode": c["memoryMode"],
        "memoryActive": c["memoryMode"],
        "autoStart": c["autoStart"],
        "overlayOffsetX": c["overlayOffsetX"],
        "overlayOffsetY": c["overlayOffsetY"],
        "autoSwitch": c["autoSwitch"],
        "gameOnly": c["gameOnly"],
        "hideFromCapture": c["hideFromCapture"],
        "onboarded": c["onboarded"],
        "gameFront": x.game_front,
        "checkUpdates": crate::updater::enabled(),
        "update": crate::updater::reticle_view(),
        "version": util::app_version(),
        "autoRevert": c["autoRevert"],
        "followWindow": c["followWindow"],
        "gameProfiles": c["gameProfiles"],
        "guide": x.guide,
        "watcherOn": x.watcher_on,
        "profiles": c["profiles"],
        "profileHotkeys": c["profileHotkeys"],
        "activeProfile": x.active_profile,
        "hookState": if x.hook_running { "running" } else { "off" },
        "inputMode": if x.hook_running { Value::from("native") } else { Value::Null },
        "watcherMode": if x.watcher_on { Value::from("native") } else { Value::Null },
        "isPackaged": !cfg!(debug_assertions),
        "overlayMode": format!("{:?}", x.mode).to_lowercase(),
    })
}

pub fn broadcast_state() {
    let s = public_state(&xh());
    util::emit("xh-state", s);
}

fn public_config(x: &Xh) -> Value {
    let mut s = public_state(x);
    s["crosshair"] = x.cfg["crosshair"].clone();
    s
}

// ------------------------------------------------------------------ init

pub fn init() {
    let cfg = load_config();
    let _ = XH.set(Mutex::new(Xh {
        cfg,
        meta: Meta::default(),
        active_profile: None,
        guide: false,
        guide_until: None,
        follow: None,
        game_front: false,
        watcher_on: false,
        auto_active: false,
        revert: None,
        editor_open: false,
        hook_running: false,
        still_have: String::new(),
        capture_pending: None,
        mode: Mode::Hidden,
        rect: (0, 0, 0, 0),
        hotkeys_paused: false,
    }));
    let (tx, rx) = mpsc::channel::<()>();
    let _ = KICK.set(Mutex::new(tx));
    std::thread::Builder::new().name("xh-ctl".into()).spawn(move || control_loop(rx)).expect("xh thread");
    register_hotkeys();
    sync_watcher();
    kick();
}

pub fn shutdown() {
    let cfg = xh().cfg.clone();
    save_now(&cfg);
    still::destroy();
}

pub fn start_hidden() -> bool {
    jbool(&xh().cfg, "startHidden", false)
}

/// The main window tells us whether the crosshair designer is on screen.
pub fn set_editor_open(open: bool) {
    let changed = {
        let mut x = xh();
        let c = x.editor_open != open;
        x.editor_open = open;
        c
    };
    if changed {
        sync_hook();
        crate::perf::refresh();
        kick();
    }
}

// ------------------------------------------------------------------ control thread

fn control_loop(rx: mpsc::Receiver<()>) {
    let mut last_top = Instant::now();
    let mut last_reconcile = Instant::now() - Duration::from_secs(10);
    loop {
        // Wake on a kick, or for the topmost / guide / save timers.
        let kicked = rx.recv_timeout(Duration::from_millis(250)).is_ok();
        while rx.try_recv().is_ok() {}
        let guide_due = xh().guide_until.is_some();
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            if kicked || guide_due || last_reconcile.elapsed() > Duration::from_secs(2) {
                last_reconcile = Instant::now();
                reconcile();
            }
            let due = SAVE_AT.lock().map(|t| Instant::now() >= t).unwrap_or(false);
            if due {
                *SAVE_AT.lock() = None;
                let cfg = xh().cfg.clone();
                save_now(&cfg);
            }
        }));
        if r.is_err() {
            util::log("crosshair control loop panicked");
        }
        // Some games grab the topmost slot: keep taking it back (more often in "fullscreen" mode).
        let (mode, fullscreen) = {
            let x = xh();
            (x.mode, jstr(&x.cfg, "displayMode") == "fullscreen")
        };
        let every = if fullscreen { 500 } else { 5000 };
        if mode != Mode::Hidden && last_top.elapsed() >= Duration::from_millis(every) {
            last_top = Instant::now();
            reassert_top(mode);
        }
    }
}

/// Identifies what a still bitmap shows (design + scale + size), as a short hash.
fn still_key(x: &Xh) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    x.cfg["crosshair"].to_string().hash(&mut h);
    x.cfg["overlayScale"].to_string().hash(&mut h);
    x.rect.2.hash(&mut h);
    format!("{:016x}", h.finish())
}

fn want_visible(x: &Xh) -> bool {
    let game_ok = !jbool(&x.cfg, "gameOnly", false) || !x.watcher_on || x.game_front;
    jbool(&x.cfg, "overlayVisible", true) && game_ok
}

fn reconcile() {
    // guide auto-off after 15 s
    let guide_expired = { xh().guide_until.map(|t| Instant::now() >= t).unwrap_or(false) };
    if guide_expired {
        {
            let mut x = xh();
            x.guide = false;
            x.guide_until = None;
        }
        broadcast_state();
    }

    let rect = overlay_rect(&xh());
    xh().rect = rect;
    let (visible, needs_web, have_still, key, opacity, capture_wait) = {
        let x = xh();
        let key = still_key(&x);
        let needs_web = !x.meta.known || x.meta.animated || x.meta.moving || x.guide || x.editor_open;
        let pending = x.capture_pending.as_ref().map(|(k, t)| k == &key && t.elapsed() < Duration::from_secs(5)).unwrap_or(false);
        (want_visible(&x), needs_web, x.still_have == key, key, jf64(&x.cfg, "overlayOpacity", 1.0), pending)
    };
    let hide_capture = jbool(&xh().cfg, "hideFromCapture", false);

    let target = if !visible {
        Mode::Hidden
    } else if needs_web || !have_still {
        Mode::Web
    } else {
        Mode::Still
    };

    match target {
        Mode::Web => {
            // A static design without a bitmap yet: render it in the (hidden) webview first.
            let capturing = !needs_web && !have_still;
            ensure_overlay_window(rect, !capturing, hide_capture);
            if capturing {
                if !capture_wait {
                    xh().capture_pending = Some((key.clone(), Instant::now()));
                    let scale = monitor_scale_at(rect);
                    util::emit_to("overlay", "xh-capture", json!({ "key": key, "size": rect.2, "scale": scale }));
                }
                // Keep showing the last bitmap (if any) until the new one arrives.
                if xh().mode == Mode::Still {
                    still::show(rect, opacity, hide_capture);
                    return;
                }
            } else {
                still::hide();
            }
            xh().mode = if capturing { Mode::Hidden } else { Mode::Web };
        }
        Mode::Still => {
            still::show(rect, opacity, hide_capture);
            close_overlay_window();
            xh().mode = Mode::Still;
        }
        Mode::Hidden => {
            still::hide();
            let keep = { xh().editor_open };
            if keep {
                hide_overlay_window();
            } else {
                close_overlay_window();
            }
            xh().mode = Mode::Hidden;
        }
    }
}

// ------------------------------------------------------------------ overlay geometry

/// The overlay is sized to the crosshair (never full screen): the compositor only ever handles a
/// few thousand pixels. Side in DIPs, rounded to 16 so slider drags don't resize it constantly.
fn desired_size(x: &Xh) -> f64 {
    let r = if x.meta.known { x.meta.radius } else { 60.0 };
    let r = r * jf64(&x.cfg, "overlayScale", 1.0) * 1.1 + 6.0;
    let side = ((r * 2.0) / 16.0).ceil() * 16.0;
    side.max(MIN_OVERLAY).min(MAX_OVERLAY)
}

fn overlay_rect(x: &Xh) -> (i32, i32, i32, i32) {
    let mons = monitors();
    let idx = x.cfg["displayId"].as_i64().map(|i| i as usize);
    let m = idx.and_then(|i| mons.get(i)).or_else(|| mons.iter().find(|m| m.primary)).or_else(|| mons.first()).cloned().unwrap_or(Monitor {
        x: 0,
        y: 0,
        w: 1920,
        h: 1080,
        scale: 1.0,
        primary: true,
    });
    let (mut cx, mut cy, mut sf) = (m.x as f64 + m.w as f64 / 2.0, m.y as f64 + m.h as f64 / 2.0, m.scale);
    if let Some((fx, fy)) = x.follow {
        cx = fx;
        cy = fy;
        if let Some(fm) = mons.iter().find(|m| fx >= m.x as f64 && fx < (m.x + m.w) as f64 && fy >= m.y as f64 && fy < (m.y + m.h) as f64) {
            sf = fm.scale;
        }
    }
    cx += jf64(&x.cfg, "overlayOffsetX", 0.0);
    cy += jf64(&x.cfg, "overlayOffsetY", 0.0);
    let mut side = (desired_size(x) * sf).round() as i32;
    if side % 2 == 1 {
        side += 1; // even, so the centre sits exactly between two pixels like the screen's centre
    }
    ((cx - side as f64 / 2.0).round() as i32, (cy - side as f64 / 2.0).round() as i32, side, side)
}

fn monitor_scale_at(r: (i32, i32, i32, i32)) -> f64 {
    let (cx, cy) = (r.0 + r.2 / 2, r.1 + r.3 / 2);
    monitors().into_iter().find(|m| cx >= m.x && cx < m.x + m.w && cy >= m.y && cy < m.y + m.h).map(|m| m.scale).unwrap_or(1.0)
}

#[derive(Clone)]
pub struct Monitor {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    pub scale: f64,
    pub primary: bool,
}

#[cfg(windows)]
pub fn monitors() -> Vec<Monitor> {
    use windows_sys::Win32::Foundation::{LPARAM, RECT};
    use windows_sys::Win32::Graphics::Gdi::*;
    use windows_sys::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
    unsafe extern "system" fn cb(hm: HMONITOR, _dc: HDC, _r: *mut RECT, data: LPARAM) -> i32 {
        let out = &mut *(data as *mut Vec<Monitor>);
        let mut mi: MONITORINFO = std::mem::zeroed();
        mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(hm, &mut mi) != 0 {
            let (mut dx, mut dy) = (96u32, 96u32);
            let _ = GetDpiForMonitor(hm, MDT_EFFECTIVE_DPI, &mut dx, &mut dy);
            let r = mi.rcMonitor;
            out.push(Monitor { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top, scale: dx.max(48) as f64 / 96.0, primary: mi.dwFlags & 1 != 0 });
        }
        1
    }
    let mut v: Vec<Monitor> = Vec::new();
    unsafe {
        EnumDisplayMonitors(std::ptr::null_mut(), std::ptr::null(), Some(cb), &mut v as *mut _ as LPARAM);
    }
    // Primary first, then left to right: stable "Display 1, 2..." numbering.
    v.sort_by_key(|m| (!m.primary, m.x, m.y));
    v
}

#[cfg(not(windows))]
pub fn monitors() -> Vec<Monitor> {
    Vec::new()
}

// ------------------------------------------------------------------ the webview overlay

static OVERLAY_HWND: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);
static LAST_PLACE: Mutex<Option<(isize, (i32, i32, i32, i32), bool, bool)>> = parking_lot::const_mutex(None);

fn overlay_hwnd() -> Option<isize> {
    let h = OVERLAY_HWND.load(std::sync::atomic::Ordering::Acquire);
    (h != 0).then_some(h)
}

fn ensure_overlay_window(rect: (i32, i32, i32, i32), show: bool, hide_capture: bool) {
    let app = util::app();
    if app.get_webview_window("overlay").is_none() {
        let built = WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("overlay/overlay.html".into()))
            .title("EZ Crosshair")
            .transparent(true)
            .decorations(false)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .focused(false)
            .visible(false)
            .inner_size(rect.2 as f64, rect.3 as f64)
            .additional_browser_args(&crate::browser_args())
            .build();
        match built {
            Ok(w) => {
                let _ = w.set_ignore_cursor_events(true);
                if let Ok(h) = w.hwnd() {
                    win::make_overlay_style(h.0 as isize);
                    OVERLAY_HWND.store(h.0 as isize, std::sync::atomic::Ordering::Release);
                    *LAST_PLACE.lock() = None;
                }
            }
            Err(e) => {
                util::log(format!("overlay window failed: {e}"));
                return;
            }
        }
    }
    if let Some(h) = overlay_hwnd() {
        let want = (h, rect, show, hide_capture);
        let mut last = LAST_PLACE.lock();
        if *last != Some(want) {
            *last = Some(want);
            drop(last);
            win::set_capture_hidden(h, hide_capture);
            win::place(h, rect, show);
        }
    }
}

fn hide_overlay_window() {
    if let Some(h) = overlay_hwnd() {
        let mut last = LAST_PLACE.lock();
        if last.map(|l| l.2).unwrap_or(true) {
            *last = Some((h, (0, 0, 0, 0), false, false));
            drop(last);
            win::hide(h);
        }
    }
}

fn close_overlay_window() {
    if OVERLAY_HWND.swap(0, std::sync::atomic::Ordering::AcqRel) == 0 && util::app().get_webview_window("overlay").is_none() {
        return;
    }
    *LAST_PLACE.lock() = None;
    if let Some(w) = util::app().get_webview_window("overlay") {
        let _ = w.destroy();
    }
}

fn reassert_top(mode: Mode) {
    match mode {
        Mode::Web => {
            if let Some(h) = overlay_hwnd() {
                win::top(h);
            }
        }
        Mode::Still => still::top(),
        Mode::Hidden => {}
    }
}

pub mod win {
    //! Win32 window tweaks for the overlay windows (both the webview one and the native one).
    #[cfg(windows)]
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    #[cfg(windows)]
    pub fn make_overlay_style(h: isize) {
        unsafe {
            let hwnd = h as windows_sys::Win32::Foundation::HWND;
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let add = (WS_EX_TRANSPARENT | WS_EX_LAYERED | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TOPMOST) as isize;
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, (ex | add) & !(WS_EX_APPWINDOW as isize));
        }
    }

    #[cfg(windows)]
    pub fn place(h: isize, r: (i32, i32, i32, i32), show: bool) {
        unsafe {
            let hwnd = h as windows_sys::Win32::Foundation::HWND;
            let flags = SWP_NOACTIVATE | if show { SWP_SHOWWINDOW } else { 0 };
            SetWindowPos(hwnd, HWND_TOPMOST, r.0, r.1, r.2, r.3, flags);
            if show {
                ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            }
        }
    }

    #[cfg(windows)]
    pub fn top(h: isize) {
        unsafe {
            let hwnd = h as windows_sys::Win32::Foundation::HWND;
            if IsWindowVisible(hwnd) != 0 {
                SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE);
            }
        }
    }

    #[cfg(windows)]
    pub fn hide(h: isize) {
        unsafe {
            ShowWindow(h as windows_sys::Win32::Foundation::HWND, SW_HIDE);
        }
    }

    /// Keeps the crosshair out of OBS, Discord screen share and screenshots (Windows 10 2004+).
    #[cfg(windows)]
    pub fn set_capture_hidden(h: isize, on: bool) {
        unsafe {
            SetWindowDisplayAffinity(h as windows_sys::Win32::Foundation::HWND, if on { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE });
        }
    }

    #[cfg(not(windows))]
    pub fn make_overlay_style(_h: isize) {}
    #[cfg(not(windows))]
    pub fn place(_h: isize, _r: (i32, i32, i32, i32), _show: bool) {}
    #[cfg(not(windows))]
    pub fn top(_h: isize) {}
    #[cfg(not(windows))]
    pub fn hide(_h: isize) {}
    #[cfg(not(windows))]
    pub fn set_capture_hidden(_h: isize, _on: bool) {}
}

// ------------------------------------------------------------------ design changes

fn apply_design(design: Value, profile: Option<String>) {
    {
        let mut x = xh();
        x.active_profile = profile;
        if x.cfg["crosshair"] != design {
            x.cfg["crosshair"] = design.clone();
            x.meta.known = false;
        }
    }
    util::emit("xh-crosshair", design);
    save_soon();
    broadcast_state();
}

fn cycle_profile(dir: i32) {
    let (names, active) = {
        let x = xh();
        let mut n: Vec<String> = x.cfg["profiles"].as_object().map(|m| m.keys().cloned().collect()).unwrap_or_default();
        n.sort_by_key(|a| a.to_lowercase());
        (n, x.active_profile.clone())
    };
    if names.is_empty() {
        return;
    }
    let i = active.as_ref().and_then(|a| names.iter().position(|n| n == a));
    let len = names.len() as i32;
    let next = match i {
        None => {
            if dir > 0 {
                0
            } else {
                len - 1
            }
        }
        Some(i) => (i as i32 + dir + len) % len,
    } as usize;
    let name = names[next].clone();
    let design = xh().cfg["profiles"][&name].clone();
    apply_design(design, Some(name));
}

fn set_overlay_visible(v: bool) {
    xh().cfg["overlayVisible"] = Value::Bool(v);
    sync_hook();
    crate::tray::refresh();
    save_soon();
    broadcast_state();
}

pub fn toggle_overlay() {
    let v = jbool(&xh().cfg, "overlayVisible", true);
    set_overlay_visible(!v);
}

pub fn overlay_visible() -> bool {
    jbool(&xh().cfg, "overlayVisible", true)
}

// ------------------------------------------------------------------ hotkeys

fn register_hotkeys() {
    let (binds, paused) = {
        let x = xh();
        let c = &x.cfg;
        let mut b: Vec<(String, String)> = Vec::new();
        for (field, action) in [("hotkey", "toggle"), ("hotkeyNext", "next"), ("hotkeyPrev", "prev")] {
            let a = jstr(c, field);
            if !a.is_empty() {
                b.push((a.to_string(), action.to_string()));
            }
        }
        let taken: Vec<String> = b.iter().map(|(a, _)| a.clone()).collect();
        if let Some(m) = c["profileHotkeys"].as_object() {
            for (name, acc) in m {
                let Some(acc) = acc.as_str() else { continue };
                if taken.iter().any(|t| t == acc) || c["profiles"].get(name).is_none() {
                    continue;
                }
                b.push((acc.to_string(), format!("profile:{name}")));
            }
        }
        (b, x.hotkeys_paused)
    };
    input::set_hotkeys("xh", &binds);
    input::suspend("xh", paused);
}

pub fn on_hotkey(action: &str) {
    match action {
        "toggle" => toggle_overlay(),
        "next" => cycle_profile(1),
        "prev" => cycle_profile(-1),
        a => {
            if let Some(name) = a.strip_prefix("profile:") {
                let d = xh().cfg["profiles"].get(name).cloned();
                if let Some(d) = d {
                    apply_design(d, Some(name.to_string()));
                }
            }
        }
    }
}

// ------------------------------------------------------------------ animation input

/// Listens to clicks/keys only while a click/key animation is selected and something shows it.
fn sync_hook() {
    let (want, was) = {
        let x = xh();
        (x.meta.animated && (jbool(&x.cfg, "overlayVisible", true) || x.editor_open), x.hook_running)
    };
    if want != was {
        xh().hook_running = want;
        input::set_trigger_listen(want);
        crate::perf::refresh();
        broadcast_state();
    }
}

pub fn animation_listening() -> bool {
    XH.get().map(|x| x.lock().hook_running).unwrap_or(false)
}

pub fn on_input(code: &'static str, down: bool) {
    if !xh().meta.animated {
        return;
    }
    util::emit("xh-input", json!({ "code": code, "down": down }));
}

// ------------------------------------------------------------------ per-game profiles + follow

fn want_watcher(c: &Value) -> bool {
    (jbool(c, "autoSwitch", false) || jbool(c, "followWindow", false) || jbool(c, "gameOnly", false))
        && c["gameProfiles"].as_object().map(|m| !m.is_empty()).unwrap_or(false)
}

fn stop_watcher() {
    input::foreground_watch(false);
    let revert = {
        let mut x = xh();
        x.watcher_on = false;
        x.follow = None;
        x.game_front = false;
        let r = if x.auto_active && jbool(&x.cfg, "autoRevert", true) { x.revert.clone() } else { None };
        x.auto_active = false;
        r
    };
    if let Some((d, p)) = revert {
        apply_design(d, p);
    }
}

fn sync_watcher() {
    let (want, on) = {
        let x = xh();
        (want_watcher(&x.cfg), x.watcher_on)
    };
    if want && !on {
        xh().watcher_on = true;
        input::foreground_watch(true);
    } else if !want && on {
        stop_watcher();
    }
    kick();
    broadcast_state();
}

pub fn on_foreground(name: &str, x0: i32, y0: i32, w: i32, h: i32) {
    let name = exe_key(name);
    let own = std::env::current_exe().ok().and_then(|p| p.file_stem().map(|s| s.to_string_lossy().to_lowercase())).unwrap_or_default();
    if name.is_empty() || name == own || OWN_PROCS.contains(&name.as_str()) {
        return; // ignore our own windows
    }
    let mut changed_vis = false;
    let mut apply: Option<(Value, Option<String>)> = None;
    {
        let mut x = xh();
        if !x.watcher_on {
            return;
        }
        let listed = x.cfg["gameProfiles"].get(&name).and_then(Value::as_str).map(str::to_string);
        let prof = listed.clone().filter(|p| p != "*");
        if x.game_front != listed.is_some() {
            x.game_front = listed.is_some();
            changed_vis = jbool(&x.cfg, "gameOnly", false);
        }
        if jbool(&x.cfg, "autoSwitch", false) {
            match prof.and_then(|p| x.cfg["profiles"].get(&p).cloned().map(|d| (p, d))) {
                Some((p, d)) => {
                    if !x.auto_active {
                        x.revert = Some((x.cfg["crosshair"].clone(), x.active_profile.clone()));
                    }
                    if !x.auto_active || x.active_profile.as_deref() != Some(&p) {
                        apply = Some((d, Some(p)));
                    }
                    x.auto_active = true;
                }
                None => {
                    if x.auto_active {
                        x.auto_active = false;
                        if jbool(&x.cfg, "autoRevert", true) {
                            apply = x.revert.clone();
                        }
                    }
                }
            }
        }
        if jbool(&x.cfg, "followWindow", false) && listed.is_some() {
            if w >= 200 && h >= 200 {
                let next = (x0 as f64 + w as f64 / 2.0, y0 as f64 + h as f64 / 2.0);
                if x.follow != Some(next) {
                    x.follow = Some(next);
                }
            }
        } else {
            x.follow = None;
        }
    }
    if let Some((d, p)) = apply {
        apply_design(d, p);
    }
    if changed_vis {
        broadcast_state();
    }
    kick();
}

// ------------------------------------------------------------------ commands

#[tauri::command]
pub fn xh_get_config() -> Value {
    public_config(&xh())
}

/// From the overlay: what the current design needs (crosshair.js knows, Rust doesn't parse designs).
#[tauri::command]
pub fn xh_report_meta(design: Value, radius: f64, animated: bool, moving: bool) {
    {
        let mut x = xh();
        if x.cfg["crosshair"] != design {
            return; // an old design; a newer report is on its way
        }
        x.meta = Meta { radius: radius.max(1.0).min(2000.0), animated, moving, known: true };
        // A (re)loaded overlay page reports first: ask it for the still bitmap again if needed.
        x.capture_pending = None;
    }
    sync_hook();
    kick();
}

/// From the overlay: the static design drawn at the overlay's exact size (RGBA, not premultiplied).
#[tauri::command]
pub fn xh_still_frame(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let h = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).map(str::to_string);
    let w: usize = h("x-w").and_then(|s| s.parse().ok()).ok_or("no width")?;
    let hh: usize = h("x-h").and_then(|s| s.parse().ok()).ok_or("no height")?;
    let key = h("x-key").unwrap_or_default();
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else { return Err("expected raw bytes".into()) };
    if w == 0 || hh == 0 || w > 4096 || hh > 4096 || data.len() != w * hh * 4 {
        return Err("bad frame".into());
    }
    {
        let x = xh();
        if still_key(&x) != key {
            return Ok(()); // out of date
        }
    }
    still::set_bitmap(w as i32, hh as i32, data);
    {
        let mut x = xh();
        x.still_have = key;
        x.capture_pending = None;
    }
    kick();
    Ok(())
}

#[tauri::command]
pub fn xh_set_crosshair(design: Value) -> Value {
    {
        let mut x = xh();
        if x.cfg["crosshair"] != design {
            x.cfg["crosshair"] = design.clone();
            x.meta.known = false;
        }
    }
    // Only the overlay: the designer sent this itself (echoing it back would fight the sliders).
    util::emit_to("overlay", "xh-crosshair", design.clone());
    save_soon();
    design
}

#[tauri::command]
pub fn xh_save_profile(name: String, design: Value) -> Value {
    let n: String = name.trim().chars().take(40).collect();
    if n.is_empty() || blocked(&n) {
        return json!({ "ok": false });
    }
    {
        let mut x = xh();
        if let Some(m) = x.cfg["profiles"].as_object_mut() {
            m.insert(n.clone(), design);
        }
        x.active_profile = Some(n);
    }
    save_soon();
    broadcast_state();
    json!({ "ok": true })
}

#[tauri::command]
pub fn xh_load_profile(name: String) -> Value {
    let d = xh().cfg["profiles"].get(&name).cloned();
    match d {
        Some(d) => {
            {
                let mut x = xh();
                x.cfg["crosshair"] = d.clone();
                x.active_profile = Some(name);
                x.meta.known = false;
            }
            util::emit_to("overlay", "xh-crosshair", d.clone());
            save_soon();
            d
        }
        None => Value::Null,
    }
}

#[tauri::command]
pub fn xh_delete_profile(name: String) -> bool {
    let had_hk = {
        let mut x = xh();
        if let Some(m) = x.cfg["profiles"].as_object_mut() {
            m.remove(&name);
        }
        x.cfg["profileHotkeys"].as_object_mut().map(|m| m.remove(&name).is_some()).unwrap_or(false)
    };
    if had_hk {
        register_hotkeys();
    }
    save_soon();
    broadcast_state();
    true
}

#[tauri::command]
pub fn xh_set_profile_hotkey(name: String, accel: Option<String>) -> Value {
    let done = |ok: bool, err: Option<String>| {
        broadcast_state();
        json!({ "ok": ok, "error": err, "profileHotkeys": xh().cfg["profileHotkeys"] })
    };
    if xh().cfg["profiles"].get(&name).is_none() {
        return done(false, Some("Save this crosshair first".into()));
    }
    let Some(accel) = accel.filter(|a| !a.is_empty()) else {
        if let Some(m) = xh().cfg["profileHotkeys"].as_object_mut() {
            m.remove(&name);
        }
        register_hotkeys();
        save_soon();
        return done(true, None);
    };
    if accel.len() > 40 || crate::keys::parse(&accel).is_none() {
        return done(false, Some("Could not use that shortcut".into()));
    }
    {
        let x = xh();
        if ["hotkey", "hotkeyNext", "hotkeyPrev"].iter().any(|f| jstr(&x.cfg, f) == accel) {
            drop(x);
            return done(false, Some(format!("{accel} is already used by an app hotkey")));
        }
        let other = x.cfg["profileHotkeys"]
            .as_object()
            .and_then(|m| m.iter().find(|(k, v)| k.as_str() != name.as_str() && v.as_str() == Some(accel.as_str())).map(|(k, _)| k.clone()));
        drop(x);
        if let Some(o) = other {
            return done(false, Some(format!("{accel} already equips \u{201c}{o}\u{201d}")));
        }
    }
    if let Some(m) = xh().cfg["profileHotkeys"].as_object_mut() {
        m.insert(name, Value::String(accel));
    }
    register_hotkeys();
    save_soon();
    done(true, None)
}

#[tauri::command]
pub fn xh_set_triggers(triggers: Value) -> Value {
    let t = clean_triggers(Some(&triggers));
    xh().cfg["triggers"] = t.clone();
    save_soon();
    broadcast_state();
    t
}

#[tauri::command]
pub fn xh_set_mode(mode: String) -> String {
    let m = if mode == "fullscreen" { "fullscreen" } else { "borderless" };
    xh().cfg["displayMode"] = Value::from(m);
    save_soon();
    broadcast_state();
    m.to_string()
}

#[tauri::command]
pub fn xh_set_overlay(visible: bool) -> bool {
    set_overlay_visible(visible);
    visible
}

#[tauri::command]
pub fn xh_set_hotkey(accel: String, which: Option<String>) -> Value {
    let field = match which.as_deref().unwrap_or("toggle") {
        "toggle" => "hotkey",
        "next" => "hotkeyNext",
        "prev" => "hotkeyPrev",
        _ => "",
    };
    let mut ok = false;
    if !field.is_empty() && !accel.is_empty() && accel.len() <= 40 && crate::keys::parse(&accel).is_some() {
        let clash = {
            let x = xh();
            ["hotkey", "hotkeyNext", "hotkeyPrev"].iter().any(|f| *f != field && jstr(&x.cfg, f) == accel)
        };
        if !clash {
            xh().cfg[field] = Value::String(accel);
            register_hotkeys();
            save_soon();
            ok = true;
        }
    }
    broadcast_state();
    let x = xh();
    json!({ "ok": ok, "hotkeys": { "toggle": x.cfg["hotkey"], "next": x.cfg["hotkeyNext"], "prev": x.cfg["hotkeyPrev"] } })
}

#[tauri::command]
pub fn xh_pause_hotkey(pause: bool) -> bool {
    xh().hotkeys_paused = pause;
    input::suspend("xh", pause);
    true
}

#[tauri::command]
pub fn xh_set_settings(p: Value) -> bool {
    {
        let mut x = xh();
        let c = &mut x.cfg;
        if let Some(v) = p.get("overlayScale").and_then(Value::as_f64) {
            c["overlayScale"] = Value::from(clamp(v, 0.5, 3.0));
        }
        if let Some(v) = p.get("overlayOpacity").and_then(Value::as_f64) {
            c["overlayOpacity"] = Value::from(clamp(v, 0.2, 1.0));
        }
        if let Some(v) = p.get("fpsCap").and_then(Value::as_i64).filter(|v| [0, 30, 60, 120].contains(v)) {
            c["fpsCap"] = Value::from(v);
        }
        for k in ["lowPriority", "startHidden", "onboarded", "hideFromCapture"] {
            if let Some(v) = p.get(k).and_then(Value::as_bool) {
                c[k] = Value::Bool(v);
            }
        }
        if let Some(v) = p.get("accentColor").and_then(Value::as_str) {
            if v.len() == 7 && v.starts_with('#') && v[1..].chars().all(|c| c.is_ascii_hexdigit()) {
                c["accentColor"] = Value::from(v.to_lowercase());
            }
        }
        if let Some(v) = p.get("memoryMode").and_then(Value::as_str).filter(|s| ["balanced", "low", "lowest"].contains(s)) {
            c["memoryMode"] = Value::from(v);
        }
        for k in ["overlayOffsetX", "overlayOffsetY"] {
            if let Some(v) = p.get(k).and_then(Value::as_f64) {
                c[k] = Value::from(clamp(v, -100.0, 100.0).round());
            }
        }
    }
    crate::perf::refresh();
    save_soon();
    broadcast_state();
    true
}

#[tauri::command]
pub fn xh_get_perf() -> Value {
    let (rect, mode, hook) = {
        let x = xh();
        (x.rect, x.mode, x.hook_running)
    };
    let p = crate::perf::snapshot();
    json!({
        "cpu": p.cpu,
        "memMB": p.mem_mb,
        "processes": p.processes,
        "editorOpen": true,
        "overlaySize": rect.2,
        "overlayVisible": mode != Mode::Hidden,
        "overlayMode": format!("{:?}", mode).to_lowercase(),
        "hook": if hook { "running" } else { "off" },
    })
}

#[tauri::command]
pub fn xh_set_games(p: Value) -> bool {
    {
        let mut x = xh();
        if let Some(g) = p.get("gameProfiles") {
            x.cfg["gameProfiles"] = clean_games(Some(g));
        }
        for k in ["autoSwitch", "autoRevert", "followWindow", "gameOnly"] {
            if let Some(v) = p.get(k).and_then(Value::as_bool) {
                x.cfg[k] = Value::Bool(v);
            }
        }
        if !jbool(&x.cfg, "followWindow", false) {
            x.follow = None;
        }
    }
    // Re-evaluate the current foreground app against the new rules.
    if xh().watcher_on {
        stop_watcher();
    }
    sync_watcher();
    save_soon();
    broadcast_state();
    true
}

#[tauri::command]
pub async fn xh_list_procs() -> Vec<String> {
    crate::perf::window_processes()
        .into_iter()
        .map(|n| exe_key(&n))
        .filter(|n| !n.is_empty() && !OWN_PROCS.contains(&n.as_str()))
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .take(200)
        .collect()
}

#[tauri::command]
pub fn xh_get_diag() -> Value {
    let x = xh();
    let mons = monitors();
    let idx = x.cfg["displayId"].as_i64().map(|i| i as usize);
    let m = idx.and_then(|i| mons.get(i)).or_else(|| mons.iter().find(|m| m.primary)).cloned();
    let (tx, ty) = match (x.follow, &m) {
        (Some(f), _) => f,
        (None, Some(m)) => (m.x as f64 + m.w as f64 / 2.0, m.y as f64 + m.h as f64 / 2.0),
        _ => (0.0, 0.0),
    };
    let tx = tx + jf64(&x.cfg, "overlayOffsetX", 0.0);
    let ty = ty + jf64(&x.cfg, "overlayOffsetY", 0.0);
    let r = x.rect;
    let shown = x.mode != Mode::Hidden;
    json!({
        "displayId": idx.unwrap_or(0),
        "scale": m.as_ref().map(|m| m.scale).unwrap_or(1.0),
        "physical": m.as_ref().map(|m| format!("{}\u{00d7}{}", m.w, m.h)).unwrap_or_default(),
        "errorX": if shown { Value::from(r.0 as f64 + r.2 as f64 / 2.0 - tx) } else { Value::Null },
        "errorY": if shown { Value::from(r.1 as f64 + r.3 as f64 / 2.0 - ty) } else { Value::Null },
        "following": x.follow.is_some(),
    })
}

#[tauri::command]
pub fn xh_set_guide(on: bool) -> bool {
    {
        let mut x = xh();
        x.guide = on;
        x.guide_until = if on { Some(Instant::now() + Duration::from_secs(15)) } else { None };
    }
    kick();
    broadcast_state();
    true
}

#[tauri::command]
pub async fn xh_export_backup() -> Value {
    use tauri_plugin_dialog::DialogExt;
    let Some(fp) = util::app()
        .dialog()
        .file()
        .set_title("Export EZ Reticle backup")
        .set_file_name("ez-reticle-backup.json")
        .add_filter("Backup", &["json"])
        .blocking_save_file()
    else {
        return json!({ "ok": false });
    };
    let Ok(path) = fp.into_path() else { return json!({ "ok": false }) };
    let data = xh().cfg.clone();
    match util::write_json_atomic(&path, &json!({ "app": "ez-reticle", "version": 1, "data": data }), true) {
        Ok(_) => json!({ "ok": true }),
        Err(_) => json!({ "ok": false, "error": "Could not write that file" }),
    }
}

#[tauri::command]
pub async fn xh_import_backup() -> Value {
    use tauri_plugin_dialog::DialogExt;
    let Some(fp) = util::app().dialog().file().set_title("Restore EZ Reticle backup").add_filter("Backup", &["json"]).blocking_pick_file() else {
        return json!({ "ok": false });
    };
    let Ok(path) = fp.into_path() else { return json!({ "ok": false }) };
    if std::fs::metadata(&path).map(|m| m.len() > 30 * 1024 * 1024).unwrap_or(true) {
        return json!({ "ok": false, "error": "That file is too large" });
    }
    let Some(parsed) = util::read_json(&path) else { return json!({ "ok": false, "error": "Could not read that backup" }) };
    let app_ok = matches!(parsed.get("app").and_then(Value::as_str), Some("ez-reticle") | Some("mishez-xhair"));
    if !app_ok || !parsed.get("data").map(Value::is_object).unwrap_or(false) {
        return json!({ "ok": false, "error": "That is not a EZ Reticle backup" });
    }
    let old = xh().cfg.clone();
    let _ = util::write_json_atomic(&cfg_path().with_extension("pre-restore.json"), &old, true);
    let next = normalize(&parsed["data"]);
    let design = next["crosshair"].clone();
    {
        let mut x = xh();
        x.cfg = next;
        x.active_profile = None;
        x.meta.known = false;
    }
    if xh().watcher_on {
        stop_watcher();
    }
    register_hotkeys();
    sync_hook();
    sync_watcher();
    util::emit("xh-crosshair", design);
    broadcast_state();
    save_soon();
    json!({ "ok": true })
}

#[tauri::command]
pub fn xh_list_displays() -> Value {
    let v: Vec<Value> = monitors()
        .iter()
        .enumerate()
        .map(|(i, m)| {
            json!({
                "id": i,
                "label": format!("Display {} ({}\u{00d7}{}){}", i + 1, m.w, m.h, if m.primary { " \u{2013} primary" } else { "" }),
            })
        })
        .collect();
    Value::Array(v)
}

#[tauri::command]
pub fn xh_set_display(id: Option<i64>) -> bool {
    xh().cfg["displayId"] = id.map(Value::from).unwrap_or(Value::Null);
    kick();
    save_soon();
    broadcast_state();
    true
}

#[tauri::command]
pub fn xh_set_autostart(on: bool) -> bool {
    xh().cfg["autoStart"] = Value::Bool(on);
    crate::set_autostart(on);
    save_soon();
    broadcast_state();
    on
}

pub fn low_priority() -> bool {
    XH.get().map(|x| jbool(&x.lock().cfg, "lowPriority", true)).unwrap_or(true)
}

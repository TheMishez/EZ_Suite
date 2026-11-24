//! The one native worker thread both halves of the app share.
//!
//! It owns a hidden message-only window and does all of the "watch the PC" work:
//!  - Global hotkeys (soundboard sounds, crosshair toggle/profile keys) and crosshair animation
//!    triggers, through Raw Input with RIDEV_INPUTSINK. Raw Input gives us a *copy* of each key
//!    or click after Windows has already sent it on to the game. Nothing ever waits on this
//!    thread, so it can't add input lag, and keys always reach the game. (The old apps used a
//!    low-level keyboard hook, which Windows does wait on.)
//!  - The keyboard is only registered while a hotkey or key trigger needs it, the mouse only
//!    while Mouse 4/5 is bound or a click animation is in use. Nothing bound = nothing registered.
//!  - Foreground-window watching for per-game crosshairs (SetWinEventHook + a 500 ms timer).
//!  - Hosting the native crosshair window (see crosshair/still.rs) via `run_on_worker`.
//!
//! Matching work happens here (a table lookup); acting on a hotkey happens on a separate
//! dispatcher thread so a busy app can never back up input handling.
use crate::keys::{self, Combo};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::atomic::{AtomicIsize, AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::OnceLock;

#[derive(Debug)]
pub enum Ev {
    Hotkey { owner: &'static str, action: String },
    Input { code: &'static str, down: bool },
    Foreground { name: String, x: i32, y: i32, w: i32, h: i32 },
}

#[derive(Default)]
struct OwnerTable {
    binds: Vec<(Combo, String)>,
    suspended: bool,
}

#[derive(Default)]
struct Tables {
    owners: HashMap<&'static str, OwnerTable>,
    trigger_listen: bool,
}

static TABLES: OnceLock<Mutex<Tables>> = OnceLock::new();
static TX: OnceLock<Mutex<mpsc::Sender<Ev>>> = OnceLock::new();
static WORKER_HWND: AtomicIsize = AtomicIsize::new(0);
static WORKER_TID: AtomicU32 = AtomicU32::new(0);
/// Bit 1 = keyboard registered, 2 = mouse registered (for the diagnostics in the UI).
static REGISTERED: AtomicU32 = AtomicU32::new(0);

fn tables() -> &'static Mutex<Tables> {
    TABLES.get_or_init(|| Mutex::new(Tables::default()))
}

fn send(ev: Ev) {
    if let Some(tx) = TX.get() {
        let _ = tx.lock().send(ev);
    }
}

/// Replaces one owner's hotkeys. Returns the combos that could not be understood.
pub fn set_hotkeys(owner: &'static str, bindings: &[(String, String)]) -> Vec<String> {
    let mut failed = Vec::new();
    let mut binds = Vec::new();
    for (combo, action) in bindings.iter().take(2000) {
        match keys::parse(combo) {
            Some(c) => binds.push((c, action.clone())),
            None => failed.push(combo.clone()),
        }
    }
    {
        let mut t = tables().lock();
        t.owners.entry(owner).or_default().binds = binds;
    }
    reregister();
    failed
}

pub fn suspend(owner: &'static str, on: bool) {
    tables().lock().owners.entry(owner).or_default().suspended = on;
}

/// Crosshair click/key animations: listen to every button/key while true.
pub fn set_trigger_listen(on: bool) {
    let changed = {
        let mut t = tables().lock();
        let c = t.trigger_listen != on;
        t.trigger_listen = on;
        c
    };
    if changed {
        reregister();
    }
}

pub fn registered() -> (bool, bool) {
    let r = REGISTERED.load(Ordering::Relaxed);
    (r & 1 != 0, r & 2 != 0)
}

pub fn foreground_watch(on: bool) {
    #[cfg(windows)]
    post(if on { imp::MSG_FG_ON } else { imp::MSG_FG_OFF });
    #[cfg(not(windows))]
    let _ = on;
}

fn reregister() {
    #[cfg(windows)]
    post(imp::MSG_REREGISTER);
}

#[cfg(windows)]
fn post(msg: u32) {
    let h = WORKER_HWND.load(Ordering::Acquire);
    if h != 0 {
        unsafe {
            windows_sys::Win32::UI::WindowsAndMessaging::PostMessageW(h as _, msg, 0, 0);
        }
    }
}

/// Runs `f` on the worker thread (which has a message loop, so it can own windows).
pub fn run_on_worker<F: FnOnce() + Send + 'static>(f: F) -> bool {
    #[cfg(windows)]
    {
        let h = WORKER_HWND.load(Ordering::Acquire);
        if h == 0 {
            return false;
        }
        let boxed: Box<Box<dyn FnOnce() + Send>> = Box::new(Box::new(f));
        let p = Box::into_raw(boxed);
        let ok = unsafe { windows_sys::Win32::UI::WindowsAndMessaging::PostMessageW(h as _, imp::MSG_RUN, 0, p as isize) };
        if ok == 0 {
            unsafe { drop(Box::from_raw(p)) };
            return false;
        }
        true
    }
    #[cfg(not(windows))]
    {
        let _ = f;
        false
    }
}

pub fn worker_thread_id() -> u32 {
    WORKER_TID.load(Ordering::Relaxed)
}

/// Starts the worker and the dispatcher. Safe to call once at startup.
pub fn start() {
    let (tx, rx) = mpsc::channel::<Ev>();
    let _ = TX.set(Mutex::new(tx));
    std::thread::Builder::new()
        .name("ez-dispatch".into())
        .spawn(move || {
            while let Ok(ev) = rx.recv() {
                let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match ev {
                    Ev::Hotkey { owner: "sb", action } => crate::sound::on_hotkey(&action),
                    Ev::Hotkey { owner: "xh", action } => crate::crosshair::on_hotkey(&action),
                    Ev::Hotkey { .. } => {}
                    Ev::Input { code, down } => crate::crosshair::on_input(code, down),
                    Ev::Foreground { name, x, y, w, h } => crate::crosshair::on_foreground(&name, x, y, w, h),
                }));
                if r.is_err() {
                    crate::util::log("dispatch handler panicked");
                }
            }
        })
        .expect("dispatcher thread");
    #[cfg(windows)]
    {
        let (rtx, rrx) = mpsc::channel::<()>();
        std::thread::Builder::new().name("ez-input".into()).spawn(move || imp::worker_main(rtx)).expect("input thread");
        let _ = rrx.recv_timeout(std::time::Duration::from_secs(5));
    }
}

#[cfg(windows)]
mod imp {
    use super::*;
    use std::cell::RefCell;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::*;
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::System::Threading::*;
    use windows_sys::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    use windows_sys::Win32::UI::Input::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    pub const MSG_REREGISTER: u32 = WM_APP + 1;
    pub const MSG_FG_ON: u32 = WM_APP + 2;
    pub const MSG_FG_OFF: u32 = WM_APP + 3;
    pub const MSG_RUN: u32 = WM_APP + 4;
    const FG_TIMER: usize = 1;

    struct WorkerState {
        held: [bool; 256],
        mouse_held: [bool; 6],
        kb_on: bool,
        mouse_on: bool,
        fg_hook: HWINEVENTHOOK,
        last_line: String,
        last_pid: u32,
        last_name: String,
    }

    thread_local! {
        static ST: RefCell<WorkerState> = RefCell::new(WorkerState {
            held: [false; 256], mouse_held: [false; 6], kb_on: false, mouse_on: false,
            fg_hook: null_mut(), last_line: String::new(), last_pid: 0, last_name: String::new(),
        });
    }

    pub fn worker_main(ready: mpsc::Sender<()>) {
        unsafe {
            // The work here is tiny; slightly higher priority keeps hotkeys snappy under game load.
            SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_ABOVE_NORMAL);
            WORKER_TID.store(GetCurrentThreadId(), Ordering::Relaxed);
            let inst = GetModuleHandleW(null());
            let class = crate::util::wide("EZSuiteWorker");
            let mut wc: WNDCLASSEXW = std::mem::zeroed();
            wc.cbSize = std::mem::size_of::<WNDCLASSEXW>() as u32;
            wc.lpfnWndProc = Some(wndproc);
            wc.hInstance = inst;
            wc.lpszClassName = class.as_ptr();
            RegisterClassExW(&wc);
            let hwnd = CreateWindowExW(0, class.as_ptr(), class.as_ptr(), 0, 0, 0, 0, 0, HWND_MESSAGE, null_mut(), inst, null());
            WORKER_HWND.store(hwnd as isize, Ordering::Release);
            let _ = ready.send(());
            if hwnd.is_null() {
                crate::util::log("input worker: could not create its window");
                return;
            }
            crate::crosshair::still::register_class();
            apply_registration(hwnd);
            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, null_mut(), 0, 0) > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }

    unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
        match msg {
            WM_INPUT => {
                handle_raw(lp);
            }
            MSG_REREGISTER => {
                apply_registration(hwnd);
                return 0;
            }
            MSG_FG_ON => {
                ST.with(|s| {
                    let mut s = s.borrow_mut();
                    if s.fg_hook.is_null() {
                        s.fg_hook =
                            SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, null_mut(), Some(on_win_event), 0, 0, WINEVENT_OUTOFCONTEXT);
                        SetTimer(hwnd, FG_TIMER, 500, None);
                    }
                    s.last_line.clear();
                });
                report_foreground();
                return 0;
            }
            MSG_FG_OFF => {
                ST.with(|s| {
                    let mut s = s.borrow_mut();
                    if !s.fg_hook.is_null() {
                        UnhookWinEvent(s.fg_hook);
                        s.fg_hook = null_mut();
                    }
                    s.last_line.clear();
                });
                KillTimer(hwnd, FG_TIMER);
                return 0;
            }
            WM_TIMER if wp == FG_TIMER => {
                report_foreground();
                return 0;
            }
            MSG_RUN => {
                let p = lp as *mut Box<dyn FnOnce() + Send>;
                if !p.is_null() {
                    let f = Box::from_raw(p);
                    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || (*f)()));
                }
                return 0;
            }
            _ => {}
        }
        DefWindowProcW(hwnd, msg, wp, lp)
    }

    /// Registers only what's needed right now (see the module docs).
    unsafe fn apply_registration(hwnd: HWND) {
        let (want_kb, want_mouse) = {
            let t = tables().lock();
            let mut kb = t.trigger_listen;
            let mut mouse = t.trigger_listen;
            for o in t.owners.values() {
                for (c, _) in &o.binds {
                    if c.mouse != 0 {
                        mouse = true;
                    } else {
                        kb = true;
                    }
                }
            }
            (kb, mouse)
        };
        ST.with(|s| {
            let mut s = s.borrow_mut();
            let mut set = |usage: u16, on: bool| -> bool {
                let dev = RAWINPUTDEVICE {
                    usUsagePage: 0x01,
                    usUsage: usage,
                    dwFlags: if on { RIDEV_INPUTSINK } else { RIDEV_REMOVE },
                    hwndTarget: if on { hwnd } else { null_mut() },
                };
                RegisterRawInputDevices(&dev, 1, std::mem::size_of::<RAWINPUTDEVICE>() as u32) != 0
            };
            if want_kb != s.kb_on {
                if set(0x06, want_kb) || !want_kb {
                    s.kb_on = want_kb;
                }
                s.held = [false; 256];
            }
            if want_mouse != s.mouse_on {
                if set(0x02, want_mouse) || !want_mouse {
                    s.mouse_on = want_mouse;
                }
                s.mouse_held = [false; 6];
            }
            REGISTERED.store((s.kb_on as u32) | ((s.mouse_on as u32) << 1), Ordering::Relaxed);
        });
    }

    fn current_mods() -> u8 {
        let d = |vk: i32| unsafe { (GetAsyncKeyState(vk) as u16 & 0x8000) != 0 };
        let mut m = 0;
        if d(0x11) {
            m |= keys::MOD_CTRL;
        }
        if d(0x12) {
            m |= keys::MOD_ALT;
        }
        if d(0x10) {
            m |= keys::MOD_SHIFT;
        }
        if d(0x5B) || d(0x5C) {
            m |= keys::MOD_WIN;
        }
        m
    }

    fn fire_matches(vk: u8, ext: u8, mouse: u8) {
        let mods = current_mods();
        let t = tables().lock();
        for (owner, table) in t.owners.iter() {
            if table.suspended {
                continue;
            }
            for (c, action) in &table.binds {
                let hit =
                    if mouse != 0 { c.mouse == mouse && c.mods == mods } else { c.mouse == 0 && c.vk == vk && (c.ext == 2 || c.ext == ext) && c.mods == mods };
                if hit {
                    send(Ev::Hotkey { owner: *owner, action: action.clone() });
                }
            }
        }
    }

    unsafe fn handle_raw(lp: LPARAM) {
        let mut buf = [0u64; 16];
        let mut size = std::mem::size_of_val(&buf) as u32;
        let got = GetRawInputData(lp as HRAWINPUT, RID_INPUT, buf.as_mut_ptr() as *mut _, &mut size, std::mem::size_of::<RAWINPUTHEADER>() as u32);
        if got == u32::MAX || (got as usize) < std::mem::size_of::<RAWINPUTHEADER>() {
            return;
        }
        let ri = &*(buf.as_ptr() as *const RAWINPUT);
        let listen = tables().lock().trigger_listen;
        if ri.header.dwType == RIM_TYPEMOUSE {
            let f = ri.data.mouse.Anonymous.Anonymous.usButtonFlags as u32;
            if f == 0 {
                return; // plain movement: the common case, dropped right here
            }
            const DOWN: [u32; 5] = [0x001, 0x004, 0x010, 0x040, 0x100];
            const UP: [u32; 5] = [0x002, 0x008, 0x020, 0x080, 0x200];
            const NAMES: [&str; 5] = ["Mouse1", "Mouse2", "Mouse3", "Mouse4", "Mouse5"];
            for i in 0..5 {
                if f & DOWN[i] != 0 {
                    let first = ST.with(|s| {
                        let mut s = s.borrow_mut();
                        let was = s.mouse_held[i + 1];
                        s.mouse_held[i + 1] = true;
                        !was
                    });
                    if listen {
                        send(Ev::Input { code: NAMES[i], down: true });
                    }
                    if first && i >= 3 {
                        fire_matches(0, 2, (i + 1) as u8);
                    }
                }
                if f & UP[i] != 0 {
                    ST.with(|s| s.borrow_mut().mouse_held[i + 1] = false);
                    if listen {
                        send(Ev::Input { code: NAMES[i], down: false });
                    }
                }
            }
        } else if ri.header.dwType == RIM_TYPEKEYBOARD {
            let k = &ri.data.keyboard;
            if k.MakeCode == 0xFF || k.VKey == 0xFF {
                return;
            }
            let flags = k.Flags as u32;
            if flags & RI_KEY_E1 != 0 {
                return; // Pause/Break prefix
            }
            let e0 = flags & RI_KEY_E0 != 0;
            let down = flags & RI_KEY_BREAK == 0;
            let mut vk = k.VKey as u8;
            match vk {
                0x10 => vk = if k.MakeCode == 0x36 { 0xA1 } else { 0xA0 },
                0x11 => vk = if e0 { 0xA3 } else { 0xA2 },
                0x12 => vk = if e0 { 0xA5 } else { 0xA4 },
                _ => {}
            }
            if listen {
                if let Some(code) = keys::scan_to_code(k.MakeCode, e0) {
                    send(Ev::Input { code, down });
                }
            }
            let first = ST.with(|s| {
                let mut s = s.borrow_mut();
                let was = s.held[vk as usize];
                s.held[vk as usize] = down;
                down && !was // ignore auto-repeat
            });
            if first {
                fire_matches(vk, e0 as u8, 0);
            }
        }
    }

    unsafe extern "system" fn on_win_event(_h: HWINEVENTHOOK, _e: u32, _w: HWND, _o: i32, _c: i32, _t: u32, _ms: u32) {
        ST.with(|s| s.borrow_mut().last_pid = 0); // process ids get reused: re-read the name
        report_foreground();
    }

    fn process_name(pid: u32) -> String {
        if pid == 0 {
            return String::new();
        }
        let cached = ST.with(|s| {
            let s = s.borrow();
            if s.last_pid == pid {
                Some(s.last_name.clone())
            } else {
                None
            }
        });
        if let Some(n) = cached {
            return n;
        }
        let name = exe_name(pid);
        if !name.is_empty() {
            ST.with(|s| {
                let mut s = s.borrow_mut();
                s.last_pid = pid;
                s.last_name = name.clone();
            });
        }
        name
    }

    unsafe fn report_foreground() {
        let fg = GetForegroundWindow();
        let (mut x, mut y, mut w, mut h) = (0, 0, 0, 0);
        let mut name = String::new();
        if !fg.is_null() {
            let mut pid = 0u32;
            GetWindowThreadProcessId(fg, &mut pid);
            name = process_name(pid);
            let mut r: RECT = std::mem::zeroed();
            if GetClientRect(fg, &mut r) != 0 {
                let mut p = POINT { x: 0, y: 0 };
                windows_sys::Win32::Graphics::Gdi::ClientToScreen(fg, &mut p);
                x = p.x;
                y = p.y;
                w = r.right - r.left;
                h = r.bottom - r.top;
            }
        }
        let line = format!("{name}|{x}|{y}|{w}|{h}");
        let changed = ST.with(|s| {
            let mut s = s.borrow_mut();
            if s.last_line == line {
                false
            } else {
                s.last_line = line;
                true
            }
        });
        if changed {
            send(Ev::Foreground { name, x, y, w, h });
        }
    }
}

/// Executable name without folder or ".exe" (like PowerShell's ProcessName).
#[cfg(windows)]
pub fn exe_name(pid: u32) -> String {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::*;
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return String::new();
        }
        let mut buf = [0u16; 520];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len);
        CloseHandle(h);
        if ok == 0 || len == 0 {
            return String::new();
        }
        let full = String::from_utf16_lossy(&buf[..len as usize]);
        let file = full.rsplit(['\\', '/']).next().unwrap_or("").to_string();
        if file.to_ascii_lowercase().ends_with(".exe") {
            file[..file.len() - 4].to_string()
        } else {
            file
        }
    }
}

#[cfg(not(windows))]
pub fn exe_name(_pid: u32) -> String {
    String::new()
}

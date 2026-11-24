//! Keeping out of the game's way: process priority, Windows "Efficiency mode", and the numbers
//! the crosshair settings page shows.
//!
//! Rules:
//!  - "Low priority" (on by default): everything runs below normal priority, so the game always
//!    wins the CPU. Audio threads are registered with MMCSS ("Pro Audio"), so sounds still never
//!    stutter.
//!  - Efficiency mode (idle priority + EcoQoS, like Task Manager's toggle) when there is nothing to
//!    react to at all: window closed, no audio playing, no hotkeys or animations listening.
use parking_lot::Mutex;
use std::time::Instant;

static LAST: Mutex<Option<(bool, bool)>> = parking_lot::const_mutex(None);

pub fn refresh() {
    let low = crate::crosshair::low_priority();
    let (kb, mouse) = crate::input::registered();
    let eco = low && !kb && !mouse && !crate::crosshair::animation_listening() && !crate::main_window_open() && !crate::sound::engine_awake();
    {
        let mut l = LAST.lock();
        if *l == Some((low, eco)) {
            return;
        }
        *l = Some((low, eco));
    }
    for pid in own_pids() {
        imp::set_priority(pid, low, eco);
    }
}

pub struct Snapshot {
    pub cpu: f64,
    pub mem_mb: f64,
    pub processes: usize,
}

static SAMPLE: Mutex<Option<(Instant, u64)>> = parking_lot::const_mutex(None);

/// CPU (percent of one core... normalised to all cores like Task Manager) and memory of this app
/// plus its webview helper processes.
pub fn snapshot() -> Snapshot {
    let pids = own_pids();
    let mut cpu_100ns = 0u64;
    let mut mem = 0u64;
    for &p in &pids {
        let (c, m) = imp::usage(p);
        cpu_100ns += c;
        mem += m;
    }
    let now = Instant::now();
    let mut s = SAMPLE.lock();
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1) as f64;
    let cpu = match *s {
        Some((t, c)) if cpu_100ns >= c => {
            let wall = now.duration_since(t).as_secs_f64();
            if wall > 0.05 {
                ((cpu_100ns - c) as f64 / 1e7) / wall / cores * 100.0
            } else {
                0.0
            }
        }
        _ => 0.0,
    };
    *s = Some((now, cpu_100ns));
    Snapshot { cpu, mem_mb: mem as f64 / (1024.0 * 1024.0), processes: pids.len() }
}

/// This process and everything it started (the WebView2 helpers).
pub fn own_pids() -> Vec<u32> {
    let me = std::process::id();
    let all = imp::process_list();
    let mut out = vec![me];
    let mut i = 0;
    while i < out.len() && out.len() < 64 {
        let parent = out[i];
        for (pid, ppid, _) in &all {
            if *ppid == parent && !out.contains(pid) && *pid != 0 {
                out.push(*pid);
            }
        }
        i += 1;
    }
    out
}

/// Names of programs that have a visible window (for "add a game").
pub fn window_processes() -> Vec<String> {
    imp::window_pids().into_iter().map(crate::input::exe_name).filter(|n| !n.is_empty()).collect()
}

/// Marks the calling thread as a realtime audio thread (MMCSS "Pro Audio").
pub fn audio_thread() {
    imp::mmcss();
}

#[cfg(windows)]
mod imp {
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::*;
    use windows_sys::Win32::System::Diagnostics::ToolHelp::*;
    use windows_sys::Win32::System::ProcessStatus::*;
    use windows_sys::Win32::System::Threading::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    pub fn set_priority(pid: u32, low: bool, eco: bool) {
        unsafe {
            let h = OpenProcess(PROCESS_SET_INFORMATION | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                return;
            }
            let class = if eco {
                IDLE_PRIORITY_CLASS
            } else if low {
                BELOW_NORMAL_PRIORITY_CLASS
            } else {
                NORMAL_PRIORITY_CLASS
            };
            SetPriorityClass(h, class);
            let st = PROCESS_POWER_THROTTLING_STATE {
                Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
                ControlMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
                StateMask: if eco { PROCESS_POWER_THROTTLING_EXECUTION_SPEED } else { 0 },
            };
            SetProcessInformation(h, ProcessPowerThrottling, &st as *const _ as *const _, std::mem::size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32);
            CloseHandle(h);
        }
    }

    fn ft(f: &FILETIME) -> u64 {
        ((f.dwHighDateTime as u64) << 32) | f.dwLowDateTime as u64
    }

    pub fn usage(pid: u32) -> (u64, u64) {
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                return (0, 0);
            }
            let (mut a, mut b, mut k, mut u): (FILETIME, FILETIME, FILETIME, FILETIME) = std::mem::zeroed();
            let cpu = if GetProcessTimes(h, &mut a, &mut b, &mut k, &mut u) != 0 { ft(&k) + ft(&u) } else { 0 };
            let mut pmc: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
            pmc.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
            let mem = if K32GetProcessMemoryInfo(h, &mut pmc, pmc.cb) != 0 { pmc.WorkingSetSize as u64 } else { 0 };
            CloseHandle(h);
            (cpu, mem)
        }
    }

    /// (pid, parent pid, exe)
    pub fn process_list() -> Vec<(u32, u32, String)> {
        let mut v = Vec::new();
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap == INVALID_HANDLE_VALUE {
                return v;
            }
            let mut e: PROCESSENTRY32W = std::mem::zeroed();
            e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            if Process32FirstW(snap, &mut e) != 0 {
                loop {
                    let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
                    v.push((e.th32ProcessID, e.th32ParentProcessID, String::from_utf16_lossy(&e.szExeFile[..len])));
                    if Process32NextW(snap, &mut e) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(snap);
        }
        v
    }

    pub fn window_pids() -> Vec<u32> {
        unsafe extern "system" fn cb(h: HWND, data: LPARAM) -> BOOL {
            let out = &mut *(data as *mut Vec<u32>);
            if IsWindowVisible(h) != 0 && GetWindowTextLengthW(h) > 0 && GetWindow(h, GW_OWNER).is_null() {
                let mut pid = 0u32;
                GetWindowThreadProcessId(h, &mut pid);
                if pid != 0 && !out.contains(&pid) {
                    out.push(pid);
                }
            }
            1
        }
        let mut v: Vec<u32> = Vec::new();
        unsafe {
            EnumWindows(Some(cb), &mut v as *mut _ as LPARAM);
        }
        v
    }

    pub fn mmcss() {
        thread_local!(static DONE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) });
        DONE.with(|d| {
            if d.get() {
                return;
            }
            d.set(true);
            unsafe {
                let name = crate::util::wide("Pro Audio");
                let mut idx = 0u32;
                let h = AvSetMmThreadCharacteristicsW(name.as_ptr(), &mut idx);
                if h.is_null() {
                    SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL);
                }
            }
        });
        let _ = null_mut::<u8>();
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn set_priority(_pid: u32, _low: bool, _eco: bool) {}
    pub fn usage(_pid: u32) -> (u64, u64) {
        (0, 0)
    }
    pub fn process_list() -> Vec<(u32, u32, String)> {
        Vec::new()
    }
    pub fn window_pids() -> Vec<u32> {
        Vec::new()
    }
    pub fn mmcss() {}
}

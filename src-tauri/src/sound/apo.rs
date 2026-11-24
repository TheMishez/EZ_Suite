//! Direct-to-mic mode: the EZ Soundboard mic plugin (native/apo, an APO that Windows runs inside
//! its own audio engine) adds our sound mix on top of your real voice.
//!
//! The app writes its finished mix into a ring buffer in a small shared file
//! (%ProgramData%\EZSoundboard\mixbuffer.bin), exactly like the old ezsb-bridge.exe did, but
//! now straight from the mixer: no helper process and no pipe in between.
//! Layout must match native/common/shared.h (MPShared).
use crate::util;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicI32, AtomicI64, Ordering};

pub const RATE: u32 = 48000;
pub const RING_FRAMES: i64 = 48000 * 2;
const MAGIC: u32 = 0x4D50_4144; // 'MPAD'
const SDDL: &str = "D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;LS)(A;;FA;;;NS)(A;;FA;;;WD)(A;;FA;;;AC)(A;;FA;;;S-1-15-2-2)(A;;FA;;;WR)(A;;FA;;;RC)(A;;FA;;;S-1-5-80-2676549577-1911656217-2625096541-4178041876-1366760775)S:(ML;OICI;NW;;;LW)";

#[repr(C, align(8))]
pub struct MPShared {
    magic: u32,
    version: u32,
    write_pos: AtomicI64,
    writer_tick: AtomicI64,
    apo_tick: AtomicI64,
    voice_gain_bits: AtomicI32,
    apo_rate: AtomicI32,
    apo_channels: AtomicI32,
    apo_instances: AtomicI32,
    apo_load_tick: AtomicI64,
    apo_locks: AtomicI32,
    apo_last_hr: AtomicI32,
    reserved: [u32; 12],
    ring: [f32; (RING_FRAMES * 2) as usize],
}

pub struct Shared {
    p: *mut MPShared,
    file: isize,
    map: isize,
}

unsafe impl Send for Shared {}
unsafe impl Sync for Shared {}

impl Shared {
    #[cfg(windows)]
    pub fn open() -> Result<Shared, u32> {
        use std::ptr::{null, null_mut};
        use windows_sys::Win32::Foundation::*;
        use windows_sys::Win32::Security::Authorization::*;
        use windows_sys::Win32::Security::*;
        use windows_sys::Win32::Storage::FileSystem::*;
        use windows_sys::Win32::System::Memory::*;
        let base = std::env::var("ProgramData").unwrap_or_else(|_| "C:\\ProgramData".into());
        let dir = format!("{base}\\EZSoundboard");
        let path = format!("{dir}\\mixbuffer.bin");
        unsafe {
            let mut sd: PSECURITY_DESCRIPTOR = null_mut();
            let sddl = util::wide(SDDL);
            ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.as_ptr(), SDDL_REVISION_1, &mut sd, null_mut());
            let sa = SECURITY_ATTRIBUTES { nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32, lpSecurityDescriptor: sd, bInheritHandle: 0 };
            let sa_ptr: *const SECURITY_ATTRIBUTES = if sd.is_null() { null() } else { &sa };
            let wdir = util::wide(&dir);
            CreateDirectoryW(wdir.as_ptr(), sa_ptr);
            let wpath = util::wide(&path);
            let f = CreateFileW(
                wpath.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                sa_ptr,
                OPEN_ALWAYS,
                FILE_ATTRIBUTE_NORMAL | FILE_ATTRIBUTE_TEMPORARY,
                null_mut(),
            );
            let err = GetLastError();
            if !sd.is_null() {
                LocalFree(sd as _);
            }
            if f == INVALID_HANDLE_VALUE {
                return Err(err);
            }
            let size = std::mem::size_of::<MPShared>() as u32;
            let m = CreateFileMappingW(f, null(), PAGE_READWRITE, 0, size, null());
            if m.is_null() {
                let e = GetLastError();
                CloseHandle(f);
                return Err(e);
            }
            let view = MapViewOfFile(m, FILE_MAP_READ | FILE_MAP_WRITE, 0, 0, size as usize);
            if view.Value.is_null() {
                let e = GetLastError();
                CloseHandle(m);
                CloseHandle(f);
                return Err(e);
            }
            let p = view.Value as *mut MPShared;
            if std::ptr::read_volatile(&(*p).magic) != MAGIC {
                (*p).voice_gain_bits.store(1.0f32.to_bits() as i32, Ordering::SeqCst);
                std::ptr::write_volatile(&mut (*p).version, 1);
                std::sync::atomic::fence(Ordering::SeqCst);
                std::ptr::write_volatile(&mut (*p).magic, MAGIC);
            }
            Ok(Shared { p, file: f as isize, map: m as isize })
        }
    }

    #[cfg(not(windows))]
    pub fn open() -> Result<Shared, u32> {
        Err(1)
    }

    fn s(&self) -> &MPShared {
        unsafe { &*self.p }
    }

    /// Appends interleaved stereo 48 kHz frames to the timeline the plugin reads from.
    pub fn write(&self, stereo: &[f32]) {
        let frames = (stereo.len() / 2) as i64;
        let pos = self.s().write_pos.load(Ordering::Acquire);
        unsafe {
            let ring = std::ptr::addr_of_mut!((*self.p).ring) as *mut f32;
            for f in 0..frames {
                let i = ((pos + f) % RING_FRAMES) as usize;
                *ring.add(i * 2) = stereo[(f * 2) as usize];
                *ring.add(i * 2 + 1) = stereo[(f * 2 + 1) as usize];
            }
        }
        std::sync::atomic::fence(Ordering::SeqCst);
        self.s().write_pos.store(pos + frames, Ordering::Release);
        self.s().writer_tick.store(tick() as i64, Ordering::Release);
    }

    pub fn set_voice_gain(&self, g: f32) {
        let g = if (0.0..=4.0).contains(&g) { g } else { 1.0 };
        self.s().voice_gain_bits.store(g.to_bits() as i32, Ordering::Release);
    }

    pub fn status(&self, frames_in: i64) -> Value {
        let s = self.s();
        let now = tick();
        let age = |t: i64| if t > 0 && (t as u64) <= now { (now - t as u64) as i64 } else { -1 };
        json!({
            "mapped": true,
            "openErr": 0,
            "apoAgeMs": age(s.apo_tick.load(Ordering::Acquire)),
            "loadAgeMs": age(s.apo_load_tick.load(Ordering::Acquire)),
            "rate": s.apo_rate.load(Ordering::Relaxed),
            "channels": s.apo_channels.load(Ordering::Relaxed),
            "instances": s.apo_instances.load(Ordering::Relaxed),
            "locks": s.apo_locks.load(Ordering::Relaxed),
            "lastHr": s.apo_last_hr.load(Ordering::Relaxed),
            "framesIn": frames_in,
        })
    }
}

impl Drop for Shared {
    fn drop(&mut self) {
        // App closing: put the real mic back to normal immediately.
        self.set_voice_gain(1.0);
        #[cfg(windows)]
        unsafe {
            use windows_sys::Win32::Foundation::CloseHandle;
            use windows_sys::Win32::System::Memory::*;
            UnmapViewOfFile(MEMORY_MAPPED_VIEW_ADDRESS { Value: self.p as *mut _ });
            CloseHandle(self.map as _);
            CloseHandle(self.file as _);
        }
    }
}

#[cfg(windows)]
fn tick() -> u64 {
    unsafe { windows_sys::Win32::System::SystemInformation::GetTickCount64() }
}
#[cfg(not(windows))]
fn tick() -> u64 {
    0
}

// ------------------------------------------------------------------ the setup tool

fn setup_exe() -> std::path::PathBuf {
    util::resource("driver/ezsb-mic-setup.exe")
}

pub fn available() -> bool {
    cfg!(windows) && setup_exe().exists() && util::resource("driver/EZSoundboardApo.dll").exists()
}

fn parse_last_json(out: &str) -> Value {
    let line = out.lines().map(str::trim).filter(|l| !l.is_empty()).last().unwrap_or("");
    serde_json::from_str(line).unwrap_or_else(|_| json!({ "ok": false, "error": if line.is_empty() { "no output" } else { line } }))
}

pub fn list() -> Value {
    if !available() {
        return json!({ "ok": false, "error": "unavailable" });
    }
    match util::hidden_command(setup_exe()).arg("list").output() {
        Ok(o) => parse_last_json(&String::from_utf8_lossy(&o.stdout)),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

/// Runs the setup tool elevated (one UAC prompt). enable/disable are mic GUIDs.
pub fn apply(enable: &[String], disable: &[String]) -> Value {
    if !available() {
        return json!({ "ok": false, "error": "unavailable" });
    }
    let re = regex::Regex::new(r"^\{[0-9a-fA-F-]{36}\}$").unwrap();
    let safe = |a: &[String]| a.iter().filter(|g| re.is_match(g) || *g == "default").cloned().collect::<Vec<_>>();
    let (en, dis) = (safe(enable), safe(disable));
    let mut args = vec!["apply".to_string()];
    if !en.is_empty() {
        args.push("--enable".into());
        args.push(en.join(","));
    }
    if !dis.is_empty() {
        args.push("--disable".into());
        args.push(dis.join(","));
    }
    let q = |s: &str| format!("'{}'", s.replace('\'', "''"));
    let ps = format!(
        "$p = Start-Process -FilePath {} -ArgumentList {} -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode",
        q(&setup_exe().to_string_lossy()),
        q(&args.join(" "))
    );
    match util::hidden_command("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command", &ps]).status() {
        Ok(s) if s.success() => json!({ "ok": true }),
        Ok(s) => json!({ "ok": false, "error": if s.code() == Some(5) { "admin" } else { "failed" }, "code": s.code() }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

//! Small helpers shared by every part of the app: paths, JSON files, ids, events, logging.
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn set_app(app: AppHandle) {
    let _ = APP.set(app);
}

pub fn app() -> &'static AppHandle {
    APP.get().expect("app handle not set")
}

pub fn try_app() -> Option<&'static AppHandle> {
    APP.get()
}

/// Sends an event to every window (soundboard / crosshair page and the overlay).
pub fn emit<S: Serialize + Clone>(event: &str, payload: S) {
    if let Some(a) = try_app() {
        let _ = a.emit(event, payload);
    }
}

/// Sends an event to one window only ("main" or "overlay").
pub fn emit_to<S: Serialize + Clone>(label: &str, event: &str, payload: S) {
    if let Some(a) = try_app() {
        let _ = a.emit_to(label, event, payload);
    }
}

/// %APPDATA%\EZ Suite (or the standalone app's folder, see flavor.rs)
pub fn data_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    let d = base.join(crate::flavor::DATA_DIR);
    let _ = std::fs::create_dir_all(&d);
    d
}

/// %APPDATA%\<name> of the old standalone apps (for the one-time import).
pub fn old_app_dir(name: &str) -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|b| PathBuf::from(b).join(name))
}

pub fn resource_dir() -> PathBuf {
    if let Some(a) = try_app() {
        if let Ok(d) = a.path().resource_dir() {
            return d;
        }
    }
    std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.to_path_buf())).unwrap_or_default()
}

/// Finds a bundled file: the installed resources folder first, then the source tree when
/// running a development build (`cargo tauri dev`).
pub fn resource(rel: &str) -> PathBuf {
    let p = resource_dir().join(rel);
    if p.exists() {
        return p;
    }
    let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let map: &[(&str, &str)] = &[("driver/", "native/bin/"), ("starter-sounds", "assets/starter-sounds"), ("streamdeck/", "build/streamdeck/")];
    for (from, to) in map {
        if let Some(rest) = rel.strip_prefix(from) {
            let cand = dev.join(to).join(rest);
            if cand.exists() {
                return cand;
            }
        }
    }
    p
}

pub fn read_json(path: &Path) -> Option<Value> {
    let s = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&s).ok()
}

/// Writes through a temp file and a rename, so a crash never leaves a half-written file.
pub fn write_json_atomic(path: &Path, v: &Value, pretty: bool) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("tmp");
    let data = if pretty { serde_json::to_vec_pretty(v)? } else { serde_json::to_vec(v)? };
    std::fs::write(&tmp, data)?;
    std::fs::rename(&tmp, path)
}

static ID_COUNTER: AtomicU64 = AtomicU64::new(0);

/// 12 hex characters, unique enough for sound ids and file names.
pub fn new_id() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let mut h = RandomState::new().build_hasher();
    h.write_u128(now_ns());
    h.write_u64(ID_COUNTER.fetch_add(1, Ordering::Relaxed));
    h.write_u32(std::process::id());
    format!("{:012x}", h.finish() & 0xffff_ffff_ffff)
}

pub fn now_ns() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)
}

pub fn now_ms() -> f64 {
    (now_ns() / 1_000) as f64 / 1000.0
}

/// Appends a line to %APPDATA%\EZ Suite\error.log (never shows a dialog while someone is gaming).
pub fn log(msg: impl AsRef<str>) {
    use std::io::Write;
    let p = data_dir().join("error.log");
    if std::fs::metadata(&p).map(|m| m.len() > 1024 * 1024).unwrap_or(false) {
        let _ = std::fs::remove_file(&p);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&p) {
        let _ = writeln!(f, "{} {}", now_ms() as u64, msg.as_ref());
    }
}

/// A child process with no console window.
pub fn hidden_command<S: AsRef<std::ffi::OsStr>>(program: S) -> std::process::Command {
    #[allow(unused_mut)]
    let mut c = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c
}

pub fn app_version() -> String {
    try_app().map(|a| a.package_info().version.to_string()).unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string())
}

pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn wide_path(p: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    p.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
}

// ---- JSON field helpers (settings are stored as JSON so old files keep working)

pub fn jbool(v: &Value, k: &str, def: bool) -> bool {
    v.get(k).and_then(Value::as_bool).unwrap_or(def)
}

pub fn jf64(v: &Value, k: &str, def: f64) -> f64 {
    v.get(k).and_then(Value::as_f64).filter(|x| x.is_finite()).unwrap_or(def)
}

pub fn jstr<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(Value::as_str).unwrap_or("")
}

pub fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    v.max(lo).min(hi)
}

/// "1.2.3", "v1.2", "EZ_Suite v2.0.1" -> [1, 2, 3]
pub fn version_parts(v: &str) -> Option<Vec<u64>> {
    let re = regex::Regex::new(r"(\d+(?:\.\d+)+)").ok()?;
    let m = re.find_iter(v).last()?;
    Some(m.as_str().split('.').filter_map(|x| x.parse().ok()).collect())
}

pub fn is_newer(a: &[u64], b: &[u64]) -> bool {
    for i in 0..a.len().max(b.len()) {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        if x != y {
            return x > y;
        }
    }
    false
}

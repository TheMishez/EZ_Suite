//! In-app updates from GitHub Releases (TheMishez/EZ_Suite).
//!
//! Checks once ~8 s after start and every 6 hours. When a newer release has the NSIS installer
//! attached ("…-setup.exe"), the Update button downloads it; "Restart to update" runs it silently
//! (one UAC prompt, because the app installs for all users) and starts EZ Suite again.
use crate::util;
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::io::Read;
use std::time::Duration;

const OWNER: &str = "TheMishez";
const REPO: &str = "EZ_Suite";

#[derive(Clone, Default)]
struct St {
    phase: String, // idle | checking | available | downloading | ready | none | error
    version: String,
    notes: String,
    url: String,
    asset: String,
    can_install: bool,
    percent: u32,
    error: String,
    checked_at: f64,
    file: Option<std::path::PathBuf>,
}

static ST: Mutex<Option<St>> = parking_lot::const_mutex(None);

fn page() -> String {
    format!("https://github.com/{OWNER}/{REPO}/releases/latest")
}

fn with<R>(f: impl FnOnce(&mut St) -> R) -> R {
    let mut g = ST.lock();
    let s = g.get_or_insert_with(|| St { phase: "idle".into(), url: page(), ..Default::default() });
    f(s)
}

fn settings_path() -> std::path::PathBuf {
    util::data_dir().join("suite.json")
}

pub fn enabled() -> bool {
    util::read_json(&settings_path()).map(|v| util::jbool(&v, "checkUpdates", true)).unwrap_or(true)
}

fn set_enabled_file(on: bool) {
    let mut v = util::read_json(&settings_path()).unwrap_or_else(|| json!({}));
    v["checkUpdates"] = Value::Bool(on);
    let _ = util::write_json_atomic(&settings_path(), &v, true);
}

/// The soundboard's shape.
pub fn state() -> Value {
    with(|s| {
        json!({
            "current": util::app_version(),
            "phase": s.phase,
            "version": s.version,
            "notes": s.notes,
            "url": s.url,
            "canInstall": s.can_install,
            "percent": s.percent,
            "error": s.error,
            "checkedAt": s.checked_at,
            "enabled": enabled(),
        })
    })
}

/// The crosshair editor's shape: null when there is nothing new.
pub fn reticle_view() -> Value {
    with(|s| {
        if s.version.is_empty() || !matches!(s.phase.as_str(), "available" | "downloading" | "ready" | "error") {
            return Value::Null;
        }
        let phase = match s.phase.as_str() {
            "available" => "",
            p => p,
        };
        json!({ "version": s.version, "url": s.url, "canInstall": s.can_install, "phase": phase, "percent": s.percent })
    })
}

fn changed() {
    util::emit("update-state", state());
    crate::crosshair::broadcast_state();
    crate::tray::refresh();
}

pub fn init() {
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_secs(8));
        loop {
            if enabled() {
                check(false);
            }
            std::thread::sleep(Duration::from_secs(6 * 3600));
        }
    });
}

pub fn check(manual: bool) -> Value {
    if !enabled() && !manual {
        return state();
    }
    let busy = with(|s| matches!(s.phase.as_str(), "downloading" | "ready" | "checking"));
    if busy {
        return state();
    }
    with(|s| {
        s.phase = "checking".into();
        s.error.clear();
    });
    changed();
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(12)).build();
    let res = agent
        .get(&format!("https://api.github.com/repos/{OWNER}/{REPO}/releases/latest"))
        .set("User-Agent", &format!("EZ-Suite/{}", util::app_version()))
        .set("Accept", "application/vnd.github+json")
        .call();
    match res {
        Ok(r) => {
            let j: Value = r.into_json().unwrap_or(Value::Null);
            let tag = util::jstr(&j, "tag_name").to_string();
            let latest = util::version_parts(&tag).or_else(|| util::version_parts(util::jstr(&j, "name")));
            let mine = util::version_parts(&util::app_version());
            let newer = matches!((&latest, &mine), (Some(l), Some(m)) if util::is_newer(l, m));
            let draft = util::jbool(&j, "draft", false) || util::jbool(&j, "prerelease", false);
            if newer && !draft {
                let html = util::jstr(&j, "html_url");
                let url = if html.starts_with("https://github.com/") { html.to_string() } else { page() };
                let asset = j["assets"]
                    .as_array()
                    .and_then(|a| {
                        a.iter().find_map(|x| {
                            let n = util::jstr(x, "name").to_lowercase();
                            let u = util::jstr(x, "browser_download_url");
                            (n.ends_with("-setup.exe") && u.starts_with("https://github.com/")).then(|| u.to_string())
                        })
                    })
                    .unwrap_or_default();
                let notes: String = regex::Regex::new(r"<[^>]+>").unwrap().replace_all(util::jstr(&j, "body"), "").trim().chars().take(4000).collect();
                with(|s| {
                    s.phase = "available".into();
                    s.version = latest.unwrap().iter().map(|n| n.to_string()).collect::<Vec<_>>().join(".");
                    s.notes = notes;
                    s.url = url;
                    s.can_install = !asset.is_empty() && !cfg!(debug_assertions);
                    s.asset = asset;
                });
            } else {
                with(|s| {
                    s.phase = "none".into();
                    s.version.clear();
                    s.notes.clear();
                    s.can_install = false;
                });
            }
        }
        Err(ureq::Error::Status(404, _)) => with(|s| {
            s.phase = "none".into();
            s.version.clear();
        }),
        Err(_) => with(|s| {
            s.phase = "error".into();
            s.error = "Couldn't reach GitHub. Check your connection and try again.".into();
        }),
    }
    with(|s| s.checked_at = util::now_ms());
    changed();
    state()
}

pub fn download() -> bool {
    let (phase, can, asset, url) = with(|s| (s.phase.clone(), s.can_install, s.asset.clone(), s.url.clone()));
    if phase == "ready" {
        return install();
    }
    if phase == "downloading" {
        return true;
    }
    if !can || asset.is_empty() {
        open_page_url(&url);
        return false;
    }
    with(|s| {
        s.phase = "downloading".into();
        s.percent = 0;
        s.error.clear();
    });
    changed();
    std::thread::spawn(move || {
        let r = (|| -> Result<std::path::PathBuf, String> {
            let agent = ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(15)).build();
            let resp = agent.get(&asset).set("User-Agent", "EZ-Suite").call().map_err(|e| e.to_string())?;
            let total: u64 = resp.header("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
            let mut rd = resp.into_reader();
            let path = std::env::temp_dir().join(format!("EZ-Suite-Setup-{}.exe", util::new_id()));
            let mut f = std::fs::File::create(&path).map_err(|e| e.to_string())?;
            let mut buf = vec![0u8; 64 * 1024];
            let mut got = 0u64;
            let mut last = 0u32;
            loop {
                let n = rd.read(&mut buf).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                std::io::Write::write_all(&mut f, &buf[..n]).map_err(|e| e.to_string())?;
                got += n as u64;
                if total > 0 {
                    let p = ((got * 100) / total) as u32;
                    if p != last {
                        last = p;
                        with(|s| s.percent = p);
                        changed();
                    }
                }
            }
            if got < 1024 * 1024 {
                return Err("download too small".into());
            }
            Ok(path)
        })();
        match r {
            Ok(p) => with(|s| {
                s.phase = "ready".into();
                s.percent = 100;
                s.file = Some(p);
            }),
            Err(e) => {
                util::log(format!("update download failed: {e}"));
                with(|s| {
                    s.phase = "error".into();
                    s.error = "Download failed. Try again, or get it from the releases page.".into();
                });
            }
        }
        changed();
    });
    true
}

/// Runs the installer silently (it asks Windows for permission once), then starts EZ Suite again.
pub fn install() -> bool {
    let file = with(|s| if s.phase == "ready" { s.file.clone() } else { None });
    let Some(file) = file else { return false };
    let exe = std::env::current_exe().unwrap_or_default();
    let q = |p: &std::path::Path| format!("'{}'", p.to_string_lossy().replace('\'', "''"));
    let ps = format!(
        "Start-Sleep -Milliseconds 800; $p = Start-Process -FilePath {} -ArgumentList '/S' -Verb RunAs -Wait -PassThru; Start-Process -FilePath {}",
        q(&file),
        q(&exe)
    );
    let ok = util::hidden_command("powershell.exe").args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &ps]).spawn().is_ok();
    if ok {
        crate::quit();
    }
    ok
}

fn open_page_url(url: &str) {
    use tauri_plugin_opener::OpenerExt;
    let u = if url.starts_with("https://github.com/") { url.to_string() } else { page() };
    let _ = util::app().opener().open_url(u, None::<&str>);
}

// ---- commands (shared by both pages)

#[tauri::command]
pub fn update_state() -> Value {
    state()
}

#[tauri::command]
pub async fn update_check() -> Value {
    check(true)
}

#[tauri::command]
pub fn update_download() -> bool {
    download()
}

#[tauri::command]
pub fn update_install() -> bool {
    install()
}

#[tauri::command]
pub fn update_open() -> bool {
    let u = with(|s| s.url.clone());
    open_page_url(&u);
    true
}

#[tauri::command]
pub fn update_set_enabled(on: bool) -> Value {
    set_enabled_file(on);
    if on && with(|s| s.phase == "idle") {
        std::thread::spawn(|| check(false));
    }
    changed();
    state()
}

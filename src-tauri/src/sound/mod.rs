//! EZ Soundboard: the library, what happens when a sound is triggered (play modes, auto
//! push-to-talk, ducking), and everything the soundboard page calls.
//!
//! The page (ui/soundboard) owns the library while it's open and saves it here. Everything that
//! must keep working with the window closed lives in Rust: hotkeys, the Stream Deck server,
//! playback, push-to-talk. So the window can be closed (freeing its memory) and the soundboard
//! keeps working from the tray.
pub mod apo;
pub mod decode;
pub mod engine;
mod link;
mod ptt;
mod remote;
mod tts;

use crate::util::{self, jbool, jf64, jstr};
use parking_lot::Mutex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

const AUDIO_EXT: &[&str] = &["mp3", "wav", "ogg", "oga", "flac", "m4a", "aac", "webm", "opus", "mp4"];
const MAX_FILE: u64 = 300 * 1024 * 1024;

struct Sb {
    lib: Value,
    attached: bool,
    typing: bool,
    ptt_held: bool,
}

static SB: Mutex<Option<Sb>> = parking_lot::const_mutex(None);
static PTT_GEN: AtomicU64 = AtomicU64::new(0);
static SAVE_LOCK: Mutex<()> = parking_lot::const_mutex(());

fn with<R>(f: impl FnOnce(&mut Sb) -> R) -> R {
    let mut g = SB.lock();
    let s = g.get_or_insert_with(|| Sb { lib: Value::Null, attached: false, typing: false, ptt_held: false });
    f(s)
}

pub fn sound_dir() -> PathBuf {
    let d = util::data_dir().join("sounds");
    let _ = std::fs::create_dir_all(&d);
    d
}

fn lib_file() -> PathBuf {
    util::data_dir().join("library.json")
}

fn suite_file() -> PathBuf {
    util::data_dir().join("suite.json")
}

fn suite_get(k: &str, def: bool) -> bool {
    util::read_json(&suite_file()).map(|v| jbool(&v, k, def)).unwrap_or(def)
}

fn suite_set(k: &str, v: bool) {
    let mut s = util::read_json(&suite_file()).unwrap_or_else(|| json!({}));
    s[k] = Value::Bool(v);
    let _ = util::write_json_atomic(&suite_file(), &s, true);
}

fn settings() -> Value {
    with(|s| s.lib.get("settings").cloned().unwrap_or(Value::Null))
}

fn find_sound(id: &str) -> Option<Value> {
    with(|s| s.lib.get("sounds").and_then(Value::as_array).and_then(|a| a.iter().find(|x| jstr(x, "id") == id).cloned()))
}

fn safe_file(f: &str) -> Option<PathBuf> {
    let name = Path::new(f).file_name()?.to_string_lossy().to_string();
    if name.is_empty() || name.starts_with('.') {
        return None;
    }
    Some(sound_dir().join(name))
}

// ------------------------------------------------------------------ startup

pub fn init() {
    engine::start();
    tts::cleanup(&sound_dir());
    // Hotkeys, the Stream Deck server and the audio engine work before (and without) the window.
    std::thread::spawn(|| {
        ensure_loaded();
        apply_all();
        if remote_enabled() {
            remote::set_enabled(true);
        }
        preload_pinned();
    });
}

pub fn shutdown() {
    ptt::up();
    tts::cleanup(&sound_dir());
    engine::stop_all();
}

static LOADED: Mutex<bool> = parking_lot::const_mutex(false);

fn ensure_loaded() {
    let mut loaded = LOADED.lock();
    if *loaded {
        return;
    }
    migrate_from_old_app();
    let lib = util::read_json(&lib_file()).unwrap_or(Value::Null);
    with(|s| s.lib = lib);
    *loaded = true;
}

/// First start: bring over the standalone EZ Soundboard's library and sounds.
fn migrate_from_old_app() {
    if lib_file().exists() {
        return;
    }
    for old in ["EZ Soundboard", "Mishez Pad"] {
        let Some(dir) = util::old_app_dir(old) else { continue };
        let Some(mut lib) = util::read_json(&dir.join("library.json")) else { continue };
        if let Ok(rd) = std::fs::read_dir(dir.join("sounds")) {
            let dst = sound_dir();
            for e in rd.flatten() {
                let to = dst.join(e.file_name());
                if !to.exists() {
                    let _ = std::fs::copy(e.path(), to);
                }
            }
        }
        // Device ids from the old app's browser engine don't mean anything here.
        if let Some(st) = lib.get_mut("settings").and_then(Value::as_object_mut) {
            st.insert("monitorDevice".into(), Value::from(""));
            st.insert("micOutDevice".into(), Value::from(""));
            st.insert("micInDevice".into(), Value::from("default"));
            if st.get("micMode").and_then(Value::as_str) == Some("cable") {
                st.insert("setupSeen".into(), Value::Bool(false)); // re-detect VB-CABLE
            }
        }
        let _ = util::write_json_atomic(&lib_file(), &lib, false);
        return;
    }
}

fn save_lib_async() {
    std::thread::spawn(|| {
        let _g = SAVE_LOCK.lock();
        let lib = with(|s| s.lib.clone());
        if lib.is_object() {
            if let Err(e) = util::write_json_atomic(&lib_file(), &lib, false) {
                util::log(format!("library save failed: {e}"));
            }
        }
    });
}

/// Pushes the library's settings into the engine, the cache policy and the hotkeys.
fn apply_all() {
    let st = settings();
    if st.is_null() {
        return;
    }
    engine::apply(engine::EngineSettings::from_json(&st));
    apply_memory();
    let mut binds: Vec<(String, String)> = Vec::new();
    with(|s| {
        if let Some(a) = s.lib.get("sounds").and_then(Value::as_array) {
            for x in a {
                let hk = jstr(x, "hotkey");
                if !hk.is_empty() {
                    binds.push((hk.to_string(), format!("play:{}", jstr(x, "id"))));
                }
            }
        }
    });
    for k in ["stopAll", "toggleMic", "togglePassthrough"] {
        let hk = st.get("hotkeys").map(|h| jstr(h, k)).unwrap_or("");
        if !hk.is_empty() {
            binds.push((hk.to_string(), k.to_string()));
        }
    }
    crate::input::set_hotkeys("sb", &binds);
    crate::perf::refresh();
}

fn apply_memory() {
    let st = settings();
    let mb = match jstr(&st, "memory") {
        "low" => 48,
        "fast" => 512,
        _ => 128,
    };
    // Sounds you can trigger instantly (hotkeys / favorites) stay decoded.
    let pinned: HashSet<String> = with(|s| {
        s.lib
            .get("sounds")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter(|x| (!jstr(x, "hotkey").is_empty() || jbool(x, "fav", false)) && jf64(x, "duration", 0.0) <= 30.0)
                    .map(|x| jstr(x, "file").to_string())
                    .collect()
            })
            .unwrap_or_default()
    });
    decode::set_policy(mb << 20, pinned);
}

/// Decodes hotkey / favorite sounds up front so they fire instantly, spread out so start-up
/// doesn't spike the CPU.
fn preload_pinned() {
    let (_, limit) = decode::bytes();
    for f in decode::pinned() {
        if decode::bytes().0 as f64 > limit as f64 * 0.7 {
            break;
        }
        if !decode::is_cached(&f) {
            let _ = decode::get(&sound_dir(), &f);
            std::thread::sleep(Duration::from_millis(40));
        }
    }
}

// ------------------------------------------------------------------ playback

fn norm_gain(rms: f64) -> f64 {
    if rms <= 0.0 {
        1.0
    } else {
        (0.16 / rms).clamp(0.2, 4.0) // target ≈ -16 dBFS RMS
    }
}

/// What a click, hotkey, Stream Deck key or remote request does.
pub fn trigger(id: &str, monitor_only: bool) {
    let Some(snd) = find_sound(id) else { return };
    if let Err(e) = play_sound(&snd, monitor_only, true) {
        util::emit("sb-toast", json!({ "msg": format!("Couldn't play \u{201c}{}\u{201d}", jstr(&snd, "name")), "kind": "err" }));
        util::log(format!("play failed: {e}"));
    }
}

fn play_sound(snd: &Value, monitor_only: bool, record: bool) -> Result<(), String> {
    let st = settings();
    let id = jstr(snd, "id").to_string();
    match jstr(&st, "playMode") {
        "toggle" if engine::voices_for(&id) > 0 => {
            engine::stop_sound(&id);
            return Ok(());
        }
        "restart" => engine::stop_sound(&id),
        "exclusive" => engine::stop_all(),
        _ => {}
    }
    let file = jstr(snd, "file").to_string();
    // Decode first so push-to-talk isn't held while decoding; the engine wakes meanwhile.
    let waker = std::thread::spawn(engine::wake);
    let buf = decode::get(&sound_dir(), &file)?;
    let _ = waker.join();
    let to_mic = !monitor_only && jbool(&st, "soundsToMic", true);
    let delay_ms = if to_mic { ptt_press(&st) } else { 0.0 };
    let gain = jf64(snd, "volume", 1.0) * if jbool(snd, "normalize", false) { norm_gain(jf64(snd, "rms", 0.0)) } else { 1.0 };
    engine::play(engine::PlayParams {
        sound_id: id.clone(),
        name: jstr(snd, "name").to_string(),
        file,
        buf,
        trim_start: jf64(snd, "trimStart", 0.0),
        trim_end: snd.get("trimEnd").and_then(Value::as_f64),
        speed: jf64(snd, "speed", 1.0),
        gain: gain as f32,
        looping: jbool(snd, "loop", false),
        to_mic,
        delay_s: delay_ms / 1000.0,
    });
    if !monitor_only && record {
        record_play(&id);
    }
    Ok(())
}

fn record_play(id: &str) {
    let attached = with(|s| s.attached);
    if attached {
        util::emit("sb-played", json!({ "id": id }));
        return;
    }
    with(|s| {
        if let Some(a) = s.lib.get_mut("sounds").and_then(Value::as_array_mut) {
            if let Some(x) = a.iter_mut().find(|x| jstr(x, "id") == id) {
                x["plays"] = Value::from(jf64(x, "plays", 0.0) as i64 + 1);
            }
        }
        let mut recent: Vec<Value> = s.lib.get("recent").and_then(Value::as_array).cloned().unwrap_or_default();
        recent.retain(|r| r.as_str() != Some(id));
        recent.insert(0, Value::from(id));
        recent.truncate(40);
        s.lib["recent"] = Value::Array(recent);
    });
    save_lib_async();
}

/// Holds the voice key; returns how long to wait before the sound starts (ms).
fn ptt_press(st: &Value) -> f64 {
    let p = st.get("ptt").cloned().unwrap_or(Value::Null);
    let key = jstr(&p, "key").to_string();
    if !jbool(&p, "enabled", false) || key.is_empty() {
        return 0.0;
    }
    PTT_GEN.fetch_add(1, Ordering::SeqCst); // cancels a pending release
    let held = with(|s| s.ptt_held);
    if held {
        return 0.0;
    }
    ptt::down(&key);
    with(|s| s.ptt_held = true);
    util::emit("sb-ptt", true);
    jf64(&p, "preDelay", 90.0).clamp(0.0, 1000.0)
}

/// Called by the audio engine whenever the list of playing voices changes.
pub fn on_voices_changed() {
    if with(|s| s.attached) {
        util::emit("sb-voices", engine::voices_json());
    }
    let held = with(|s| s.ptt_held);
    if held && engine::mic_voice_count() == 0 {
        let gen = PTT_GEN.fetch_add(1, Ordering::SeqCst) + 1;
        let release = settings().get("ptt").map(|p| jf64(p, "release", 250.0)).unwrap_or(250.0).clamp(0.0, 3000.0);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(release as u64));
            if PTT_GEN.load(Ordering::SeqCst) == gen && engine::mic_voice_count() == 0 && with(|s| s.ptt_held) {
                ptt::up();
                with(|s| s.ptt_held = false);
                util::emit("sb-ptt", false);
            }
        });
    }
}

pub fn engine_awake() -> bool {
    engine::is_awake()
}

// ------------------------------------------------------------------ hotkeys / remote helpers

fn patch_settings(patch: Value, toast: Option<&str>) {
    with(|s| {
        if let (Some(st), Some(p)) = (s.lib.get_mut("settings").and_then(Value::as_object_mut), patch.as_object()) {
            for (k, v) in p {
                st.insert(k.clone(), v.clone());
            }
        }
    });
    apply_all();
    save_lib_async();
    util::emit("sb-settings-patch", json!({ "patch": patch, "toast": toast }));
}

pub fn sounds_to_mic() -> bool {
    jbool(&settings(), "soundsToMic", true)
}

pub fn toggle_sounds_to_mic(on: Option<bool>) {
    let next = on.unwrap_or(!sounds_to_mic());
    patch_settings(json!({ "soundsToMic": next }), Some(if next { "Sounds \u{2192} mic ON" } else { "Sounds \u{2192} mic OFF (only you hear)" }));
}

pub fn on_hotkey(action: &str) {
    if let Some(id) = action.strip_prefix("play:") {
        // Don't fire sound hotkeys while you're typing in EZ Suite itself.
        if with(|s| s.typing) && crate::main_window_focused() {
            return;
        }
        let id = id.to_string();
        std::thread::spawn(move || trigger(&id, false));
        return;
    }
    match action {
        "stopAll" => engine::stop_all(),
        "toggleMic" => toggle_sounds_to_mic(None),
        "togglePassthrough" => {
            let st = settings();
            if jstr(&st, "micMode") == "direct" {
                util::emit("sb-toast", json!({ "msg": "Direct mode never mutes your mic - use the Discord / game mute instead" }));
                return;
            }
            let next = !jbool(&st, "passthrough", true);
            patch_settings(json!({ "passthrough": next }), Some(if next { "Mic passthrough ON" } else { "Mic passthrough OFF" }));
        }
        _ => {}
    }
}

pub fn remote_enabled() -> bool {
    suite_get("remoteControl", true)
}

pub fn remote_library() -> (Vec<Value>, Vec<String>) {
    with(|s| {
        let cats: Vec<(String, String)> = s
            .lib
            .get("categories")
            .and_then(Value::as_array)
            .map(|a| a.iter().map(|c| (jstr(c, "id").to_string(), jstr(c, "name").to_string())).collect())
            .unwrap_or_default();
        let sounds: Vec<Value> = s
            .lib
            .get("sounds")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .take(5000)
                    .map(|x| {
                        let board = x
                            .get("category")
                            .and_then(Value::as_str)
                            .and_then(|c| cats.iter().find(|(id, _)| id == c))
                            .map(|(_, n)| n.clone())
                            .unwrap_or_default();
                        json!({ "id": jstr(x, "id"), "name": jstr(x, "name"), "board": board, "color": jstr(x, "color"), "hotkey": jstr(x, "hotkey") })
                    })
                    .collect()
            })
            .unwrap_or_default();
        (sounds, cats.into_iter().map(|(_, n)| n).collect())
    })
}

pub fn remote_find(q: &Value) -> Option<(String, String)> {
    let (sounds, _) = remote_library();
    if let Some(id) = q.get("id").and_then(Value::as_str) {
        if let Some(s) = sounds.iter().find(|s| jstr(s, "id") == id) {
            return Some((id.to_string(), jstr(s, "name").to_string()));
        }
    }
    let n = q.get("name").and_then(Value::as_str)?.trim().to_lowercase();
    let hit = sounds.iter().find(|s| jstr(s, "name").to_lowercase() == n).or_else(|| sounds.iter().find(|s| jstr(s, "name").to_lowercase().contains(&n)))?;
    Some((jstr(hit, "id").to_string(), jstr(hit, "name").to_string()))
}

/// Stream Deck "Text to speech": speaks into the mic with the saved TTS settings.
pub fn speak_and_play(text: &str, voice: &str) {
    let t = settings().get("tts").cloned().unwrap_or(Value::Null);
    let voice = if voice.is_empty() { jstr(&t, "voice").to_string() } else { voice.to_string() };
    match tts::speak(&sound_dir(), text, &voice, jf64(&t, "rate", 1.0)) {
        Ok(file) => {
            let rms = decode::get(&sound_dir(), &file).map(|b| jf64(&decode::analyse(&b, 32), "rms", 0.0)).unwrap_or(0.0);
            let snd = json!({ "id": format!("tts:{file}"), "name": format!("Speech: {}", text.chars().take(40).collect::<String>()), "file": file, "volume": jf64(&t, "volume", 1.0), "normalize": true, "rms": rms });
            let _ = play_sound(&snd, false, false);
        }
        Err(e) => util::emit("sb-toast", json!({ "msg": e, "kind": "err" })),
    }
}

pub fn ui_detached() {
    with(|s| {
        s.attached = false;
        s.typing = false;
    });
    engine::set_ui_visible(false);
}

// ------------------------------------------------------------------ file helpers

fn walk(dir: &Path, out: &mut Vec<String>, depth: usize) {
    if depth > 6 || out.len() > 3000 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = rd.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let p = e.path();
        if p.is_dir() {
            walk(&p, out, depth + 1);
        } else if is_audio(&p) {
            out.push(p.to_string_lossy().to_string());
        }
    }
}

fn is_audio(p: &Path) -> bool {
    p.extension().map(|e| AUDIO_EXT.contains(&e.to_string_lossy().to_lowercase().as_str())).unwrap_or(false)
}

// ------------------------------------------------------------------ commands

#[tauri::command]
pub async fn sb_load_lib() -> Value {
    ensure_loaded();
    with(|s| s.lib.clone())
}

#[tauri::command]
pub fn sb_attach() {
    with(|s| s.attached = true);
    engine::set_ui_visible(true);
}

#[tauri::command]
pub fn sb_save_lib(data: Value) {
    if !data.is_object() {
        return;
    }
    with(|s| s.lib = data);
    save_lib_async();
    apply_memory();
}

/// Immediate engine update (sliders, toggles, devices) without waiting for the debounced save.
#[tauri::command]
pub fn sb_settings(settings: Value) {
    with(|s| {
        if s.lib.is_object() {
            s.lib["settings"] = settings.clone();
        }
    });
    engine::apply(engine::EngineSettings::from_json(&settings));
    crate::perf::refresh();
}

#[tauri::command]
pub fn sb_typing(on: bool) {
    with(|s| s.typing = on);
}

#[tauri::command]
pub fn sb_ui_visible(on: bool) {
    engine::set_ui_visible(on);
}

#[tauri::command]
pub async fn sb_pick_files() -> Vec<String> {
    use tauri_plugin_dialog::DialogExt;
    util::app()
        .dialog()
        .file()
        .set_title("Add sounds")
        .add_filter("Audio", AUDIO_EXT)
        .blocking_pick_files()
        .map(|v| v.into_iter().filter_map(|f| f.into_path().ok()).map(|p| p.to_string_lossy().to_string()).collect())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn sb_pick_folder() -> Vec<String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(f) = util::app().dialog().file().set_title("Import a folder of sounds").blocking_pick_folder() else { return vec![] };
    let Ok(dir) = f.into_path() else { return vec![] };
    let mut out = Vec::new();
    walk(&dir, &mut out, 0);
    out
}

#[tauri::command]
pub async fn sb_import(paths: Vec<String>) -> Vec<Value> {
    let mut expanded = Vec::new();
    for p in paths {
        let pb = PathBuf::from(&p);
        if pb.is_dir() {
            walk(&pb, &mut expanded, 0);
        } else {
            expanded.push(p);
        }
    }
    let mut out = Vec::new();
    for src in expanded {
        let p = PathBuf::from(&src);
        if !is_audio(&p) {
            continue;
        }
        let Ok(meta) = std::fs::metadata(&p) else { continue };
        if !meta.is_file() || meta.len() > MAX_FILE {
            continue;
        }
        let id = util::new_id();
        let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        let file = format!("{id}.{ext}");
        if std::fs::copy(&p, sound_dir().join(&file)).is_ok() {
            let name = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Sound".into());
            out.push(json!({ "id": id, "file": file, "name": name }));
        }
    }
    out
}

/// A file dropped onto the window (the page reads it; webviews don't expose file paths).
#[tauri::command]
pub fn sb_import_bytes(request: tauri::ipc::Request<'_>) -> Result<Value, String> {
    let raw_name = request.headers().get("x-name").and_then(|v| v.to_str().ok()).unwrap_or("Sound").to_string();
    let name = url::form_urlencoded::parse(format!("n={raw_name}").as_bytes()).next().map(|(_, v)| v.into_owned()).unwrap_or(raw_name);
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else { return Err("expected bytes".into()) };
    let p = Path::new(&name);
    if !is_audio(p) {
        return Err("not audio".into());
    }
    if data.len() as u64 > MAX_FILE || data.is_empty() {
        return Err("too big".into());
    }
    let id = util::new_id();
    let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let file = format!("{id}.{ext}");
    std::fs::write(sound_dir().join(&file), data).map_err(|e| e.to_string())?;
    let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Sound".into());
    Ok(json!({ "id": id, "file": file, "name": stem }))
}

/// Starter pack: starter-sounds/<Board name>/<files>. Files directly in the folder go to no board.
#[tauri::command]
pub async fn sb_starter() -> Vec<Value> {
    let root = util::resource("starter-sounds");
    let mut files = Vec::new();
    walk(&root, &mut files, 0);
    files
        .into_iter()
        .map(|p| {
            let rel = Path::new(&p).strip_prefix(&root).map(|r| r.components().count()).unwrap_or(1);
            let board = if rel > 1 {
                Path::new(&p)
                    .strip_prefix(&root)
                    .ok()
                    .and_then(|r| r.components().next())
                    .map(|c| c.as_os_str().to_string_lossy().to_string())
                    .unwrap_or_default()
            } else {
                String::new()
            };
            json!({ "path": p, "board": board })
        })
        .collect()
}

#[tauri::command]
pub async fn sb_import_url(url: String) -> Value {
    match link::import(&sound_dir(), &url) {
        Ok(s) => json!({ "ok": true, "sound": s }),
        Err(e) => json!({ "ok": false, "error": e.0 }),
    }
}

/// Decodes a sound (caching it) and returns its waveform, loudness and length.
#[tauri::command]
pub async fn sb_analyse(file: String, buckets: Option<usize>) -> Result<Value, String> {
    let b = decode::get(&sound_dir(), &file)?;
    Ok(decode::analyse(&b, buckets.unwrap_or(96)))
}

/// Raw file bytes, for formats only the webview can decode (it turns them into a .wav for us).
#[tauri::command]
pub async fn sb_read_file(file: String) -> Result<tauri::ipc::Response, String> {
    let p = safe_file(&file).ok_or("bad file")?;
    std::fs::read(p).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
}

/// Saves a .wav the webview made from a file we couldn't decode; returns the new file name.
#[tauri::command]
pub fn sb_write_wav(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let old = request.headers().get("x-old").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else { return Err("expected bytes".into()) };
    if data.len() < 44 || &data[0..4] != b"RIFF" {
        return Err("not a wav".into());
    }
    let id = old.split('.').next().filter(|s| s.len() == 12 && s.chars().all(|c| c.is_ascii_hexdigit())).map(str::to_string).unwrap_or_else(util::new_id);
    let file = format!("{id}.wav");
    std::fs::write(sound_dir().join(&file), data).map_err(|e| e.to_string())?;
    if let Some(p) = safe_file(&old) {
        if p.file_name().map(|n| n.to_string_lossy() != file.as_str()).unwrap_or(false) {
            let _ = std::fs::remove_file(p);
        }
    }
    decode::forget(&old);
    Ok(file)
}

#[tauri::command]
pub fn sb_delete(file: String) {
    decode::forget(&file);
    if let Some(p) = safe_file(&file) {
        let _ = std::fs::remove_file(p);
    }
}

#[tauri::command]
pub fn sb_forget(file: String) {
    decode::forget(&file);
}

#[tauri::command]
pub fn sb_reveal(file: String) {
    use tauri_plugin_opener::OpenerExt;
    if let Some(p) = safe_file(&file) {
        let _ = util::app().opener().reveal_item_in_dir(p);
    }
}

/// `sound` is the page's copy (it may be newer than the last save, e.g. a sound added a moment ago).
#[tauri::command]
pub async fn sb_trigger(id: String, monitor_only: Option<bool>, sound: Option<Value>) -> Result<(), String> {
    let snd = sound.filter(|s| jstr(s, "id") == id).or_else(|| find_sound(&id)).ok_or("unknown sound")?;
    play_sound(&snd, monitor_only.unwrap_or(false), true)
}

/// Plays something that isn't in the library (text-to-speech clips).
#[tauri::command]
pub async fn sb_play_clip(sound: Value, monitor_only: Option<bool>) -> Result<(), String> {
    play_sound(&sound, monitor_only.unwrap_or(false), false)
}

#[tauri::command]
pub fn sb_stop(id: u64) {
    engine::stop(id);
}

#[tauri::command]
pub fn sb_stop_sound(sound_id: String) {
    engine::stop_sound(&sound_id);
}

#[tauri::command]
pub fn sb_stop_all() {
    engine::stop_all();
}

#[tauri::command]
pub fn sb_voice_volume(sound_id: String, volume: f64) {
    engine::set_sound_gain(&sound_id, volume as f32);
}

#[tauri::command]
pub fn sb_voices() -> Value {
    json!({ "voices": engine::voices_json(), "ptt": with(|s| s.ptt_held) })
}

#[tauri::command]
pub fn sb_levels() -> Value {
    engine::levels()
}

#[tauri::command]
pub async fn sb_devices() -> Value {
    engine::devices()
}

#[tauri::command]
pub fn sb_route() -> Value {
    let (m, mic, inp) = engine::route_ok();
    json!({ "monitor": m, "mic": mic, "micInput": inp, "awake": engine::is_awake() })
}

#[tauri::command]
pub fn sb_rebuild_audio() {
    engine::rebuild();
}

#[derive(Deserialize)]
pub struct Binding {
    combo: String,
    action: String,
}

#[tauri::command]
pub fn sb_set_hotkeys(bindings: Vec<Binding>) -> Value {
    let b: Vec<(String, String)> = bindings.into_iter().map(|b| (b.combo, b.action)).collect();
    let failed = crate::input::set_hotkeys("sb", &b);
    crate::perf::refresh();
    json!({ "backend": "native", "failed": failed })
}

#[tauri::command]
pub fn sb_suspend_hotkeys(on: bool) {
    crate::input::suspend("sb", on);
}

#[tauri::command]
pub fn sb_apo_available() -> bool {
    apo::available()
}

#[tauri::command]
pub async fn sb_apo_list() -> Value {
    apo::list()
}

#[tauri::command]
pub async fn sb_apo_apply(enable: Vec<String>, disable: Vec<String>) -> Value {
    let r = apo::apply(&enable, &disable);
    engine::rebuild(); // Windows Audio restarted: reopen our devices
    r
}

#[tauri::command]
pub fn sb_apo_status() -> Value {
    engine::apo_status()
}

#[tauri::command]
pub async fn sb_tts_voices(refresh: Option<bool>) -> Value {
    tts::voices(refresh.unwrap_or(false))
}

#[tauri::command]
pub async fn sb_tts_speak(text: String, voice: Option<String>, rate: Option<f64>) -> Value {
    match tts::speak(&sound_dir(), &text, voice.as_deref().unwrap_or(""), rate.unwrap_or(1.0)) {
        Ok(file) => json!({ "ok": true, "file": file }),
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

/// Keeps a spoken clip as a normal sound: renames tts-xxxx.wav so the clean-up leaves it alone.
#[tauri::command]
pub fn sb_tts_keep(file: String) -> Value {
    let name = Path::new(&file).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    if !tts::is_tts_file(&name) {
        return Value::Null;
    }
    let id = util::new_id();
    let to = format!("{id}.wav");
    decode::forget(&name);
    match std::fs::rename(sound_dir().join(&name), sound_dir().join(&to)) {
        Ok(_) => json!({ "id": id, "file": to }),
        Err(_) => Value::Null,
    }
}

fn streamdeck_file() -> PathBuf {
    util::resource("streamdeck/EZ-Soundboard.streamDeckPlugin")
}

#[tauri::command]
pub fn sb_remote_status() -> Value {
    let mut s = remote::status();
    s["enabled"] = Value::Bool(remote_enabled());
    s["pluginAvailable"] = Value::Bool(streamdeck_file().exists());
    s
}

#[tauri::command]
pub fn sb_remote_set_enabled(on: bool) -> Value {
    suite_set("remoteControl", on);
    remote::set_enabled(on);
    let mut s = remote::status();
    s["enabled"] = Value::Bool(on);
    s
}

/// Opening the .streamDeckPlugin file makes the Stream Deck app install it.
#[tauri::command]
pub fn sb_remote_install_plugin() -> Value {
    use tauri_plugin_opener::OpenerExt;
    let f = streamdeck_file();
    if !f.exists() {
        return json!({ "ok": false, "error": "The Stream Deck plugin is not included in this build" });
    }
    match util::app().opener().open_path(f.to_string_lossy(), None::<&str>) {
        Ok(_) => json!({ "ok": true }),
        Err(_) => json!({ "ok": false, "error": "Install the Stream Deck app first (elgato.com/downloads), then try again" }),
    }
}

#[tauri::command]
pub fn sb_get_hw_accel() -> bool {
    suite_get("hardwareAcceleration", true)
}

#[tauri::command]
pub fn sb_set_hw_accel(on: bool) -> bool {
    suite_set("hardwareAcceleration", on);
    true
}

pub fn hardware_acceleration() -> bool {
    suite_get("hardwareAcceleration", true)
}

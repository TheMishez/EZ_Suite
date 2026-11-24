//! EZ Suite: EZ Soundboard + EZ Reticle in one app, with one small Rust backend.
//!
//! One process, one tray icon, one native input thread, one audio engine. The window (a
//! WebView2 page) only exists while it's open: close it and its memory goes back to Windows,
//! while hotkeys, sounds, push-to-talk, the Stream Deck server and the crosshair keep running.
mod crosshair;
mod input;
mod keys;
mod perf;
mod sound;
mod tray;
mod updater;
mod util;

use serde_json::{json, Value};
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const PAGES: &[(&str, &str)] = &[("soundboard", "soundboard/index.html"), ("crosshair", "crosshair/editor.html")];

fn page_path(page: &str) -> &'static str {
    PAGES.iter().find(|(p, _)| *p == page).map(|(_, f)| *f).unwrap_or(PAGES[0].1)
}

fn suite_file() -> std::path::PathBuf {
    util::data_dir().join("suite.json")
}

fn last_page() -> String {
    util::read_json(&suite_file()).map(|v| util::jstr(&v, "page").to_string()).filter(|p| !p.is_empty()).unwrap_or_else(|| "soundboard".into())
}

fn remember_page(page: &str) {
    let mut v = util::read_json(&suite_file()).unwrap_or_else(|| json!({}));
    if util::jstr(&v, "page") != page {
        v["page"] = Value::from(page);
        let _ = util::write_json_atomic(&suite_file(), &v, true);
    }
}

/// WebView2 needs the same browser arguments for every window, so both windows use this.
pub fn browser_args() -> String {
    let mut a = String::from(
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion --disable-background-networking --disable-component-update",
    );
    if !sound::hardware_acceleration() {
        a.push_str(" --disable-gpu");
    }
    a
}

/// Opens (or focuses) the main window, optionally on a specific page.
pub fn show_main(page: Option<&str>) {
    let app = util::app().clone();
    let page = page.map(str::to_string);
    std::thread::spawn(move || {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
            if let Some(p) = page {
                let _ = w.eval(&format!("window.ezGoto && window.ezGoto({})", json!(p)));
            }
            return;
        }
        let p = page.unwrap_or_else(last_page);
        remember_page(&p);
        let built = WebviewWindowBuilder::new(&app, "main", WebviewUrl::App(page_path(&p).into()))
            .title("EZ Suite")
            .inner_size(1360.0, 860.0)
            .min_inner_size(980.0, 640.0)
            .decorations(false)
            .visible(true)
            // HTML drag and drop (pads onto boards, files and links from Explorer / the browser).
            .disable_drag_drop_handler()
            .additional_browser_args(&browser_args())
            .build();
        match built {
            Ok(w) => {
                let _ = w.set_focus();
            }
            Err(e) => util::log(format!("main window failed: {e}")),
        }
    });
}

pub fn main_window_open() -> bool {
    util::try_app().and_then(|a| a.get_webview_window("main")).map(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false)).unwrap_or(false)
}

pub fn main_window_focused() -> bool {
    util::try_app().and_then(|a| a.get_webview_window("main")).map(|w| w.is_focused().unwrap_or(false)).unwrap_or(false)
}

pub fn set_autostart(on: bool) {
    use tauri_plugin_autostart::ManagerExt;
    let al = util::app().autolaunch();
    let _ = if on { al.enable() } else { al.disable() };
}

pub fn quit() {
    shutdown();
    util::app().exit(0);
}

static SHUT: std::sync::Once = std::sync::Once::new();
fn shutdown() {
    SHUT.call_once(|| {
        crosshair::shutdown();
        sound::shutdown();
    });
}

// ------------------------------------------------------------------ shared commands

static PAGE_STATE: parking_lot::Mutex<(String, bool)> = parking_lot::const_mutex((String::new(), false));

/// The crosshair designer counts as open only while its page is shown and the window isn't minimized.
fn sync_editor() {
    let (p, v) = PAGE_STATE.lock().clone();
    crosshair::set_editor_open(v && p == "crosshair" && main_window_open());
}

/// The page reports where it is and whether it's on screen.
#[tauri::command]
fn app_ui_state(page: String, visible: bool) {
    if PAGES.iter().any(|(p, _)| *p == page) {
        remember_page(&page);
    }
    *PAGE_STATE.lock() = (page.clone(), visible);
    sync_editor();
    if page == "soundboard" {
        sound::engine::set_ui_visible(visible);
    } else {
        sound::ui_detached();
    }
    perf::refresh();
}

#[tauri::command]
fn app_goto(window: tauri::WebviewWindow, page: String) {
    remember_page(&page);
    if page != "soundboard" {
        sound::ui_detached();
    }
    let url = format!("/{}", page_path(&page));
    let _ = window.eval(&format!("location.replace({})", json!(url)));
}

#[tauri::command]
fn win_min(window: tauri::WebviewWindow) {
    let _ = window.minimize();
}

#[tauri::command]
fn win_max(window: tauri::WebviewWindow) -> bool {
    let m = window.is_maximized().unwrap_or(false);
    let _ = if m { window.unmaximize() } else { window.maximize() };
    !m
}

#[tauri::command]
fn win_close(window: tauri::WebviewWindow) {
    let _ = window.close();
}

#[tauri::command]
fn win_is_maximized(window: tauri::WebviewWindow) -> bool {
    window.is_maximized().unwrap_or(false)
}

#[tauri::command]
fn app_open_external(url: String) {
    use tauri_plugin_opener::OpenerExt;
    if url.starts_with("https://") || url.starts_with("http://") {
        let _ = util::app().opener().open_url(url, None::<&str>);
    }
}

#[tauri::command]
fn app_clipboard_write(text: String) -> bool {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    util::app().clipboard().write_text(text.chars().take(10000).collect::<String>()).is_ok()
}

#[tauri::command]
fn app_clipboard_read() -> String {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    util::app().clipboard().read_text().unwrap_or_default().chars().take(10000).collect()
}

#[tauri::command]
fn app_version() -> String {
    util::app_version()
}

#[tauri::command]
fn app_relaunch() {
    shutdown();
    util::app().restart();
}

#[tauri::command]
fn app_quit() {
    quit();
}

/// Soundboard "close button minimizes to tray" (when off, closing the window quits).
static CLOSE_TO_TRAY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

#[tauri::command]
fn app_set_close_to_tray(on: bool) {
    CLOSE_TO_TRAY.store(on, std::sync::atomic::Ordering::Relaxed);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let hidden = std::env::args().any(|a| a == "--hidden");
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| show_main(None)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        // Our own Raw Input registration handles hotkeys; the window library must not take it over.
        .device_event_filter(tauri::DeviceEventFilter::Always)
        .invoke_handler(tauri::generate_handler![
            app_ui_state,
            app_goto,
            win_min,
            win_max,
            win_close,
            win_is_maximized,
            app_open_external,
            app_clipboard_write,
            app_clipboard_read,
            app_version,
            app_relaunch,
            app_quit,
            app_set_close_to_tray,
            updater::update_state,
            updater::update_check,
            updater::update_download,
            updater::update_install,
            updater::update_open,
            updater::update_set_enabled,
            crosshair::xh_get_config,
            crosshair::xh_report_meta,
            crosshair::xh_still_frame,
            crosshair::xh_set_crosshair,
            crosshair::xh_save_profile,
            crosshair::xh_load_profile,
            crosshair::xh_delete_profile,
            crosshair::xh_set_profile_hotkey,
            crosshair::xh_set_triggers,
            crosshair::xh_set_mode,
            crosshair::xh_set_overlay,
            crosshair::xh_set_hotkey,
            crosshair::xh_pause_hotkey,
            crosshair::xh_set_settings,
            crosshair::xh_get_perf,
            crosshair::xh_set_games,
            crosshair::xh_list_procs,
            crosshair::xh_get_diag,
            crosshair::xh_set_guide,
            crosshair::xh_export_backup,
            crosshair::xh_import_backup,
            crosshair::xh_list_displays,
            crosshair::xh_set_display,
            crosshair::xh_set_autostart,
            sound::sb_load_lib,
            sound::sb_attach,
            sound::sb_save_lib,
            sound::sb_settings,
            sound::sb_typing,
            sound::sb_ui_visible,
            sound::sb_pick_files,
            sound::sb_pick_folder,
            sound::sb_import,
            sound::sb_import_bytes,
            sound::sb_starter,
            sound::sb_import_url,
            sound::sb_analyse,
            sound::sb_read_file,
            sound::sb_write_wav,
            sound::sb_delete,
            sound::sb_forget,
            sound::sb_reveal,
            sound::sb_trigger,
            sound::sb_play_clip,
            sound::sb_stop,
            sound::sb_stop_sound,
            sound::sb_stop_all,
            sound::sb_voice_volume,
            sound::sb_voices,
            sound::sb_levels,
            sound::sb_devices,
            sound::sb_route,
            sound::sb_rebuild_audio,
            sound::sb_set_hotkeys,
            sound::sb_suspend_hotkeys,
            sound::sb_apo_available,
            sound::sb_apo_list,
            sound::sb_apo_apply,
            sound::sb_apo_status,
            sound::sb_tts_voices,
            sound::sb_tts_speak,
            sound::sb_tts_keep,
            sound::sb_remote_status,
            sound::sb_remote_set_enabled,
            sound::sb_remote_install_plugin,
            sound::sb_get_hw_accel,
            sound::sb_set_hw_accel,
        ])
        .setup(move |app| {
            util::set_app(app.handle().clone());
            std::panic::set_hook(Box::new(|info| util::log(format!("panic: {info}"))));
            input::start();
            crosshair::init();
            sound::init();
            updater::init();
            if let Err(e) = tray::create(app.handle()) {
                util::log(format!("tray failed: {e}"));
            }
            if !hidden && !crosshair::start_hidden() {
                show_main(None);
            }
            perf::refresh();
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            match event {
                WindowEvent::CloseRequested { .. } => {
                    // Closing the window frees its memory; everything else keeps running in the
                    // tray. With "close to tray" off, closing quits.
                    if !CLOSE_TO_TRAY.load(std::sync::atomic::Ordering::Relaxed) {
                        quit();
                    }
                }
                WindowEvent::Destroyed => {
                    PAGE_STATE.lock().1 = false;
                    crosshair::set_editor_open(false);
                    sound::ui_detached();
                    perf::refresh();
                }
                WindowEvent::Focused(_) | WindowEvent::Resized(_) => {
                    sync_editor();
                    perf::refresh();
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building EZ Suite");

    app.run(|_app, event| match event {
        RunEvent::ExitRequested { api, code, .. } => {
            // The last window closing is not a reason to quit: we live in the tray.
            if code.is_none() {
                api.prevent_exit();
            }
        }
        RunEvent::Exit => shutdown(),
        _ => {}
    });
}

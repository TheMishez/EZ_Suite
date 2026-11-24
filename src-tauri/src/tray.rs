//! The tray icon: EZ Suite keeps running here with the window closed.
use crate::util;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Wry};

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let up = crate::updater::state();
    let phase = util::jstr(&up, "phase").to_string();
    let ver = util::jstr(&up, "version").to_string();
    let open = MenuItem::with_id(app, "open", "Open EZ Suite", true, None::<&str>)?;
    let sb = MenuItem::with_id(app, "soundboard", "Soundboard", true, None::<&str>)?;
    let xh = MenuItem::with_id(app, "crosshair", "Crosshair designer", true, None::<&str>)?;
    let toggle =
        MenuItem::with_id(app, "toggle-xh", if crate::crosshair::overlay_visible() { "Hide crosshair" } else { "Show crosshair" }, true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop-all", "Stop all sounds", true, None::<&str>)?;
    let (uid, label, enabled) = match phase.as_str() {
        "ready" => ("update-install", format!("Restart to update to {ver}"), true),
        "available" => ("update-download", format!("Update to {ver}\u{2026}"), true),
        "downloading" => ("update-busy", format!("Downloading update\u{2026} {}%", util::jf64(&up, "percent", 0.0) as u32), false),
        _ => ("update-check", "Check for updates".to_string(), true),
    };
    let update = MenuItem::with_id(app, uid, label.as_str(), enabled, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let s1 = PredefinedMenuItem::separator(app)?;
    let s2 = PredefinedMenuItem::separator(app)?;
    let s3 = PredefinedMenuItem::separator(app)?;
    Menu::with_items(app, &[&open, &sb, &xh, &s1, &toggle, &stop, &s2, &update, &s3, &quit])
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app)?;
    let mut b = TrayIconBuilder::with_id("main").tooltip("EZ Suite").menu(&menu).menu_on_left_click(false);
    if let Ok(i) = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png")) {
        b = b.icon(i);
    }
    b.on_menu_event(|app, ev| match ev.id().as_ref() {
        "open" => crate::show_main(None),
        "soundboard" => crate::show_main(Some("soundboard")),
        "crosshair" => crate::show_main(Some("crosshair")),
        "toggle-xh" => crate::crosshair::toggle_overlay(),
        "stop-all" => crate::sound::engine::stop_all(),
        "update-install" => {
            crate::updater::install();
        }
        "update-download" => {
            crate::show_main(None);
            crate::updater::download();
        }
        "update-check" => {
            std::thread::spawn(|| crate::updater::check(true));
        }
        "quit" => crate::quit(),
        _ => {
            let _ = app;
        }
    })
    .on_tray_icon_event(|_tray, ev| {
        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
            crate::show_main(None);
        }
    })
    .build(app)?;
    Ok(())
}

/// Rebuilds the menu (labels change with the crosshair / update state).
pub fn refresh() {
    let Some(app) = util::try_app() else { return };
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let (Some(tray), Ok(menu)) = (a.tray_by_id("main"), build_menu(&a)) {
            let _ = tray.set_menu(Some(menu));
        }
    });
}

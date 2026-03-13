#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::TrayIconEvent,
    Manager,
};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to AcreOS.", name)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::init())
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![greet])
        .setup(|app| {
            // Build tray menu
            let dashboard = MenuItemBuilder::with_id("dashboard", "Dashboard").build(app)?;
            let field_scout = MenuItemBuilder::with_id("field_scout", "Field Scout").build(app)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit AcreOS").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&dashboard)
                .item(&field_scout)
                .item(&separator)
                .item(&quit)
                .build()?;

            // Get existing tray icon and set menu
            if let Some(tray) = app.tray_by_id("main-tray") {
                tray.set_menu(Some(menu))?;
                tray.on_menu_event(|app, event| match event.id().as_ref() {
                    "dashboard" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.eval("window.location.hash = '#/dashboard'");
                        }
                    }
                    "field_scout" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.eval("window.location.hash = '#/field-scout'");
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                });
                tray.on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { .. } = event {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                });
            }

            // Handle deep links
            let handle = app.handle().clone();
            app.listen("deep-link://new-url", move |event| {
                let payload = event.payload();
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.eval(&format!(
                        "window.__DEEP_LINK_URL__ = '{}'; window.dispatchEvent(new CustomEvent('deep-link', {{ detail: '{}' }}))",
                        payload, payload
                    ));
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running AcreOS desktop application");
}

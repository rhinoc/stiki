mod transcript;

use tauri::Manager;
use tauri::WindowEvent;
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_prevent_default::Flags;
use tauri_plugin_updater::UpdaterExt;
use window_vibrancy::*;

#[tauri::command]
fn get_webview_version() -> String {
    log::info!("[get_webview_version] called");

    let version = tauri::webview_version().unwrap();
    version.into()
}

fn validate_markdown_path(path: &std::path::Path) -> Result<(), String> {
    let Some(extension) = path.extension().and_then(|extension| extension.to_str()) else {
        return Err("Markdown file must use .md or .markdown extension".to_owned());
    };

    match extension.to_ascii_lowercase().as_str() {
        "md" | "markdown" => Ok(()),
        _ => Err("Markdown file must use .md or .markdown extension".to_owned()),
    }
}

#[tauri::command]
fn read_markdown_file(path: String) -> Result<String, String> {
    let path = std::path::PathBuf::from(path);
    validate_markdown_path(&path)?;
    std::fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read Markdown file {}: {error}", path.display()))
}

#[tauri::command]
fn write_markdown_file(path: String, content: String) -> Result<(), String> {
    let path = std::path::PathBuf::from(path);
    validate_markdown_path(&path)?;
    std::fs::write(&path, content)
        .map_err(|error| format!("Failed to write Markdown file {}: {error}", path.display()))
}

fn init_new_window(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    apply_vibrancy(
        &window,
        NSVisualEffectMaterial::Sidebar,
        Some(NSVisualEffectState::Active),
        Some(10.0),
    )
    .expect("Unsupported platform! 'apply_vibrancy' is only supported on macOS");
}

fn build_new_window(handle: &tauri::AppHandle, label: String) {
    let new_window_builder =
        tauri::WebviewWindowBuilder::new(handle, label, tauri::WebviewUrl::default());
    let new_window = new_window_builder
        .transparent(true)
        // .shadow(false)
        .decorations(false)
        .accept_first_mouse(true)
        .inner_size(300.0, 400.0)
        .min_inner_size(200.0, 100.0)
        .visible(false)
        .build()
        .unwrap();
    init_new_window(&new_window);
    #[cfg(target_os = "macos")]
    if let Err(error) = handle.set_activation_policy(tauri::ActivationPolicy::Accessory) {
        log::error!("[build_new_window] set activation policy failed: {error}");
    }
}

fn open_dir(handle: &tauri::AppHandle, path_buf: std::path::PathBuf) {
    let path_str = path_buf.to_str().unwrap();
    log::info!("[open_dir] open log dir: {}", path_str);
    let opener = handle.opener();
    if let Err(error) = opener.open_path(path_str, None::<&str>) {
        log::error!("[open_dir] open path failed: {error}");
    }
}

fn get_window(handle: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    return handle.get_webview_window("main");
}

#[tauri::command]
fn toggle_window(app_handle: tauri::AppHandle) {
    log::info!("[toggle_window] called");
    let window = get_window(&app_handle);
    if window.is_none() {
        log::info!("[toggle_window] create new window");
        build_new_window(&app_handle, "main".to_owned());
        return;
    }
    let w = window.unwrap();
    if w.is_minimized().expect("get is_minimized error") {
        log::info!("[toggle_window] unminimize window");
        if let Err(error) = w.unminimize() {
            log::error!("[toggle_window] unminimize failed: {error}");
        }
        return;
    }

    if w.is_visible().is_ok_and(|is_visible| is_visible) {
        log::info!("[toggle_window] hide window");
        set_window_hide(app_handle, w);
    } else {
        log::info!("[toggle_window] show window");
        set_window_show(app_handle, w);
    }
}

fn set_window_show(app_handle: tauri::AppHandle, w: tauri::WebviewWindow) {
    hide_dock_icon(app_handle.clone());
    let _ = w.show();
    let _ = w.set_focus();
    hide_dock_icon(app_handle.clone());
}

fn set_window_hide(app_handle: tauri::AppHandle, w: tauri::WebviewWindow) {
    hide_dock_icon(app_handle.clone());
    let _ = w.hide();
    hide_dock_icon(app_handle.clone());
}

#[tauri::command]
fn hide_dock_icon(app_handle: tauri::AppHandle) {
    log::info!("[hide_dock_icon] called");

    #[cfg(target_os = "macos")]
    let _ = app_handle.set_activation_policy(tauri::ActivationPolicy::Accessory);
}

#[tauri::command]
fn show_window(app_handle: tauri::AppHandle) {
    log::info!("[show_window] called");
    let window = get_window(&app_handle);
    if window.is_none() {
        log::info!("[show_window] create new window");
        build_new_window(&app_handle, "main".to_owned());
        return;
    }
    let w = window.unwrap();
    if w.is_minimized().expect("get is_minimized error") {
        log::info!("[show_window] unminimize window");
        if let Err(error) = w.unminimize() {
            log::error!("[show_window] unminimize failed: {error}");
        }
        return;
    }

    if !w.is_visible().expect("get is_visible error") {
        log::info!("[show_window] show window");
        set_window_show(app_handle, w);
    }
}

// https://v2.tauri.app/plugin/updater/
async fn update(app: tauri::AppHandle) -> tauri_plugin_updater::Result<()> {
    if let Some(update) = app.updater()?.check().await? {
        let mut downloaded = 0;

        // alternatively we could also call update.download() and update.install() separately
        update
            .download_and_install(
                |chunk_length, content_length| {
                    downloaded += chunk_length;
                    log::info!("[update] downloaded {downloaded} from {content_length:?}");
                },
                || {
                    log::info!("[update] download finished");
                },
            )
            .await?;

        log::info!("[update] update installed");
        app.restart();
    }

    Ok(())
}

pub fn run() {
    let log_level = if cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    };

    // buidler with plugin
    let builder = tauri::Builder::default()
        .manage(transcript::NativeTranscriptState::default())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--flag1", "--flag2"]),
        ))
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log_level)
                .build(),
        )
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(
            tauri_plugin_prevent_default::Builder::new()
                .with_flags(Flags::all().difference(Flags::CONTEXT_MENU))
                .build(),
        );

    let mut app = builder
        .invoke_handler(tauri::generate_handler![
            get_webview_version,
            show_window,
            toggle_window,
            hide_dock_icon,
            read_markdown_file,
            write_markdown_file,
            transcript::list_funasr_model_bundles,
            transcript::open_funasr_models_dir,
            transcript::start_native_transcript,
            transcript::stop_native_transcript
        ])
        .setup(move |app| {
            // tray
            let menu_update = tauri::menu::MenuItem::with_id(
                app,
                "check_for_update",
                "Check for Updates...",
                true,
                None::<&str>,
            )?;

            let version = format!("v{}", app.package_info().version.to_string());
            let menu_version = tauri::menu::Submenu::with_id_and_items(
                app,
                "version",
                version,
                true,
                &[&menu_update],
            )?;
            let menu_divider = tauri::menu::PredefinedMenuItem::separator(app)?;
            let menu_quit =
                tauri::menu::MenuItem::with_id(app, "quit", "Quit", true, Some("Cmd+Q"))?;
            let menu_new = tauri::menu::MenuItem::with_id(
                app,
                "toggle_visibility",
                "Toggle Visibility",
                true,
                None::<&str>,
            )?;
            let menu_open_config_dir = tauri::menu::MenuItem::with_id(
                app,
                "open_config_dir",
                "Open Config Folder",
                true,
                None::<&str>,
            )?;
            let menu_open_log_dir = tauri::menu::MenuItem::with_id(
                app,
                "open_log_dir",
                "Open Log Folder",
                true,
                None::<&str>,
            )?;
            let autostart_manager = app.autolaunch();
            let is_enabled = autostart_manager.is_enabled().unwrap();
            let menu_launch_at_login = tauri::menu::CheckMenuItem::with_id(
                app,
                "launch_at_login",
                "Launch at Login",
                true,
                is_enabled,
                None::<&str>,
            )?;
            let menu = tauri::menu::Menu::with_items(
                app,
                &[
                    &menu_new,
                    &menu_divider,
                    &menu_open_config_dir,
                    &menu_open_log_dir,
                    &menu_launch_at_login,
                    &menu_divider,
                    &menu_version,
                    &menu_quit,
                ],
            )?;

            let tray = app
                .tray_by_id("main")
                .expect("this shouldn't ever fail if configured in tauri.conf.json");
            if let Err(error) = tray.set_menu(Some(menu)) {
                log::error!("[tray] set menu failed: {error}");
            }
            tray.on_menu_event(move |handle, event| match event.id.as_ref() {
                "quit" => {
                    log::info!("[tray#menu] quit");
                    handle.exit(0);
                }
                "check_for_update" => {
                    let handle = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        update(handle).await.unwrap();
                    });
                }
                "launch_at_login" => {
                    let autostart_manager = handle.autolaunch();
                    if menu_launch_at_login.is_checked().unwrap() {
                        log::info!("[tray#menu] enable autolaunch");
                        if let Err(error) = autostart_manager.enable() {
                            log::error!("[tray#menu] enable autolaunch failed: {error}");
                        }
                    } else {
                        log::info!("[tray#menu] disable autolaunch");
                        if let Err(error) = autostart_manager.disable() {
                            log::error!("[tray#menu] disable autolaunch failed: {error}");
                        }
                    }
                }
                "open_config_dir" => {
                    open_dir(handle, handle.path().app_config_dir().unwrap());
                }
                "open_log_dir" => {
                    open_dir(handle, handle.path().app_log_dir().unwrap());
                }
                "toggle_visibility" => {
                    toggle_window(handle.clone());
                }
                _ => {
                    log::error!("menu item {:?} not handled", event.id);
                }
            });

            // window
            build_new_window(app.handle(), "main".to_owned());

            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                log::info!("close requested, will prevent close");
                window.hide().unwrap();
                api.prevent_close();
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    app.run(|_, _| {});
}

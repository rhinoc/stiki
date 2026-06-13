use serde::Serialize;
use std::io::Read;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

const SHELL_TASK_EVENT: &str = "shell-task";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShellTaskEvent {
    task_id: String,
    kind: String,
    chunk: Option<String>,
    exit_code: Option<i32>,
    message: Option<String>,
}

fn emit_shell_event(app: &tauri::AppHandle, event: ShellTaskEvent) {
    if let Err(error) = app.emit(SHELL_TASK_EVENT, event) {
        log::error!("[slash] emit shell event failed: {error}");
    }
}

fn stream_reader(
    app: tauri::AppHandle,
    task_id: String,
    kind: &'static str,
    mut reader: impl Read,
) {
    let mut buffer = [0_u8; 4096];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(size) => {
                emit_shell_event(
                    &app,
                    ShellTaskEvent {
                        task_id: task_id.clone(),
                        kind: kind.to_owned(),
                        chunk: Some(String::from_utf8_lossy(&buffer[..size]).to_string()),
                        exit_code: None,
                        message: None,
                    },
                );
            }
            Err(error) => {
                emit_shell_event(
                    &app,
                    ShellTaskEvent {
                        task_id: task_id.clone(),
                        kind: "error".to_owned(),
                        chunk: None,
                        exit_code: None,
                        message: Some(format!("Failed to read {kind}: {error}")),
                    },
                );
                break;
            }
        }
    }
}

#[tauri::command]
pub fn start_shell_task(
    app: tauri::AppHandle,
    task_id: String,
    command: String,
) -> Result<(), String> {
    let command = command.trim().to_owned();
    if command.is_empty() {
        return Err("Shell command cannot be empty.".to_owned());
    }

    log::info!("[start_shell_task] task_id={task_id} command={command}");
    thread::spawn(move || {
        let mut child = match Command::new("/bin/zsh")
            .arg("-lc")
            .arg(&command)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(child) => child,
            Err(error) => {
                emit_shell_event(
                    &app,
                    ShellTaskEvent {
                        task_id,
                        kind: "error".to_owned(),
                        chunk: None,
                        exit_code: None,
                        message: Some(format!("Failed to start shell command: {error}")),
                    },
                );
                return;
            }
        };

        let mut reader_threads = Vec::new();
        if let Some(stdout) = child.stdout.take() {
            let app = app.clone();
            let task_id = task_id.clone();
            reader_threads.push(thread::spawn(move || {
                stream_reader(app, task_id, "stdout", stdout)
            }));
        }
        if let Some(stderr) = child.stderr.take() {
            let app = app.clone();
            let task_id = task_id.clone();
            reader_threads.push(thread::spawn(move || {
                stream_reader(app, task_id, "stderr", stderr)
            }));
        }

        let exit_status = child.wait();
        for reader_thread in reader_threads {
            if let Err(error) = reader_thread.join() {
                log::error!("[start_shell_task] output reader thread failed: {error:?}");
            }
        }

        match exit_status {
            Ok(status) => emit_shell_event(
                &app,
                ShellTaskEvent {
                    task_id,
                    kind: "finished".to_owned(),
                    chunk: None,
                    exit_code: status.code(),
                    message: None,
                },
            ),
            Err(error) => emit_shell_event(
                &app,
                ShellTaskEvent {
                    task_id,
                    kind: "error".to_owned(),
                    chunk: None,
                    exit_code: None,
                    message: Some(format!("Failed to wait for shell command: {error}")),
                },
            ),
        }
    });

    Ok(())
}

#[tauri::command]
pub fn take_screenshot(app: tauri::AppHandle) -> Result<String, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Failed to get current time: {error}"))?
        .as_secs();
    let screenshot_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?
        .join("screenshots");
    std::fs::create_dir_all(&screenshot_dir).map_err(|error| {
        format!(
            "Failed to create screenshot directory {}: {error}",
            screenshot_dir.display()
        )
    })?;

    let screenshot_path = screenshot_dir.join(format!("screenshot-{timestamp}.png"));
    let output = Command::new("screencapture")
        .arg("-x")
        .arg(&screenshot_path)
        .output()
        .map_err(|error| format!("Failed to start screencapture: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        let message = if stderr.is_empty() {
            "screencapture failed. macOS may require Screen Recording permission for Stiki."
                .to_owned()
        } else {
            stderr
        };
        return Err(message);
    }

    Ok(screenshot_path.to_string_lossy().to_string())
}

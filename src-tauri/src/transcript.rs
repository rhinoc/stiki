use serde::Deserialize;
use serde::Serialize;
use std::io::BufRead;
use std::io::Write;
use std::process::Child;
use std::process::ChildStdin;
use std::process::Command;
use std::process::Stdio;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

const TRANSCRIPT_EVENT: &str = "native-transcript://event";
const FUNASR_MODELS_DIR: &str = "funasr-models";
const FUNASR_REQUIRED_MODEL_DIRS: [&str; 4] = ["asr", "vad", "punc", "speaker"];

#[derive(Default, Clone)]
pub struct NativeTranscriptState {
    children: Arc<Mutex<Vec<NativeTranscriptChild>>>,
}

struct NativeTranscriptChild {
    source: String,
    backend: String,
    model: String,
    locale: String,
    speaker_count: u8,
    silence_timeout_ms: u64,
    is_recording: bool,
    stdin: Option<ChildStdin>,
    child: Child,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeTranscriptControlMessage<'a> {
    #[serde(rename = "type")]
    message_type: &'a str,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeTranscriptPayload {
    #[serde(rename = "type")]
    event_type: String,
    source: Option<String>,
    speaker: Option<String>,
    status: Option<String>,
    text: Option<String>,
    is_final: Option<bool>,
    created_at: i64,
    message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeTranscriptErrorPayload {
    #[serde(rename = "type")]
    event_type: &'static str,
    source: Option<String>,
    speaker: Option<String>,
    status: Option<String>,
    text: Option<String>,
    is_final: Option<bool>,
    created_at: i64,
    message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FunASRModelBundleOption {
    label: String,
    model: String,
    is_local: bool,
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

fn emit_error(app: &tauri::AppHandle, message: String) {
    let _ = app.emit(
        TRANSCRIPT_EVENT,
        NativeTranscriptErrorPayload {
            event_type: "error",
            source: None,
            speaker: None,
            status: None,
            text: None,
            is_final: None,
            created_at: now_millis(),
            message,
        },
    );
}

fn native_transcriber_path() -> Result<std::path::PathBuf, String> {
    let bundled = std::env::current_exe()
        .ok()
        .and_then(|path| {
            path.parent()
                .map(|parent| parent.join("stiki-native-transcriber"))
        })
        .filter(|path| path.exists());

    if let Some(path) = bundled {
        return Ok(path);
    }

    let configured = option_env!("STIKI_NATIVE_TRANSCRIBER")
        .map(std::path::PathBuf::from)
        .filter(|path| path.exists());

    if let Some(path) = configured {
        return Ok(path);
    }

    Err("Native transcriber helper was not built.".to_owned())
}

fn bundled_resource_path(relative: &[&str]) -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let contents_dir = exe.parent()?.parent()?;
    let mut path = contents_dir.join("Resources");
    for part in relative {
        path.push(part);
    }
    path.exists().then_some(path)
}

fn funasr_python_path() -> Option<String> {
    bundled_resource_path(&["transcriber", "runtime", "bin", "python3.12"])
        .or_else(|| bundled_resource_path(&["transcriber", "runtime", "bin", "python"]))
        .or_else(|| option_env!("STIKI_FUNASR_PYTHON").map(std::path::PathBuf::from))
        .filter(|path| path.exists())
        .map(|path| path.to_string_lossy().to_string())
}

fn funasr_script_path() -> Option<String> {
    bundled_resource_path(&["transcriber", "scripts", "funasr_worker.py"])
        .or_else(|| option_env!("STIKI_FUNASR_SCRIPT").map(std::path::PathBuf::from))
        .filter(|path| path.exists())
        .map(|path| path.to_string_lossy().to_string())
}

fn funasr_models_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|path| path.join(FUNASR_MODELS_DIR))
        .map_err(|error| format!("Failed to resolve FunASR models folder: {error}"))
}

fn ensure_funasr_models_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let path = funasr_models_dir(app)?;
    std::fs::create_dir_all(&path).map_err(|error| {
        format!(
            "Failed to create FunASR models folder {}: {error}",
            path.display()
        )
    })?;
    Ok(path)
}

fn is_funasr_model_bundle(path: &std::path::Path) -> bool {
    FUNASR_REQUIRED_MODEL_DIRS
        .iter()
        .all(|dirname| path.join(dirname).is_dir())
}

#[tauri::command]
pub fn list_funasr_model_bundles(
    app: tauri::AppHandle,
) -> Result<Vec<FunASRModelBundleOption>, String> {
    let models_dir = ensure_funasr_models_dir(&app)?;
    let mut options = Vec::new();

    let entries = std::fs::read_dir(&models_dir).map_err(|error| {
        format!(
            "Failed to read FunASR models folder {}: {error}",
            models_dir.display()
        )
    })?;

    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let entry_path = entry.path();
        if !file_type.is_dir() && !(file_type.is_symlink() && entry_path.is_dir()) {
            continue;
        }
        if !is_funasr_model_bundle(&entry_path) {
            continue;
        }

        let label = entry.file_name().to_string_lossy().trim().to_owned();
        if label.is_empty() {
            continue;
        }

        options.push(FunASRModelBundleOption {
            label,
            model: entry_path.to_string_lossy().to_string(),
            is_local: true,
        });
    }

    options.sort_by(|left, right| left.label.to_lowercase().cmp(&right.label.to_lowercase()));
    Ok(options)
}

#[tauri::command]
pub fn open_funasr_models_dir(app: tauri::AppHandle) -> Result<String, String> {
    let path = ensure_funasr_models_dir(&app)?;
    let path_str = path.to_string_lossy().to_string();
    app.opener()
        .open_path(&path_str, None::<&str>)
        .map_err(|error| {
            format!(
                "Failed to open FunASR models folder {}: {error}",
                path.display()
            )
        })?;
    Ok(path_str)
}

fn clean_finished_child(state: &NativeTranscriptState) {
    let Ok(mut guard) = state.children.lock() else {
        return;
    };

    guard.retain_mut(|running| running.child.try_wait().ok().flatten().is_none());
}

fn transcript_sources(source: Option<String>) -> Vec<String> {
    match source.as_deref() {
        Some("both") | None => vec!["system".to_owned(), "microphone".to_owned()],
        Some("microphone") => vec!["microphone".to_owned()],
        Some("system") => vec!["system".to_owned()],
        Some(value) => vec![value.to_owned()],
    }
}

fn send_child_control(child: &mut NativeTranscriptChild, message_type: &str) -> Result<(), String> {
    let Some(stdin) = child.stdin.as_mut() else {
        return Err("Native transcriber helper does not accept control messages.".to_owned());
    };
    let data = serde_json::to_vec(&NativeTranscriptControlMessage { message_type })
        .map_err(|error| format!("Failed to encode native transcriber control message: {error}"))?;
    stdin
        .write_all(&data)
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
        .map_err(|error| format!("Failed to send native transcriber control message: {error}"))
}

fn child_matches(
    child: &NativeTranscriptChild,
    source: &str,
    backend: &str,
    model: &str,
    locale: &str,
    speaker_count: u8,
    silence_timeout_ms: u64,
) -> bool {
    child.source == source
        && child.backend == backend
        && child.model == model
        && child.locale == locale
        && child.speaker_count == speaker_count
        && child.silence_timeout_ms == silence_timeout_ms
}

struct NativeTranscriptSpawnConfig {
    source: String,
    locale: String,
    backend: String,
    model: String,
    speaker_count: u8,
    silence_timeout_ms: u64,
    server: bool,
    start_capture: bool,
}

fn spawn_native_transcript_child(
    app: &tauri::AppHandle,
    state: &NativeTranscriptState,
    helper_path: &std::path::Path,
    funasr_python: Option<&String>,
    funasr_script: Option<&String>,
    config: NativeTranscriptSpawnConfig,
) -> Result<NativeTranscriptChild, String> {
    log::info!(
        "[native-transcript] starting helper={} source={} locale={} backend={} server={} start_capture={}",
        helper_path.display(),
        config.source,
        config.locale,
        config.backend,
        config.server,
        config.start_capture,
    );

    let mut command = Command::new(helper_path);
    command
        .arg("--source")
        .arg(&config.source)
        .arg("--locale")
        .arg(&config.locale)
        .arg("--backend")
        .arg(&config.backend)
        .arg("--model")
        .arg(&config.model)
        .arg("--speaker-count")
        .arg(config.speaker_count.to_string())
        .arg("--silence-timeout-ms")
        .arg(config.silence_timeout_ms.to_string());

    if config.server {
        command.arg("--server");
    }
    if config.start_capture {
        command.arg("--start-capture");
    }
    if let Some(path) = funasr_python {
        command.arg("--funasr-python").arg(path);
    }
    if let Some(path) = funasr_script {
        command.arg("--funasr-script").arg(path);
    }

    let mut child = command
        .stdin(if config.server {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            format!(
                "Failed to start native transcriber ({}): {error}",
                config.source
            )
        })?;

    let child_id = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdin = child.stdin.take();
    let state_for_monitor = state.clone();
    let app_for_monitor = app.clone();
    let source_for_monitor = config.source.clone();

    if let Some(stdout) = stdout {
        let app_for_stdout = app.clone();
        std::thread::spawn(move || {
            let reader = std::io::BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                match serde_json::from_str::<NativeTranscriptPayload>(&line) {
                    Ok(payload) => {
                        if payload.event_type == "debug" {
                            if let Some(message) = payload.message.as_ref() {
                                log::info!("[native-transcript] {message}");
                            }
                        }

                        let _ = app_for_stdout.emit(TRANSCRIPT_EVENT, payload);
                    }
                    Err(error) => {
                        emit_error(
                            &app_for_stdout,
                            format!("Native transcriber emitted invalid JSON: {error}"),
                        );
                    }
                }
            }
        });
    }

    if let Some(stderr) = stderr {
        let app_for_stderr = app.clone();
        std::thread::spawn(move || {
            let reader = std::io::BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                log::error!("[native-transcript] {line}");
                emit_error(&app_for_stderr, line);
            }
        });
    }

    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(500));

        let Ok(mut guard) = state_for_monitor.children.lock() else {
            break;
        };

        let Some(index) = guard
            .iter()
            .position(|running| running.child.id() == child_id)
        else {
            break;
        };

        match guard[index].child.try_wait() {
            Ok(Some(status)) => {
                let source = guard[index].source.clone();
                guard.remove(index);
                if !status.success() {
                    emit_error(
                        &app_for_monitor,
                        format!("Native transcriber ({source}) exited with status {status}."),
                    );
                }
                break;
            }
            Ok(None) => {}
            Err(error) => {
                guard.remove(index);
                emit_error(
                    &app_for_monitor,
                    format!("Failed to watch native transcriber ({source_for_monitor}): {error}"),
                );
                break;
            }
        }
    });

    Ok(NativeTranscriptChild {
        source: config.source,
        backend: config.backend,
        model: config.model,
        locale: config.locale,
        speaker_count: config.speaker_count,
        silence_timeout_ms: config.silence_timeout_ms,
        is_recording: config.start_capture,
        stdin,
        child,
    })
}

#[tauri::command]
pub fn preload_funasr_model(
    app: tauri::AppHandle,
    state: tauri::State<NativeTranscriptState>,
    source: Option<String>,
    locale: Option<String>,
    model: Option<String>,
    speaker_count: Option<u8>,
    silence_timeout_ms: Option<u64>,
) -> Result<(), String> {
    clean_finished_child(&state);

    let model = model.unwrap_or_default();
    if model.trim().is_empty() {
        return Ok(());
    }

    let mut guard = state
        .children
        .lock()
        .map_err(|_| "Native transcript state lock was poisoned.".to_owned())?;
    let sources = transcript_sources(source);
    let locale = locale.unwrap_or_else(|| "en-US".to_owned());
    let backend = "funasr-local".to_owned();
    let speaker_count = speaker_count.unwrap_or(2).min(8);
    let silence_timeout_ms = silence_timeout_ms.unwrap_or(1200).clamp(400, 5000);
    let helper_path = native_transcriber_path()?;
    let funasr_python = funasr_python_path();
    let funasr_script = funasr_script_path();

    for source in sources {
        if guard.iter().any(|child| {
            child_matches(
                child,
                &source,
                &backend,
                &model,
                &locale,
                speaker_count,
                silence_timeout_ms,
            )
        }) {
            continue;
        }

        guard.retain_mut(|child| {
            if child.source == source && child.backend == "funasr-local" && !child.is_recording {
                let _ = send_child_control(child, "shutdown");
                let _ = child.child.kill();
                let _ = child.child.wait();
                return false;
            }
            true
        });

        let child = spawn_native_transcript_child(
            &app,
            &state,
            &helper_path,
            funasr_python.as_ref(),
            funasr_script.as_ref(),
            NativeTranscriptSpawnConfig {
                source,
                locale: locale.clone(),
                backend: backend.clone(),
                model: model.clone(),
                speaker_count,
                silence_timeout_ms,
                server: true,
                start_capture: false,
            },
        )?;
        guard.push(child);
    }

    Ok(())
}

#[tauri::command]
pub fn start_native_transcript(
    app: tauri::AppHandle,
    state: tauri::State<NativeTranscriptState>,
    source: Option<String>,
    locale: Option<String>,
    backend: Option<String>,
    model: Option<String>,
    speaker_count: Option<u8>,
    silence_timeout_ms: Option<u64>,
) -> Result<(), String> {
    clean_finished_child(&state);

    let mut guard = state
        .children
        .lock()
        .map_err(|_| "Native transcript state lock was poisoned.".to_owned())?;

    if guard.iter().any(|child| child.is_recording) {
        return Ok(());
    }

    let sources = transcript_sources(source);
    let locale = locale.unwrap_or_else(|| "en-US".to_owned());
    let backend = backend.unwrap_or_else(|| "apple".to_owned());
    let model = model.unwrap_or_else(|| {
        if backend == "funasr-local" {
            String::new()
        } else {
            String::new()
        }
    });
    let speaker_count = speaker_count.unwrap_or(2).min(8);
    let silence_timeout_ms = silence_timeout_ms.unwrap_or(1200).clamp(400, 5000);
    let helper_path = native_transcriber_path()?;
    let funasr_python = funasr_python_path();
    let funasr_script = funasr_script_path();

    for source in sources {
        if backend == "funasr-local" {
            if let Some(index) = guard.iter().position(|child| {
                child_matches(
                    child,
                    &source,
                    &backend,
                    &model,
                    &locale,
                    speaker_count,
                    silence_timeout_ms,
                )
            }) {
                send_child_control(&mut guard[index], "startCapture")?;
                guard[index].is_recording = true;
                continue;
            }

            guard.retain_mut(|child| {
                if child.source == source && child.backend == "funasr-local" {
                    let _ = send_child_control(child, "shutdown");
                    let _ = child.child.kill();
                    let _ = child.child.wait();
                    return false;
                }
                true
            });
        }

        let use_server = backend == "funasr-local";
        let child = spawn_native_transcript_child(
            &app,
            &state,
            &helper_path,
            funasr_python.as_ref(),
            funasr_script.as_ref(),
            NativeTranscriptSpawnConfig {
                source,
                locale: locale.clone(),
                backend: backend.clone(),
                model: model.clone(),
                speaker_count,
                silence_timeout_ms,
                server: use_server,
                start_capture: true,
            },
        )?;
        guard.push(child);
    }

    Ok(())
}

#[tauri::command]
pub fn stop_native_transcript(state: tauri::State<NativeTranscriptState>) -> Result<(), String> {
    let mut guard = state
        .children
        .lock()
        .map_err(|_| "Native transcript state lock was poisoned.".to_owned())?;

    let mut index = 0;
    while index < guard.len() {
        if guard[index].backend == "funasr-local" && guard[index].stdin.is_some() {
            if guard[index].is_recording {
                send_child_control(&mut guard[index], "stopCapture")?;
                guard[index].is_recording = false;
            }
            index += 1;
            continue;
        }

        let mut running = guard.remove(index);
        let _ = running.child.kill();
        let _ = running.child.wait();
    }

    Ok(())
}

#[tauri::command]
pub fn shutdown_native_transcript(
    state: tauri::State<NativeTranscriptState>,
) -> Result<(), String> {
    let children = state
        .children
        .lock()
        .map_err(|_| "Native transcript state lock was poisoned.".to_owned())?
        .drain(..)
        .collect::<Vec<_>>();

    for mut running in children {
        let _ = send_child_control(&mut running, "shutdown");
        let _ = running.child.kill();
        let _ = running.child.wait();
    }

    Ok(())
}

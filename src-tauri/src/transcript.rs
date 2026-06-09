use serde::Deserialize;
use serde::Serialize;
use std::io::BufRead;
use std::process::Child;
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
    child: Child,
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
        .and_then(|path| path.parent().map(|parent| parent.join("stiki-native-transcriber")))
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
    std::fs::create_dir_all(&path)
        .map_err(|error| format!("Failed to create FunASR models folder {}: {error}", path.display()))?;
    Ok(path)
}

fn is_funasr_model_bundle(path: &std::path::Path) -> bool {
    FUNASR_REQUIRED_MODEL_DIRS
        .iter()
        .all(|dirname| path.join(dirname).is_dir())
}

#[tauri::command]
pub fn list_funasr_model_bundles(app: tauri::AppHandle) -> Result<Vec<FunASRModelBundleOption>, String> {
    let models_dir = ensure_funasr_models_dir(&app)?;
    let mut options = Vec::new();

    let entries = std::fs::read_dir(&models_dir)
        .map_err(|error| format!("Failed to read FunASR models folder {}: {error}", models_dir.display()))?;

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
        .map_err(|error| format!("Failed to open FunASR models folder {}: {error}", path.display()))?;
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

    if !guard.is_empty() {
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
        log::info!(
            "[native-transcript] starting helper={} source={} locale={}",
            helper_path.display(),
            source,
            locale
        );

        let mut command = Command::new(&helper_path);
        command
            .arg("--source")
            .arg(&source)
            .arg("--locale")
            .arg(&locale)
            .arg("--backend")
            .arg(&backend)
            .arg("--model")
            .arg(&model)
            .arg("--speaker-count")
            .arg(speaker_count.to_string())
            .arg("--silence-timeout-ms")
            .arg(silence_timeout_ms.to_string());

        if let Some(path) = funasr_python.as_ref() {
            command.arg("--funasr-python").arg(path);
        }
        if let Some(path) = funasr_script.as_ref() {
            command.arg("--funasr-script").arg(path);
        }

        let mut child = command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Failed to start native transcriber ({source}): {error}"))?;

        let child_id = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let state_for_monitor = state.inner().clone();
        let app_for_monitor = app.clone();
        let source_for_monitor = source.clone();

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

        guard.push(NativeTranscriptChild { source, child });

        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(500));

            let Ok(mut guard) = state_for_monitor.children.lock() else {
                break;
            };

            let Some(index) = guard.iter().position(|running| running.child.id() == child_id) else {
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
    }

    Ok(())
}

#[tauri::command]
pub fn stop_native_transcript(state: tauri::State<NativeTranscriptState>) -> Result<(), String> {
    let children = state
        .children
        .lock()
        .map_err(|_| "Native transcript state lock was poisoned.".to_owned())?
        .drain(..)
        .collect::<Vec<_>>();

    for mut running in children {
        let _ = running.child.kill();
        let _ = running.child.wait();
    }

    Ok(())
}

use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn swift_triple_for_target(target: &str) -> Option<&'static str> {
    match target {
        "aarch64-apple-darwin" => Some("arm64-apple-macosx14.0"),
        "x86_64-apple-darwin" => Some("x86_64-apple-macosx14.0"),
        _ => None,
    }
}

fn build_native_transcriber() {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR missing"));
    let package_path = manifest_dir.join("native").join("transcriber");
    let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".to_owned());
    let configuration = if profile == "release" { "release" } else { "debug" };
    let target = env::var("TARGET").unwrap_or_else(|_| "aarch64-apple-darwin".to_owned());
    let swift_triple = swift_triple_for_target(&target);

    println!("cargo:rerun-if-changed={}", package_path.join("Package.swift").display());
    println!("cargo:rerun-if-changed={}", package_path.join("Info.plist").display());
    println!(
        "cargo:rerun-if-changed={}",
        package_path.join("scripts").join("funasr_worker.py").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        package_path
            .join("Sources")
            .join("StikiNativeTranscriber")
            .join("main.swift")
            .display()
    );

    let mut command = Command::new("swift");
    command
        .arg("build")
        .arg("--package-path")
        .arg(&package_path)
        .arg("-c")
        .arg(configuration);
    if let Some(swift_triple) = swift_triple {
        command.arg("--triple").arg(swift_triple);
    }

    let status = command.status().expect("failed to run swift build for native transcriber");

    if !status.success() {
        panic!("native transcriber swift build failed");
    }

    let helper_path = if let Some(swift_triple) = swift_triple {
        package_path
            .join(".build")
            .join(swift_triple.trim_end_matches("14.0"))
            .join(configuration)
            .join("stiki-native-transcriber")
    } else {
        package_path
            .join(".build")
            .join(configuration)
            .join("stiki-native-transcriber")
    };

    if helper_path.exists() {
        let _ = Command::new("codesign")
            .arg("--force")
            .arg("--sign")
            .arg("-")
            .arg("--identifier")
            .arg("com.rhinoc.stiki.transcriber")
            .arg(&helper_path)
            .status();
    }

    let bundle_dir = package_path.join("bundle");
    fs::create_dir_all(&bundle_dir).expect("failed to create native transcriber bundle directory");
    let bundled_helper_path = bundle_dir.join("stiki-native-transcriber");
    fs::copy(&helper_path, &bundled_helper_path).expect("failed to stage native transcriber helper");

    if profile != "release" {
        println!("cargo:rustc-env=STIKI_NATIVE_TRANSCRIBER={}", bundled_helper_path.display());
        println!(
            "cargo:rustc-env=STIKI_FUNASR_SCRIPT={}",
            package_path.join("scripts").join("funasr_worker.py").display()
        );
        println!(
            "cargo:rustc-env=STIKI_FUNASR_PYTHON={}",
            package_path.join(".venv").join("bin").join("python").display()
        );
    }
}

fn main() {
    build_native_transcriber();
    tauri_build::build()
}

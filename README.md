<div align="center">
  <br />
  <img src="./src-tauri/icons/icon.png" alt="Stiki app icon" width="112" height="112" />
  <h1>Stiki</h1>
  <p>Your notes, always close by.<br />
  A compact native macOS sticky-note app for rich Markdown notes, linked files, theme tuning, and live transcript capture.</p>
  <p>
    <a href="https://github.com/rhinoc/stiki/releases">Releases</a>
    &nbsp;·&nbsp;
    <a href="./LICENSE">License</a>
    &nbsp;·&nbsp;
    <a href="./CREDITS.md">Credits</a>
    &nbsp;·&nbsp;
    <a href="./CONTRIBUTING.md">Contributing</a>
  </p>
  <br />
</div>

## Screenshots

<table>
  <tr>
    <td align="center">
      <img src="./assets/showcase-normal.png" width="250" alt="Stiki main note window with rich Markdown content" />
      <br />
      <sub>Markdown sticky note</sub>
    </td>
    <td align="center">
      <img src="./assets/showcase-color-pick.png" width="250" alt="Stiki theme color picker with note window" />
      <br />
      <sub>Theme color tuning</sub>
    </td>
    <td align="center">
      <img src="./assets/showcase-collapsed.png" width="250" alt="Stiki folded compact window" />
      <br />
      <sub>Folded window mode</sub>
    </td>
  </tr>
</table>

## Features

- 📝 **Markdown sticky notes** — Keep quick notes in a compact rich editor with task lists, links, code blocks, images, and clean Markdown output.
- 🔗 **Linked Markdown files** — Link a tab to a `.md` or `.markdown` file and let Stiki autosave changes back to disk.
- 🗂️ **A few notes, one small window** — Switch between labeled tabs without turning your desktop into a pile of note windows.
- 📌 **Always within reach** — Pin it above other windows, fold it down, hide it to the tray, or bring it back with `stiki://toggle-window`.
- 🎙️ **Live transcript capture** — Append mic or system-audio transcripts to the current note with Apple Speech, or use local FunASR bundles for speaker-labeled segments.

## Requirements

- **macOS** for the packaged desktop app and release DMGs.
- **Network access** for release downloads and update checks.
- **Microphone, speech recognition, and system audio permissions** are requested only when transcript capture is used.

## Install

Stiki ships as a macOS disk image. Download the latest **`stiki-<version>-<arch>.dmg`** from **[GitHub Releases](https://github.com/rhinoc/stiki/releases)**.

1. Open the DMG (double-click the download).
2. In the mounted window, drag **`stiki.app`** onto the **Applications** shortcut.
3. Eject the disk image, then launch **Stiki** from **Applications**, Spotlight, or the tray.

The DMG contains `stiki.app` and an **Applications** shortcut only — there is no separate installer or package manager step.

### First launch and Gatekeeper

Browser downloads are tagged with Gatekeeper **quarantine** (`com.apple.quarantine`). If macOS warns that the app cannot be opened or is from an unidentified developer, use one of the options below after copying the app to **Applications**.

Remove quarantine from the installed app:

```bash
xattr -dr com.apple.quarantine /Applications/stiki.app
```

Or **Control-click (or right-click) → Open** on `stiki.app` once and confirm in the dialog. macOS records that exception for future launches.

In-app updates use the same packaged app format. If macOS leaves an updated app outside `/Applications`, drag the updated `stiki.app` into **Applications** the same way.

## Usage

**First launch** creates Stiki's local app state and opens a starter note. App-managed notes and preferences are stored locally; linked Markdown files remain in the file locations you choose.

### Tabs and notes

Use the footer toolbar to add tabs, rename them, assign emoji markers, switch notes, clear content, copy Markdown, or toggle power mode. Each tab keeps its own editor content and label.

### Markdown files

Stiki can link the current tab to a Markdown file. Choose a `.md` or `.markdown` file to open it into the current tab, or save the current tab as a Markdown file and keep it linked for autosave.

Linked tabs show their file path in the tab tooltip. Use the footer toolbar to save immediately or unlink the tab when you want it to return to app-managed storage only.

### Window and tray

Use the header toolbar to pin Stiki above other windows or fold the window down to a smaller height. Closing the window hides it instead of quitting the app.

The tray menu can show or hide the window, toggle launch at startup, check for updates, or quit Stiki.

### Theme tuning

Use the theme control in the header toolbar to adjust the accent color. Stiki stores separate light and dark accent values and follows the system color scheme.

### Transcript capture

Use the microphone button in the footer toolbar to start or stop transcript capture. The transcript source can be microphone audio, system audio, or both. When both sources are enabled, Stiki suppresses close duplicate transcript snippets from different sources so system audio picked up by the microphone is less likely to be written twice.

The transcript backend defaults to **Apple Speech**. Apple Speech uses macOS speech recognition and does not require a local model folder.

The footer toolbar menu includes transcript settings for source, language, backend, local FunASR model bundle, max speakers, silence timeout, and output format. Transcript format can include or omit a 24-hour timestamp and speaker label. With Apple Speech, speaker labels fall back to the audio source (`Mic:` or `System:`). With FunASR, Stiki uses the user-provided speaker model for diarization and writes labels such as `Speaker 1:` when FunASR returns speaker-attributed segments. For small conversations, set **Max Speakers** to the largest expected number of speakers to keep embedding drift from creating extra labels. Increase **Silence Timeout** when transcript segments are being cut too aggressively.

#### Local FunASR models

FunASR models are bring-your-own-model. Stiki release builds include the local inference runtime, but model files are not bundled, committed, or downloaded by Stiki. Users must provide every model directory locally and can keep large model directories wherever they prefer.

To add a local FunASR model bundle:

1. Open the footer toolbar menu.
2. Choose **Backend: FunASR**.
3. Choose **FunASR Model Bundle → Open Models Folder...**.
4. Put a complete model bundle directory in that folder, or create a symbolic link to a bundle stored elsewhere.
5. Choose **FunASR Model Bundle → Refresh Models**.
6. Select the model bundle from the **FunASR Model Bundle** submenu.

The models folder is:

```text
~/Library/Application Support/com.rhinoc.stiki/funasr-models/
```

Each direct child directory or symbolic link is treated as one selectable model bundle only when it contains all required subdirectories:

```text
MyFunASRBundle/
  asr/      # ASR model, for example SenseVoiceSmall
  vad/      # VAD model, for example FSMN-VAD
  punc/     # punctuation model, for example CT-Punc
  speaker/  # speaker embedding/diarization model, for example CAM++
```

To download the example ModelScope models and expose them as one Stiki bundle:

```bash
python3 -m pip install --user "modelscope==1.37.1"

python3 <<'PY'
from pathlib import Path
from modelscope import snapshot_download

bundle = Path.home() / "funasr-stiki-bundle"
models_dir = Path.home() / "Library/Application Support/com.rhinoc.stiki/funasr-models"
bundle.mkdir(parents=True, exist_ok=True)
models_dir.mkdir(parents=True, exist_ok=True)


def replace_symlink(path, target):
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.exists():
        raise SystemExit(f"{path} exists and is not a symlink; move it first.")
    path.symlink_to(target, target_is_directory=True)


models = {
    "asr": "iic/SenseVoiceSmall",
    "vad": "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch",
    "punc": "iic/punc_ct-transformer_cn-en-common-vocab471067-large",
    "speaker": "iic/speech_campplus_sv_zh-cn_16k-common",
}

for name, model_id in models.items():
    replace_symlink(bundle / name, Path(snapshot_download(model_id)).expanduser())

app_bundle = models_dir / "FunASRBundle"
replace_symlink(app_bundle, bundle)
print(app_bundle)
PY
```

Different model sizes, checkpoints, or parameter variants can be exposed by adding more complete bundle directories or links with different names. Stiki lists only direct child directories and symlinks that contain `asr/`, `vad/`, `punc/`, and `speaker/`.

### Deep links

Use this URL to toggle the main window from launchers or scripts:

```text
stiki://toggle-window
```

### Local data locations

| Location | What it stores | Notes |
| --- | --- | --- |
| `~/Library/Application Support/com.rhinoc.stiki/` | App-managed settings and note state | Includes the Tauri store data used by Stiki. |
| `~/Library/Application Support/com.rhinoc.stiki/funasr-models/` | User-provided FunASR model bundle directories or symlinks | Model files are not committed to this repository and are not downloaded by Stiki. |
| User-selected `.md` / `.markdown` files | Linked note content | Stiki writes linked tabs back to these files. |

## Contributing

For development setup, coding conventions, tests, asset rules, and release boundaries, read **[CONTRIBUTING.md](./CONTRIBUTING.md)**.

## Third-Party Assets and Licenses

Original project source code is licensed under the **MIT License**. See **[LICENSE](./LICENSE)**.

That license does not override third-party terms. This repository includes or references frameworks, packages, icons, release tools, and platform integrations with separate licenses or usage terms. See **[CREDITS.md](./CREDITS.md)** for attribution and current redistribution notes.

**Important boundaries:**

- Tauri, Svelte, Tiptap, ProseMirror, and other dependencies remain under their own upstream licenses.
- Bundled icons and DMG background assets require source-by-source redistribution verification before replacement or reuse outside this project.
- Release DMGs, updater archives, signing keys, certificates, passwords, and notarization credentials are not source artifacts and should not be committed.

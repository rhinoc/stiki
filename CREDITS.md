# Credits and Third-Party Notices

Stiki includes and depends on third-party frameworks, packages, and release
tools. Source files and generated lockfiles keep the detailed dependency graph;
this file is the top-level attribution index for public releases.

## Application Framework

- [Tauri](https://tauri.app) for the native desktop shell, bundling, updater,
  tray, window, dialog, shell, store, clipboard, autostart, log, OS, and
  deep-link integrations.
- [Svelte](https://svelte.dev), [SvelteKit](https://svelte.dev/docs/kit), and
  [Vite](https://vite.dev) for the frontend application.
- [Bun](https://bun.sh) for JavaScript dependency installation and local
  command execution.
- [Rust](https://www.rust-lang.org) and [Cargo](https://doc.rust-lang.org/cargo/)
  for the Tauri backend.

## Editor and Markdown

- [Tiptap](https://tiptap.dev) and [ProseMirror](https://prosemirror.net) for
  the rich text editing model and editor extensions.
- [tiptap-markdown](https://github.com/aguingand/tiptap-markdown) for Markdown
  serialization and parsing support.
- [lowlight](https://github.com/wooorm/lowlight) and
  [highlight.js](https://highlightjs.org) for code syntax highlighting.

## UI Utilities

- [canvas-confetti](https://github.com/catdad/canvas-confetti) for power mode
  completion effects.
- [pex-color](https://github.com/pex-gl/pex-color) for color conversion helpers.
- [nanoevents](https://github.com/ai/nanoevents), [debounce](https://github.com/sindresorhus/debounce),
  and [throttleit](https://github.com/sindresorhus/throttleit) for lightweight
  event and timing utilities.

## Native and Release Utilities

- [window-vibrancy](https://github.com/tauri-apps/window-vibrancy) for native
  window material effects.
- [showfile](https://github.com/SmallTide/showfile) for revealing files in the
  operating system file manager.
- [appdmg](https://github.com/LinusU/node-appdmg) for macOS DMG layout
  generation.
- [GitHub Actions](https://github.com/features/actions) for release automation.

## Transcript and Speech

- Apple Speech framework for the default macOS speech-recognition backend.
- Apple AVFoundation and ScreenCaptureKit frameworks for microphone and system
  audio capture on macOS.
- [FunASR](https://github.com/modelscope/FunASR) for the optional local
  SenseVoice inference worker.
- [SenseVoice](https://github.com/FunAudioLLM/SenseVoice) / ModelScope-hosted
  model files for user-provided local transcript models.

SenseVoice model files are not committed to this repository. Users can place
model directories or symbolic links in Stiki's local `sensevoice-models/`
folder; those model files remain subject to their own upstream license and
redistribution terms.

## Project Assets

Bundled app icons, tray icon, and DMG background assets live under
`src-tauri/icons/` and `src-tauri/res/`.

## License Boundaries

Stiki project source code is licensed under the MIT License. See
[LICENSE](./LICENSE).

Third-party dependencies and tools are distributed under their own licenses.
When adding a new bundled asset, binary, font, SDK, or media file, include its
source URL, license terms, redistribution permission, and attribution here.

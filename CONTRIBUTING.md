# Contributing to Stiki

Stiki is a Tauri desktop app with a Svelte frontend and a Rust backend. Keep
changes focused, test the behavior you change, and document user-facing changes
in the same pull request.

## Development Setup

Requirements:

- Bun
- Node.js 22
- Rust stable
- Tauri system prerequisites for your platform
- macOS and Xcode for macOS app, updater, and DMG release builds

Clone and verify the project:

```bash
git clone https://github.com/rhinoc/stiki.git
cd stiki
bun install
bun run check
bun run build
```

Run the desktop app locally:

```bash
bun run tauri dev
```

Create local macOS release artifacts:

```bash
scripts/build_release.sh
```

## Pull Requests

- Keep pull requests scoped to one behavior or one small set of related files.
- Include tests or checks for editor behavior, file synchronization, window
  state, release scripts, updater behavior, and Tauri command changes.
- Run `bun run check` before submitting.
- Update `README.md`, `CREDITS.md`, or this file when behavior,
  dependencies, assets, release artifacts, or user-facing setup changes.

## Code Style

- Prefer existing Svelte component, service, and Tauri command patterns.
- Keep app state changes inside the existing service layer where practical.
- Avoid global state unless it matches an established app-level service.
- Do not log secrets, signing material, full local paths containing usernames,
  or private release configuration.
- Keep UI copy short and concrete.

## Assets and Third-Party Content

Do not add new bundled artwork, fonts, media, SDK files, binaries, or generated
release artifacts unless the pull request includes:

- Original source URL.
- License or usage terms.
- Redistribution permission for inclusion in this repository and packaged app.
- Attribution text for `CREDITS.md`.
- File size and runtime impact.

For uncertain assets, prefer user-supplied files or a documented download step
over bundling the file in the repository.

## Release and Signing

Do not commit release DMGs, `.app` bundles, updater archives, updater
signatures, notarization logs, certificates, private keys, passwords, or local
signing exports.

Release automation lives in:

- `.github/workflows/release.yml`
- `scripts/build_release.sh`
- `scripts/build-dmg.sh`
- `scripts/update_version.sh`
- `scripts/commit_release.sh`
- `src-tauri/tauri.conf.json`

Changes to these files should explain how local builds, GitHub Releases,
updater artifacts, signing, and notarization are affected.

## Security Reports

For signing key exposure, update-feed compromise, credential leaks, or other
sensitive issues, follow [SECURITY.md](./SECURITY.md) instead of opening a
public issue.

# Security Policy

## Reporting a Vulnerability

Do not open a public issue for suspected credential exposure, signing key
exposure, update-feed compromise, or vulnerabilities that could put users at
risk.

Use GitHub's private vulnerability reporting flow for
`https://github.com/rhinoc/stiki` when available. If that flow is unavailable,
contact the maintainer privately through an existing trusted channel.

Include:

- A concise description of the issue.
- Steps to reproduce or verify it.
- Affected versions, commits, or release artifacts.
- Any known leaked material, without reposting secrets in public channels.

## Release Signing Material

Never commit Tauri updater private keys, signing passwords, certificates,
notarization credentials, GitHub tokens, `.env` files, DMGs, `.app` bundles, or
generated updater archives.

If signing material is exposed, rotate it before publishing another release and
rewrite public Git history that contains the exposed value.

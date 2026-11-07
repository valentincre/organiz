# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Use GitHub private vulnerability reporting: open the **Security** tab of the repository and click **Report a vulnerability**. Only the maintainer can see the report.

Describe what you found, how to reproduce it and what it lets an attacker do. You will get an answer as soon as possible. Please give some time to fix the problem before you disclose it.

## Scope

Organiz keeps dashboards encrypted in the browser and relies on Firestore security rules instead of a server. These parts matter most:

- The encryption of dashboards (AES-256-GCM, key derivation).
- The format of the edit and read-only links, and how the secret stays in the link.
- The Firestore rules: access, write proofs, no listing, no deletion.
- The proof of work required to create a dashboard.
- The Content Security Policy and other headers in `firebase.json`.

Out of scope: someone who already holds a link (access cannot be revoked), and lost links (data cannot be recovered). See "Limits" in the README.

## Supported versions

Only the latest release and the official instance are supported. If you self-host, update to the latest release.

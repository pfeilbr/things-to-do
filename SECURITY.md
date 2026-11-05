# Security

## Reporting a problem

Please report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on this repository. Don't open a public issue for anything exploitable.

## What the site is

A static, client-side page on GitHub Pages. It has no backend, no accounts and no cookies, and nothing a visitor types leaves the browser except a place name sent to the OpenStreetMap geocoder. Favorites and settings live in that browser's `localStorage`.

## Controls in place

| Area | Control | Enforced by |
|---|---|---|
| Content Security Policy | `<meta>` CSP: allow-listed hosts only, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, no `unsafe-eval` | `tests/data/security.test.js`, `tests/data/schema.test.js` |
| Third-party scripts | Leaflet/markercluster from unpkg are pinned by Subresource Integrity hashes | `tests/data/schema.test.js` |
| Untrusted text | Live train-feed strings are HTML-escaped (`escHtml`); dataset strings may not carry tags, handlers, `javascript:` or quotes in names; source links must be `http(s)` | `tests/unit/transit.test.js`, `tests/data/security.test.js`, `tests/data/schema.test.js` |
| Links out | Every `target="_blank"` link carries `rel="noopener"`; referrer policy is `strict-origin-when-cross-origin` | `tests/data/security.test.js` |
| Privacy | The distance origin is a place *name*, never a committed coordinate; no personal data in the repo | `CLAUDE.md` review rule |
| CI/CD | Actions pinned by commit SHA (Dependabot bumps them); read-only `GITHUB_TOKEN` and no persisted checkout credentials except in the timetable bot, which must push | `.github/workflows/*`, `.github/dependabot.yml` |

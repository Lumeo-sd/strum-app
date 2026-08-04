<!-- Parent: /CLAUDE.md -->
<!-- Index:  /DOC_INDEX.md -->
<!-- Related: SYSTEM_OVERVIEW.md, RUNTIME_FLOWS.md, DEPENDENCY_MAP.md, DATA_CONTRACTS.md -->
<!-- Read when: navigating the repository or locating a specific piece of code -->

# Repository Map

**Scope:** File-by-file layout of the repo, where-to-find tables, and notable files.
Explicitly does NOT cover: what modules do in detail (`SYSTEM_OVERVIEW.md`), execution traces
(`RUNTIME_FLOWS.md`), or data/API schemas (`DATA_CONTRACTS.md`).

> **Document:** `docs/architecture/REPOSITORY_MAP.md` (Canonical Architecture)
> **Audience:** Anyone navigating the repository for the first time.

## Read this when

- You are looking for a specific piece of code and need to know which file holds it.
- You want to know where data files, diagnostics scripts, or frontend assets live.

## Related documentation

- [`docs/architecture/SYSTEM_OVERVIEW.md`](SYSTEM_OVERVIEW.md) — component-level mental model.
- [`docs/architecture/DEPENDENCY_MAP.md`](DEPENDENCY_MAP.md) — who imports whom.
- [`AGENTS.md`](../../AGENTS.md) — engineering conventions and operational commands.

---

## Repository layout

```
strum-app/
├── index.js                  # Entry point: config, wiring, intervals, shutdown
├── package.json              # "strum", type: module, NO dependencies (runtime)
├── README.md                 # Canonical user/ops documentation (keep updated)
├── CHANGELOG.md              # Canonical changelog, newest at top (v0.7.6)
├── AGENTS.md                 # Engineering conventions (Tuya local, web push, commands)
├── CLAUDE.md                 # THIS navigation index (generated, Step 1)
├── DOC_INDEX.md              # Task → document routing (generated, Step 1)
├── DESIGN_AUDIT.md           # Design-system audit snapshot (historical, 2026-07-29)
├── TOKEN_PROPOSAL.md         # Design proposal: CSS token system (historical)
├── PALETTE_PROPOSAL.md       # Design proposal: palette directions (historical)
├── docs/
│   └── architecture/         # Architecture docs (this set)
│       ├── SYSTEM_OVERVIEW.md
│       ├── REPOSITORY_MAP.md
│       ├── RUNTIME_FLOWS.md
│       ├── DEPENDENCY_MAP.md
│       └── DATA_CONTRACTS.md
├── lib/                      # Server-side modules (Node.js, ESM, stdlib only)
│   ├── app-state.js          #   Core: inverter poll, devices, scenes, cost, island learning
│   ├── atomic-write.js       #   Atomic JSON/file writes (temp + rename)
│   ├── auth.js               #   Sessions, scrypt hashing, CSRF, metrics token
│   ├── config.js             #   config.json load/save + secret encryption + netbird
│   ├── crc16.js              #   Modbus CRC-16 (Solarman frames)
│   ├── crypto.js             #   AES-256-GCM master-key encrypt/decrypt
│   ├── logger.js             #   In-memory ring buffer of log lines
│   ├── notifications.js      #   ntfy + Telegram + in-app notification center
│   ├── rate-limit.js         #   Token-bucket IP/user rate limiting
│   ├── rrd.js                #   Ring-buffer time series (1m/15m/1h)
│   ├── router.js             #   Route table, body parsing, response helpers
│   ├── routes.js             #   All /api/* route handlers
│   ├── server.js             #   TLS bootstrap, HTTP server, auth middleware, static
│   ├── solarman.js           #   Solarman V5 Modbus TCP client
│   ├── tuya-discovery.js     #   Tuya UDP discovery (port 6667)
│   ├── tuya-local.js         #   Tuya local protocol 3.5/6699 (AES-128-GCM, push)
│   ├── tuya-sign.js          #   Tuya Cloud API HMAC-SHA256 signing + calls
│   ├── watchdog.js           #   Heartbeat writer for systemd WatchdogSec
│   └── webpush.js            #   VAPID + RFC 8291 aes128gcm Web Push
├── scripts/                  # Diagnostics and utility scripts (not part of runtime)
│   ├── check-watchdog.sh
│   ├── tuya-diag.js
│   ├── tuya-disc-*.js
│   ├── tuya-fetch-keys.mjs
│   ├── tuya-single.js
│   └── tuya-test-api.mjs
├── public/                   # PWA frontend (served as static files)
│   ├── index.html            #   Main SPA (dark theme, charts, controls) — ~1900 lines
│   ├── login.html            #   Login page
│   ├── manifest.json         #   PWA manifest
│   ├── sw.js                 #   Service worker: push, badge, notificationclick
│   └── lib/                  #   Vendored assets (bootstrap-icons, chart.umd, fonts)
│       ├── bootstrap-icons.min.css
│       ├── chart.umd.min.js
│       ├── jetbrains-mono/  manrope/  fonts/
│       └── *.css
├── data/                     # Runtime state (created on boot; NOT in git)
│   ├── config.json           #   User configuration (encrypted secret fields)
│   ├── secret.key            #   AES-256-GCM master key (mode 0600)
│   ├── auth.json             #   Password hash + mustChangePassword
│   ├── sessions.json         #   Active sessions (token → {exp, csrf, username})
│   ├── users.json            #   User accounts
│   ├── scenes.json           #   Scene definitions
│   ├── devices.json          #   Tuya device registry
│   ├── daily.json            #   Daily energy totals
│   ├── history_1m.json / history_15m.json / history_1h.json  # RRD series
│   ├── sockets_*.json        #   RRD series for individual plugs
│   ├── notifications.json    #   In-app notification center
│   ├── scene-timers.json     #   Scene cooldown/last-run state
│   ├── push-subscriptions.json  # Web Push subscriptions (cap 50)
│   ├── vapid.json            #   VAPID keys
│   ├── cert.pem / key.pem    #   Self-signed TLS cert
│   ├── watchdog.log          #   Heartbeat log
│   └── admin/                #   (misc admin state)
├── .gitignore                # Excludes data/, node_modules, etc.
└── .opencode/                # opencode config (node_modules, plans) — tooling only
```

## Where to find things

| What you need | Look in |
|---|---|
| HTTP API endpoints | `lib/routes.js` (handlers), `lib/router.js` (table), `lib/server.js` (middleware) |
| Scene definitions & engine | `lib/app-state.js` (scene engine section) |
| Tuya device control | `lib/tuya-local.js` (local), `lib/tuya-sign.js` (cloud), `lib/tuya-discovery.js` (discovery) |
| Inverter communication | `lib/solarman.js`, `lib/crc16.js` |
| Inverter DP register mapping | `lib/solarman.js` (register tables) |
| Auth / sessions / CSRF | `lib/auth.js` |
| Password + secret storage | `lib/crypto.js`, `data/secret.key`, `data/auth.json` |
| Notifications | `lib/notifications.js` (ntfy/Telegram/in-app), `lib/webpush.js` (Web Push) |
| History & charts data | `lib/rrd.js` |
| Frontend UI | `public/index.html`, `public/login.html`, `public/sw.js` |
| Service worker + badge | `public/sw.js`, `lib/webpush.js` |
| Config schema & defaults | `lib/config.js` |
| Startup / shutdown / intervals | `index.js` |
| Diagnostics (Tuya) | `scripts/tuya-*.js` |

## Notable details

- **`public/lib/`** holds vendored third-party assets (Chart.js UMD, bootstrap-icons, fonts) — they
  are the only "dependencies" in the repo and are served statically; there is no bundler.
- **`data/` is git-ignored and created at runtime.** Never commit credentials or state. Deployment to
  the Pi is `scp` of the code tree + restart of the `energy-controller` systemd unit.

---
## Known Gaps / Uncertainties

- `.opencode/` (tooling, node_modules) and `.github/workflows/` (one workflow) exist but are not
  documented here; they are outside the runtime surface.
- `data/` file inventory is from a live scan; runtime-created files (e.g. `scenes.json`) appear only
  after first use and are not in git.

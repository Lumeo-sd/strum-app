<!-- Parent: /CLAUDE.md -->
<!-- Index:  /DOC_INDEX.md -->
<!-- Related: SYSTEM_OVERVIEW.md, RUNTIME_FLOWS.md, DEPENDENCY_MAP.md, AGENTS.md -->
<!-- Read when: reading/writing data/ files, consuming or extending API payloads, adding a config/device/scene/notification field -->

# Data Contracts

**Scope:** Persistent file schemas, key API response shapes, auth/CSRF/rate-limit rules, and the
REST surface summary.
Explicitly does NOT cover: execution traces (`RUNTIME_FLOWS.md`) or protocol byte-levels
(`AGENTS.md`).

> **Document:** `docs/architecture/DATA_CONTRACTS.md` (Canonical Architecture)
> **Audience:** Engineers reading/writing `data/` files, API consumers, and anyone adding endpoints.

## Read this when

- You need to know the shape of a persisted file or an API response.
- You are adding a field to config, a device, a scene, or a notification.

## Related documentation

- [`docs/architecture/RUNTIME_FLOWS.md`](RUNTIME_FLOWS.md) — where these structures are produced/consumed.
- [`lib/config.js`](../../lib/config.js), [`lib/app-state.js`](../../lib/app-state.js), [`lib/routes.js`](../../lib/routes.js) — canonical implementations.

---

## Conventions

- All persistent state is **JSON in `data/`**, written via `lib/atomic-write.js` (temp + rename).
- `data/` is **git-ignored** — never commit it.
- File access modes: sensitive files (`config.json`, `secret.key`) are `0600`.
- All `/api/*` JSON responses carry `Cache-Control: no-store` and set a session CSRF token via the
  `GET /api/status` payload (`csrfToken`).

## 1. `data/config.json`

Created with defaults by `lib/config.js` `loadConfig()`. Tuya password is stored **encrypted**
(AES-256-GCM, format `"<iv>.<ciphertext>:<tag>"`) unless it contains `:` (legacy plaintext).

```jsonc
{
  "inverter": {
    "ip": "192.168.1.10",
    "serial": "SN123456",
    "port": 8899,
    "mac": "",
    "autoResolve": false,
    "resolveAfterFails": 10
  },
  "tuya": {
    "accessId": "",
    "accessKey": "",
    "countryCode": 48,
    "username": "",
    "password": "<encrypted>",
    "appSchema": "tuyaSmart"
  },
  "webPort": 8583,
  "notifications": {
    "notifEnabled": true,
    "ntfyEnabled": true,
    "ntfyNotifEnabled": true,
    "ntfyTopic": "",
    "telegramEnabled": true,
    "telegramNotifEnabled": true,
    "telegramToken": "",
    "telegramChatId": "",
    "lowSocAlert": 20,
    "connTimeout": 10,
    "gridOutageReport": true
  },
  "healthAlerts": {
    "enabled": true,
    "diskThreshold": 20,
    "cpuTempThreshold": 80,
    "cpuLoadThreshold": 5,
    "memThreshold": 15,
    "checkInterval": 5
  },
  "netbird": {
    "enabled": false,
    "setupKey": "",
    "managementUrl": "",
    "publicUrl": ""
  },
  "metricsToken": "",
  "tariff": {
    "currency": "UAH",
    "type": "daynight",         // 'daynight' | 'flat'
    "flatRate": 0,
    "dayRate": 0,
    "nightRate": 0,
    "dayStart": "07:00",
    "nightStart": "23:00"
  },
  "batteryCapacityWh": 5120
}
```

## 2. `data/devices.json` — Tuya device registry

Loaded into `app-state.js` as `tuyaDevices` (an array). Cleaned/serialized shape exposed over the API:

```jsonc
{
  "id": "bf...device-id",
  "name": "Water heater",
  "ip": "192.168.1.22",          // local LAN address for protocol 3.5
  "online": true,
  "switch": true,                 // last known DP1 (or derived) state
  "power": 0,                     // W (when device reports power DP)
  "voltage": 0,
  "current": 0,
  "group": "",
  "protocolVersion": "3.5",
  "localKey": "<32-hex>"
}
```

Control mode (`auto` / `local` / `cloud`) is per-`cfg.tuya.controlMode`, applied at control time.

## 3. `data/scenes.json` — scene definitions

Array of scene objects. Managed via `POST/PATCH/DELETE /api/scenes`.

```jsonc
{
  "name": "Survival: shed heater",
  "enabled": true,
  "group": "Survival",
  "mode": "always",             // scene trigger modes (see app-state)
  "icon": "lightning",
  "if": {
    "logic": "AND",             // optional; default 'AND'
    "conditions": [
      { "type": "grid", "value": false },
      { "type": "battery", "operator": ">", "value": 30 },
      { "type": "time", "after": "06:00", "before": "22:00" },
      { "type": "weekday", "value": "weekday", "days": [1,2,3,4,5] },
      { "type": "device_online", "value": "<deviceId>", "expectedStatus": true },
      { "type": "load", "operator": "<", "value": 800 },
      { "type": "inverter", "value": "online" },
      { "type": "grid_restored" },        // one-shot
      { "type": "inverter_offline", "minFailures": 5 },  // one-shot
      { "type": "disk_free", "operator": "<", "value": 20 },
      { "type": "cpu_temp", "operator": ">", "value": 80 },
      { "type": "cpu_load", "operator": ">", "value": 5 },
      { "type": "memory_free", "operator": "<", "value": 15 }
    ]
  },
  "then": {
    "actions": [ /* see below */ ]
  }
}
```

`if` may also use nested `and` / `or` / `not` nodes (see `normalizeConditions`).

### Condition semantics

| `type` | Fields | Result |
|---|---|---|
| `grid` | `value` (bool) | `inverterData.gridPower === value` |
| `battery` | `operator` (`<`/`>`/`=`), `value` | SOC comparison |
| `time` | `after`/`before` `"HH:MM"` | wall-clock window |
| `weekday` | `value` (`weekday`/`weekend`) or `days[]` (0-6) | day-of-week match |
| `device_online` | `value` (device id), `expectedStatus` | plug online state |
| `load` | `operator`, `value` | load power W |
| `inverter` | `value` (`online`/`offline`) | inverter reachable (last update < 60 s) |
| `grid_restored` | — | one-shot; true right after outage end |
| `inverter_offline` | `minFailures` | one-shot; consecutive fails ≥ threshold |
| `disk_free` / `cpu_temp` / `cpu_load` / `memory_free` | `operator`, `value` | health checks |

### Action types (`scene.then.actions[]`)

Simple actions (top-level, tracked by timers with optional `duration` for auto-revert):

```jsonc
{ "type": "tuya", "device": "<deviceId>", "value": true, "duration": 60 }
{ "type": "notify", "title": "...", "message": "...", "critical": false }
{ "type": "webhook", "target": "https://...", "method": "POST" }
{ "type": "priority", "value": "survival" }   // set inverter priority/mode
```

Compound (nested) actions:

```jsonc
{ "type": "delay", "duration": 5 }
{ "type": "if", "condition": { ... }, "then": [...], "else": [...] }
{ "type": "choose", "choices": [ { "condition": {...}, "then": [...] } ], "default": [...] }
{ "type": "repeat", "count": 3, "sequence": [...] }          // or "while": {...}
{ "type": "parallel", "sequence": [...] }
{ "type": "stop" }
```

### Scene runtime state (`data/scene-timers.json`)

```jsonc
{
  "<scene>:<deviceOrType>": {
    "active": true,
    "appliedAt": 1720000000000,
    "revertedAt": 1720000600000
  }
}
```

## 4. Inverter snapshot (`inverterData`, exposed via `/api/status`)

Field set produced by `lib/solarman.js` polling (register map in `lib/solarman.js`):

| Field | Source register | Meaning |
|---|---|---|
| `gridPower` | derived (grid status 1) | grid present |
| `gridVoltage` | `0x0096 × 0.1` | V |
| `gridRaw` | `0x0040` | raw grid status word |
| `batterySOC` | `0x00B8` | % |
| `pvPower` / `pvPower2` | `0x00BA` / `0x00BB` | W |
| `loadPower` | `0x00B2` | W |
| `batteryPower` | `0x00BE` (signed) | W (+ discharge / − charge) |
| `batteryVoltage` | `0x00B7 × 0.01` | V |
| `batteryCurrent` | `0x00BF × 0.01` | A |
| `batteryTemp` | `0x00B6` | °C |
| `dcTransfTemp` | `0x005A` | °C |
| `dayPV` / `dayGridImport` / `dayGridExport` / `dayBatCharge` / `dayBatDischarge` / `dayLoadEnergy` | `0x006C` / `0x004C` / `0x004D` / `0x0046` / `0x0047` / `0x0054` (× 0.1) | kWh today |
| `fault1..4`, `alarm1..2` | `0x0067-0x006A`, `0x0065-0x0066` | fault/alarm words |
| `totalGridImport`, `totalLoadEnergy` | via device key (`dk`) | lifetime kWh |
| `lastUpdate` | — | Date of last successful poll |
| `_isDemo` | — | true when demo data injected |

`/api/status` also adds computed fields: `runtimeMin`, `runtimeMode`, `runtimeIdle`,
`batteryOverheadW`, `batteryCapacityFactor`, `shutdownSOC`, `batteryEndsAt`, `costToday`,
`tariff`, `dailyRecords`, `tuyaDevices`, `scenes`, `csrfToken`.

## 5. RRD series (`data/history_1m.json`, `history_15m.json`, `history_1h.json`, `sockets_*.json`)

Ring-buffer points produced by `lib/rrd.js`:

```jsonc
[
  { "ts": 1720000000000, "grid": 1, "soc": 85, "load": 420, "bat": -120, "pv": 980, "otherLoad": 0 }
]
```

Ring sizes (`lib/rrd.js`): `1m` = 1440 pts (~24 h), `15m` = 672 pts (~7 d), `1h` = 8760 pts (~365 d).
Downsampling happens in `lib/rrd.js`;
per-plug series live in `sockets_*.json` with `{ ts, on, power }`-style points.

## 6. Notifications (`data/notifications.json`, `/api/notifications`)

```jsonc
{
  "id": 17,
  "title": "Grid restored",
  "message": "Outage lasted 42 min",
  "type": "info",            // 'info' | 'error' | 'warning'
  "time": 1720000000000,
  "read": false,
  "dismissed": false
}
```

## 7. Web Push store (`data/push-subscriptions.json`, `data/vapid.json`)

- `vapid.json` — `{ publicKey, privateKey }` (ECDSA P-256, base64).
- `push-subscriptions.json` — array of subscriptions:

```jsonc
{
  "endpoint": "https://fcm.googleapis.com/...",
  "keys": { "p256dh": "...", "auth": "..." },
  "origin": "https://strum.example.netbird.services",
  "createdAt": 1720000000000
}
```

Cap: **50** subscriptions. `origin` is used for push `navigate` fallback.

## 8. Auth state

- `data/auth.json` — `{ "username": "admin", "salt": "<hex>", "hash": "<hex scrypt 64B>", "mustChangePassword": true }`.
- `data/sessions.json` — `{ "<token>": { "exp": 1720000000000, "csrf": "<token>", "username": "admin" } }` (cookie `ecm_session`).
- `data/users.json` — `{ "<username>": { "role": "admin", "createdAt": ..., "salt": ..., "hash": ... } }`.

## 9. Auth / CSRF rules

- Session cookie: `ecm_session`; `HttpOnly; SameSite=Strict; Path=/; Max-Age=…` (+`Secure` when HTTPS).
- CSRF required on `POST`/`PATCH`/`DELETE` under `/api` (token from session, sent via `X-CSRF-Token`
  header or body). **Whitelisted** (no CSRF): `POST /api/push/subscribe`, `POST /api/push/unsubscribe`,
  `GET /api/metrics`, `POST /api/watchdog-alert`.
- Rate limiting: token bucket per IP + per user (see `lib/rate-limit.js`); `X-Forwarded-For` trusted
  only from loopback.
- `/api/metrics` requires `?token=<cfg.metricsToken>` (metrics scrape endpoint).

## 10. Web Push broadcast payload (declarative JSON)

```jsonc
{
  "type": "info",
  "title": "Grid restored",
  "message": "Outage lasted 42 min",
  "unread": 3,
  "app_badge": 3,          // top-level — WebKit reads badge ONLY from top-level
  "notification": {
    "title": "Grid restored",
    "body": "Outage lasted 42 min",
    "app_badge": 3
  }
}
```

Encrypted with **RFC 8291 aes128gcm** (ECDH P-256 + HKDF) per subscription; see `AGENTS.md`.

## 11. Main REST surface (summary)

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /healthz` | none | liveness |
| `POST /api/watchdog-alert` | none (whitelist) | systemd watchdog |
| `GET/POST /login`, `POST /api/logout` | — | session management |
| `POST /api/change-password` | session | password change |
| `GET /api/status` | session | main state snapshot (incl. `csrfToken`) |
| `GET /api/metrics` | `?token=` | Prometheus-style metrics |
| `GET /api/tuya-devices`, `POST /api/tuya-control`, `POST /api/sync-tuya`, `GET/POST /api/tuya-mode`, `PATCH /api/tuya-devices/:id` | session | Tuya device list/control/sync/mode |
| `GET/POST /api/plugin-config`, `POST /api/inverter/scan`, `GET/POST /api/inverter/autoscan` | session | inverter + plugin config |
| `GET/POST /api/notifications…`, `POST /api/test-notification` | session | notification center |
| `GET/POST /api/scenes`, `PATCH/DELETE /api/scenes/:name`, `POST /api/scenes/:name/run`, `GET /api/scene-traces` | session | scene engine |
| `GET /api/device-ping/:ip`, `GET /api/logs` | session | diagnostics |
| `GET /api/history`, `GET /api/socket-history`, `GET /api/grid-heatmap`, `GET /api/week-heatmap` | session | chart data |
| `POST /api/restart`, `GET /api/system-info`, `GET /api/app-version`, `POST /api/update-check`, `POST /api/update-apply`, `POST /api/backup`, `POST /api/backup/restore` | session | ops |
| `GET/POST /api/user-prefs`, `GET/POST/DELETE /api/users` | session | prefs + user admin |
| `GET /api/push/vapid-key`, `POST /api/push/subscribe`, `POST /api/push/unsubscribe` | session (except noted) | web push |
| `GET /` (SPA), `GET /login`, `GET /manifest.json`, `GET /sw.js` | — | frontend assets |

---
## Known Gaps / Uncertainties

- Per-plug series (`sockets_*.json`) point shape is summarized as `{ ts, on, power }`-style; confirm
  exact fields in `lib/rrd.js` before reading them directly.
- Scene `mode` field: `restart` (default) and `single` are confirmed in `lib/app-state.js`; the PWA
  scene editor may expose additional mode strings — verify before adding new ones.
- Inverter register addresses are from code, not vendor docs — see `SYSTEM_OVERVIEW.md` Known Gaps.
- Demo-data injection (`_isDemo`) means a device-less/reachable-less system still produces plausible
  `/api/status` values; treat `lastUpdate` and `_isDemo` as the source of truth for "real".

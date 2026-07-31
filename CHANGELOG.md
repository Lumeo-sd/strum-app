## v0.6.2 — 2026-07-31
### Added
- Scene cards now show a single neutral last-activity line (`HH:MM · status · ✓ executed` / `⚠ error` / `⏹ stopped`) instead of stacked per-action traces — no full action messages on the card (those still go to the ntfy/Telegram notification); the line updates live on poll
- Manual scene run (`/api/scenes/:name/run`) now uses the same recursive action executor as the auto engine (`runSceneNow`): `if`/`choose` evaluate their conditions against live state (only the taken branch runs), `repeat`/`parallel`/`stop` work correctly, nested `stop` halts the whole run, and every simple action reports `ok`/`error` in the results

### Fixed
- SPA boot no longer flashes the login screen while the session is checked — the login overlay starts hidden (`gone`) and only fades in for unauthenticated users; `?changePwd=1` is stripped from the URL after the forced change-password sheet opens, so it doesn't re-trigger on every reload
- Standalone login page (`/login`) ignored `mustChangePassword` from the server and redirected straight to `/`; now it shows "change your default password" and redirects to `/?changePwd=1`, which the app picks up on load to open the forced change-password sheet
- `time` condition: `before` was parsed with seed `1440` fed into `reduce` (multiplied by 60), making `cur <= before` always true — any time window with `before` was satisfied once `cur >= after`. Now `before` parses correctly (e.g. `10:00–11:00` no longer matches at 19:00)
- Scene trace for `notify` actions is now compact — a short `ok` status instead of repeating the full message (the full text still goes to the ntfy/Telegram notification); unresolved template placeholders in the notification (e.g. no outage report recorded yet) are replaced with `—` instead of raw `{{...}}`

## v0.6.1 — 2026-07-31
### Changed
- Full control cycle aligned with HAOS (tuya-local 2026.7.2 + frontend):
  - `setDPs` now awaits the actual send (debounce + retries) and returns the flush promise — `controlDevice`/scenes surface real success/failure
  - On final control failure, failed pending updates are cleared + `log.error` (analog of reference `_reset_cached_state`) — no more silently stuck device state
  - Local retry-in-2s removed (redundant — retries live inside the integration, as in HAOS); local→cloud fallback now actually triggers on real local failure
  - Device state (`switch`/voltage/current/power) now updated instantly from Tuya push frames (`onPush` registered in app-state) — scenes trigger on real state change without waiting for poll
  - Scene nested actions record `apply:error` traces on failure
- Frontend toggle now matches HA `ha-entity-toggle`: optimistic flip via 2s pending overlay, 2s revert timer if state not confirmed, state updated from server poll
- Tuya keepalive aligned with HAOS: heartbeat interval 25s → 5s (as `_HEARTBEAT_INTERVAL=5`), keeping the TCP channel open through NAT

### Fixed
- Tuya local control: `setDP` threw `ReferenceError: setDPs is not defined` (called a non-existent closure function instead of the instance method), silently forcing every local control into cloud fallback. Now delegates to `instance.setDPs`.

## v0.6.0 — 2026-07-24
### Added
- iOS-style Settings redesign: grouped sections with border-radius, colored icon badges, inset dividers, chevron indicators, auto-save toggles, inline inputs
- Settings groups: Inverter, Tuya Cloud, Integrations, Notifications, Tariff, Appearance, System
- Accent color picker redesigned with circular swatches in Appearance section
- Status Tiles, Change Password, Update, Backup sections collapsible inline
- Admin user management section (shown for admin users only)

### Fixed
- SVG energy flow animation on iOS Safari: replaced `innerHTML` with `createElementNS` for proper SVG namespace
- `animateMotion` replaced with `requestAnimationFrame` cubic-bezier dot animation (works on iOS)
- Chart line labels plugin removed (labels drawn directly on lines)

### Changed
- Chart Y-axis ticks: compact `1k`/`-1k` formatting for values ≥1000, smaller font (9px), max 5 ticks
- Chart X-axis: 24h time format (no AM/PM), adaptive `maxTicksLimit` per period
- Mobile tile sizes reduced: padding, min-height, icon/value/label font sizes
- Chart section mobile layout: flex-wrap header, scrollable tabs, smaller tab padding
- Pull-to-refresh removed (data updates in real-time via polling)
- Swipe-to-change-tab gesture removed

## v0.3.13 — 2026-07-23
### Added
- Notification center: sound on new critical/warn notification (Web Audio API)
- Unread count badge (orange pill) in sidebar, separate from total count
- "Mark read" button in notification panel + "Mark all read" API
- Notification grouping by title+type (collapses duplicates with count badge)
- Unread highlight (left accent border, bold title) on notification items
- Side-by-side "Mark read" / "Dismiss all" buttons in notification card

## v0.3.12 — 2026-07-23
### Added
- Server health monitoring: checks disk, CPU temp, CPU load, memory every 5 min
- Configurable thresholds in Settings → Notifications → Server health monitoring
- Push notifications + external alerts (ntfy/Telegram) on threshold breach
- Deduplication with hysteresis: 1 hour cooldown per metric, resets on recovery
- Theme card collapsed behavior fixed (now matches other cards)

## v0.5.0 — 2026-07-23
### Added
- "Quiet Panel" theme — minimal mobile UI without glass cards/blur
- `tokens.css` — shared CSS variables shared between main app and login page
- Hero section with single power number + solar/battery/grid stats
- Mini sparkline chart (7 bars) — tap opens bottom-sheet with full Chart.js
- Device strip — first 4 devices as flat rows with quick toggle
- Theme toggle in Settings: Comfortable (default) / Quiet Panel
- Bottom nav on mobile: 4 icons with dot indicator (no pill/badge background)
- Server and Notifications moved out of bottom nav (bell in topbar, Server in Settings)
- `data-theme="quiet"` attribute toggles CSS overrides + loads copper accent (#c98a4f)
- Login page now respects chosen accent + theme via tokens.css
### Fixed
- `var(--primary)` in Chart.js datasets resolved via getComputedStyle
### Changed
- `loadStatus()` updates hero values in quiet mode
- `loadTuyaDevices()` populates device strip

## v0.3.11 — 2026-07-23
### Added
- Theme/color switcher in Settings tab
- 6 accent color palettes: Purple (default), Blue, Green, Orange, Pink, Cyan
- Color swatches with active indicator
- Preference persisted in localStorage (`ecmAccent`)
- `data-accent` attribute on `<html>` with CSS variable overrides

## v0.3.10 — 2026-07-23
### Added
- Haptic feedback (vibration): device toggle, scene run, toast, pull-to-refresh, swipe
- Swipe gestures: horizontal swipe to switch between tabs on mobile
- Improved pull-to-refresh with haptic threshold indicator
- `haptic()` utility function wrapping `navigator.vibrate`
- CSS `slideInRight`/`slideInLeft` keyframe animations

## v0.3.9 — 2026-07-23
### Added
- Device grouping: assign devices to rooms/categories via group field
- Group headers in devices tab with collapsible sections
- Pencil icon on device cards to edit group assignment
- `PATCH /api/tuya-devices/:id/group` endpoint
- `group` field persisted in `data/devices.json`

# Changelog

## v0.3.7 (2026-07-23)
- Modular refactor: extract 15 modules into `lib/` (server, routes, app-state, auth, config, router, logger, notifications, rrd, solarman, tuya-sign, crypto, crc16, rate-limit)
- Extract frontend HTML/CSS/JS from inline template literals into `public/` static files
- Fix: scenes reference bug — `loadScenes` reassigned array, exported reference stayed empty
- Fix: app.js syntax error — `\\'` → `\'` in onclick handlers (~15 places)
- Fix: `/icon-*.png` 302 redirect → whitelist in authMiddleware, handle before route matcher
- Fix: DELETE scene handler used `filter` instead of `splice`, breaking reference to shared scenes array
- Fix: `loadDailyRecords` / `loadDevicesFromDisk` also reassigned arrays instead of mutating in-place
- Remove leftover `.bak` files from repo
- Update README Files section to reflect modular structure

## v0.3.5 (2026-07-??)
- Auto-resolve inverter IP with ARP/ping sweep
- Persistent notifications with server-side event history
- Scene traces ring buffer (last 200 events)
- Cooldown interval for scene actions

## v0.3.4
- Notifications tab with in-app dismiss
- Transparent SVG node centers with glow effect

## v0.3.3
- Pin sidebar footer to bottom
- Battery animation: dual dots for charge/discharge

## v0.3.2
- Notification channel toggles (ntfy.sh, Telegram, Critical-only)
- Grid Outage Report notification
- Flat tariff support + daily cost tracking

## v0.3.1
- Tariff cost tracking
- Prometheus metrics endpoint
- Notify actions in scenes
- Tile detail charts (per-register debug grid)

## v0.3.0
- Initial tagged release
- RRD-style history with ring buffers
- AND/OR logic + time/weekday conditions for automations
- ntfy.sh / Telegram notifications
- Energy flow SVG + self-consumption metrics
- Branch/tag-based update system
- Tuya Cloud smart plug control
- Solarman V5 Modbus TCP inverter monitoring
- PWA support
- Zero npm dependencies


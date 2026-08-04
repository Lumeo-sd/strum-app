## v0.7.7 — 2026-08-04
### Changed
- **Amber brand rebrand (Direction A, hybrid accent scope)** — the accent defaults to the existing Direction A amber `--amber:#F59A0A` everywhere: app icon (manifest inline PNGs + runtime `pwaIcon()`), `.app-icon`/login `.icon` gradient (`#E8860A → #F59A0A`), primary buttons, focus rings, active tabs, decorative orbs, `.kw`, notifications. The accent-theme picker keeps working (incl. the `blue` option, now via `html[data-accent="blue"]`), default preset is `amber`.
- **Status colours stay blue** — new `--live:#1A8FFF` / `--live-rgb:26,143,255` tokens carry the online/active look (`.dev.on` border/dot/label, `.scene.act` border/sdot) so "device online" never collides with the amber warning/survival styling.
- **Primary-button contrast** — `.btn-primary` and the login button use dark text (`#050505`) on amber (was white-on-blue; white-on-amber fails AA); login spinner recoloured to match.
- Amber literals in `.bgfx`/`.survive` now reference `var(--amber-rgb)`. Data-series chart colours (Load/Sockets/Battery), `--green`/`--red`/`--cyan`/`--indigo` status roles and third-party brand literals are unchanged.

## v0.7.6 — 2026-08-03
### Added
- **Live tail on auto-mode charts** — Power / Sockets / Daily charts in Auto show the real-time value: on every `/api/status` poll (~5 s) the last point is updated in place within the current minute and a new point is appended when a new minute starts (RRD storage stays 1 point/min — nothing extra is persisted). Implemented frontend-only: `liveNow()` aggregates live inverter + Tuya data, `liveTail()`/`liveTailAll()` (wired into `poll()`) update the chart data and the current-values legend, preserving dataset toggle state and the follow-the-edge scroll.
### Changed
- **LiquidGlass removed entirely (Raspberry Pi stability)** — the inlined `@ybouane/liquidglass` v1.0.3 (html-to-image capture + WebGL shader renderer, ~2900 lines) and everything wired to it are gone: the dock lens bubble (`#glassWrap` + `data-config` + `syncMagnify`/`__lgDockFrame`/`scheduleDock`), the LiquidGlass-backed page titles, and the font-embed/canvas-snapshot machinery. The glass look now comes from plain CSS `backdrop-filter`:
  - `.page-title` — always the frosted-glass style that used to be `.lg-fallback` (`blur 20px saturate 1.6`, card bg, border, shadow).
  - `.bar-surface` — always the glass bar (`blur 24px saturate 1.8`), no WebGL canvas behind it.
  - `.glass-wrap` bubble removed — the dock no longer has a lens effect.
- **Dock simplified to plain CSS** — the drag/magnet/pill engine no longer needs the rAF lens spring (`lensX`/`lensScale`/`syncMagnify`/merge state machine). Press → pill snaps to the pressed tab, drag → pill follows the nearest tab with the icon magnet lift, release → navigate (drag) or native click (tap). `ensurePinned`, reposition on load/visibility/resize, the reduced-motion gate and `__dockPositionPill` (used by `moveTabHighlight`) are unchanged.

### Removed
- The `<script type="module">` LiquidGlass block (~2900 lines of inlined lib + the glass-init IIFE) — the dock now ships as a ~3 KB script.
- `data-config` attributes and the `.lg-active`/`.lg-fallback` CSS states.

### Fixed
- The always-on dashboard no longer creates a WebGL context (persistent GPU memory on the Pi).
- **Auto charts no longer drift away from the live edge** — after a chart rebuild the scroll position could land short of the newest data (the canvas resized a beat after `scrollLeft` was set, and on a slow Pi it never recovered). `centerChartOnNow` now re-checks the position for up to ~800 ms after the initial pin, and a new `initChartFollow` tracks user scrolling per chart: manual scroll back stops follow (live updates stop yanking you away and the position survives a reload), scrolling back to the edge resumes it.

## v0.7.5 — 2026-08-03
### Changed
- **The dock bubble is a real magnifier now** — the biconvex branch of the glass shader gets a new `magnify` uniform (`DEFAULTS.magnify`, `u_magnify`): instead of the old constant `centerDir` nudge it contracts the UV toward the lens center by `(1 − 1/magnify)` per depth, so the content under the bubble is enlarged proportionally to the lens scale. The dock engine syncs it live: `syncMagnify` rewrites the bubble's `data-config` (observed by LiquidGlass) with `magnify = max(1, lensScaleX)` on every drag/merge frame. Initial bubble config gains `"magnify":1.15`.
- **Bubble is wider / more oval** — `DROPLET_EXTRA` 20 → 34 (bubble width ≈ 102px vs 64px tab), matching the reference's wider droplet shape.
- **Reverse-lens "absorption ring" (`absorb` mode)** — new `absorb` config toggle (`DEFAULTS.absorb`, `u_absorb`) switches the glass refraction to the inverted model: the bubble's **outer shell** pulls the surrounding scene inward (absorption ring, scaled by `(1 − 1/magnify) × edge`), so a neighbour tab icon is visibly "swallowed" by the rim as it approaches during a drag, while content already inside the bubble renders clean at 1:1 (no center magnification). It only manifests while the lens is stretched (`magnify > 1`, i.e. during motion); at rest the bubble is plain clear glass. Bubble config now sets `"absorb":1`, `"edgeBlur":0.5`.

### Fixed
- **Dock icons (bootstrap-icons `::before` glyphs) were invisible inside the bubble** — LiquidGlass `collectFontUsage` only walked text nodes, so icon `@font-face` blocks were filtered out of the capture's font embed and the icons rendered as nothing (black scene). It now reads `::before`/`::after` computed styles (decoding `content` hex escapes) and registers their family/weight/style + glyph codepoints, so `filterFontBlocksForElement` keeps the icon font for the captured tabs.
- **Mock-server font 404s during capture** — `buildFontBlocks` resolved `url(...)` relative to the page (wrong base for `lib/fonts/…`), and inlined both woff2 and woff sources even though only woff2 exists. Font URLs are now resolved against the owning stylesheet (`resolveUrl` + the `<link href>`), and non-woff2 sources are skipped when a woff2 is present. Mock captures now embed bootstrap-icons + Manrope as data URLs (network shows only the two 200 font loads).

## v0.7.4 — 2026-08-03
### Changed
- **The dock is now "Regular Glass" from the reference site (not the frosted title material)** — verified against `/home/p3/Projects/liquidglass-main/site/index.html`: our inline `@ybouane/liquidglass` v1.0.3 is byte-identical to the reference (same `DEFAULTS` table), the difference was purely config. Following the reference mapping — frosted dark glass for headings (`hero-title`: `blur 0.3, brightness −0.2`), clear refractive glass for the interactive dock (`glass-fp1` Regular Glass: `blurAmount:0`) — the dock now uses `{blurAmount:0, cornerRadius:32, zRadius:32}` for the bar and the reference tab-indicator config for the bubble (`{blurAmount:0, cornerRadius:999, zRadius:24, edgeHighlight:0.2, shadowOpacity:0.25}`). The bar surface's own CSS backing is gone (`background:transparent` — it was `rgba(30,30,32,.55)` behind the WebGL canvas, which is why the bar read darker than the titles), so the bar and titles now render with the same purity. The `#tabbar` root keeps one LiquidGlass instance (`scheduleDock`), `__lgDockFrame` still re-renders the bubble lens live on every drag frame. The `prefers-reduced-motion`/`prefers-reduced-transparency`/init-failure fallback (`.bar-surface.lg-fallback`) is unchanged. Verified in Chrome emulation: dock active on load, titles still frosted glass, drag/tap navigation clean, no console errors.
- **Dock icons and labels are now white like the page titles** (were `--muted` gray) — `.tab{color:var(--text)}` (the same `#f2f2f4` as the `<h1>` titles), the active tab keeps the accent color. Icons gained the reference `hero-tabs` drop-shadow (`drop-shadow(0 1px 2px rgba(0,0,0,.55))`) for legibility on the clear glass, and `.tabs` got the reference's translucent tray strip (`rgba(0,0,0,.18)` dark / `rgba(255,255,255,.26)` light, `border-radius:inherit`). The drag bubble was raised above the tab strip (z-index 4) so it refracts the icon under it like the reference's tab indicator.
- **Dock bubble is now glass, and the animation starts on press** — the droplet appears the instant you press a tab (pointerdown), inflating in place under your finger with a spring stretch, the bar scales to 1.018 and the hovered icon lifts via the magnet (`--magnet` ~1.0); it no longer waits for a drag threshold. Releasing without moving merges the bubble back and the native click navigates; dragging still switches tabs on release (click suppressed). Fixed a bug where the droplet started from the previous active tab's center and flew across the bar on a plain press — it now inflates at the pressed tab. The bubble itself is glass again: translucent white gradient + `backdrop-filter: blur(18px) saturate(180%)` with a sheen highlight and bottom shadow (was the reference's dense material).
- **Dock rebuilt on the reference Liquid Glass physics** — the dock is now a dense material bubble, not a WebGL glass lens: `.glass-wrap` is a solid liquid look (radial/linear gradients, border, shadows, `::before` highlight, `::after` bottom shadow), `backdrop-filter` is off and the injected `canvas` is hidden. New dock engine (IIFE in `index.html`): idle → dragging → settling → merging state machine, spring lens (`translate3d(x) scale3d(sx,sy)`) with stiffness/damping per state, magnet effect on hovered tabs (`--magnet` → icon lift + scale, tab translateY), bar press scale `1.018`, drag-switch with 8px threshold, pill hidden during drag and re-shown mid-merge (~32ms reveal, ~125ms complete), navigation via `window.go` after release plus a click fallback (350ms suppression after drag). `prefers-reduced-motion` keeps plain clicks. Tested in Chrome emulation: drag status→settings / status→notifications settle/merge cleanly, pill and lens land exactly on the target tab, no console errors.
- **Dock restyled to the reference (iOS-like) design**: `#tabbar` is now a 400px × 64px floating rounded bar (`width:min(92vw,400px)`, radius 32px) with a translucent glass surface and 5 equal full-height tabs (icon 18px above an always-visible 11px label) and a moving glass pill that follows the selection, driven by the existing drag/pill/liquid-glass logic (lens corner radius 32px)
- **Dock floats like the iOS tab bar**: `#tabbarWrap` sits `calc(env(safe-area-inset-bottom, 0px) / 2 + 6px)` from the screen bottom — the midpoint between the flush (`bottom:0`) and over-floating (`sab + 12px`) versions. On iOS 26 PWA the webview reports a larger bottom safe-area inset, so the previous `sab + 12px` rendered visibly higher there; halving the safe-area term pulls the bar down to roughly the iOS reference gap. The bar is a fully rounded capsule (`border-radius:32px`, fixed `64px` height)

### Fixed
- **The glass "Dash" page title was plain until you switched tabs** — the LiquidGlass init for `.page-title` only ran inside `window.go` (i.e. on tab switches), so on first launch the `h1` never got its `data-config` and rendered as a plain heading. The scheduler now also starts it at app entry: a `MutationObserver` on `#app`'s `hidden` attribute fires the moment the app becomes visible (plus `load`/`pageshow`/`fonts.ready`/`visibilitychange` retries), with guards so the instance is created once and not churned by repeated events
- **Dock floated high above the screen bottom in the PWA** — `#tabbarWrap` was centered with `left:50%;transform:translateX(-50%)` and had an entrance animation animating `transform` on the `position:fixed` element (spring overshoot curve). On iOS/standalone PWA a transform animation on a fixed element can leave it stranded at a wrong translate, floating in the middle with a big gap below. The wrapper is now centered transform-free (`inset-inline:0` + `margin-inline:auto`), the entrance animation is opacity-only and lives on the inner `#tabbar`, and the stale `translateX(-50%)!important` override in the `prefers-reduced-motion` block is removed
- **Dock still floated in the standalone PWA** — the CSS bottom rule `max(20px, calc(var(--sab) + 8px))` could fail to parse on WebKit (nested `env()` through a CSS var in `max()`), dropping to `bottom:auto` and parking the fixed element at its static position mid-screen. Now it's `bottom:0`, plus a JS guard (`ensurePinned`) that force-pins the bar to the bottom whenever it drifts (gap > 80px or negative) on load/resize/orientation
- **The selection "bubble" was not in place at first launch** (only after switching tabs) — the pill/lens position was computed while `#app` was still hidden (zero rects). Repositioning now runs redundantly on `load`, `pageshow`, `fonts.ready`, `visibilitychange` (returning to the app), timed retries, and a `MutationObserver` on `#app`'s `hidden` attribute that repositions the pill and re-pins the dock the moment the app becomes visible
- **Tab icons were not vertically centered (labels were)** — a leftover `@media(max-width:560px) .tab{height:40px;padding:0 11px}` from the old compact pill design capped the tab at 40px inside the 64px bar and top-aligned it, shifting the whole icon+label group ~12px up. Removed; tabs now fill the full bar height and the group is centered symmetrically (icon −8px / label +10px)

## v0.7.3 — 2026-08-02
### Removed
- **Liquid-glass "Dash" pill removed entirely** — the feature never rendered convincingly on the small pill (opaque backing "pad", then pixelation, then washed-out/faded glass). The pill element, CSS, scroll logic, WebGL init/destroy hooks and the vendored `public/lib/liquidglass.js` are gone; the Status page is back to the plain scrolling "Dash" heading as before the feature.

### Fixed
- **Settings icon badges: the `sic-*` token classes were never defined in CSS** — the design-system migration (commit `41b2624`) changed every row to `class="sic sic-green"` etc. but forgot the `.sic-*` rules, so all migrated badges rendered as a white icon on a transparent box (only the 5 brand-color rows kept their color via inline `style="background:#…"`). The missing classes are now defined (mapped to the existing color tokens).
- **All settings icons migrated to the new token format** — the 5 remaining rows that still used inline `style="background:#FF5A5F"/#229ED9"` (Tuya Access ID/Key, Telegram/Bot Token/Chat ID) now use dedicated `sic-tuya`/`sic-telegram` classes with the same brand hex values; no `style="background:#…"` remains in the settings page.

## v0.7.2 — 2026-08-02
### Security
- **Login rate-limit no longer trusts a client-supplied `X-Forwarded-For` header** — the IP is now resolved through `getClientIp()` (same logic as the rest of the API): the header is honored only when the direct peer is loopback (i.e. a local reverse proxy). Previously any caller could spoof the header to bypass the 5-attempts-per-minute lockout (and could lock out another IP by impersonating it).
- **Stale login-attempt counters are now pruned** (once per minute) — the in-memory map no longer grows unbounded from port scans / many distinct source IPs.
- **`/api/metrics` token comparison is now constant-time** (`crypto.timingSafeEqual`) — closes a theoretical timing side-channel on the bearer token check.
- **Security headers on every response**: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: SAMEORIGIN` (clickjacking), `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`.
- **Hardened the `/lib/` static-file path check** — the prefix test now uses a path-separator boundary, so sibling directories whose names merely start with `lib` (e.g. `public/lib2/…`) can no longer be served under `/lib/`.

### Fixed
- **Scene condition `memory_free` always evaluated as 100%** — the health-cache update referenced an out-of-scope `total` variable (ReferenceError was swallowed by the empty `catch`), so the memory check never updated. Now uses the parsed `MemTotal`.
- Metrics help text typo: `energy_controller_shutdown_soc_percent` said "(W)", now "(%)".

## v0.7.1 — 2026-08-01
### Changed
- **Chart headers no longer wrap on mobile**: the "Unregistered Load" title is shortened to "Unregistered", and the header title (`h3`) is now flexible (`flex:1; min-width:0`) with no flex-wrap — the Auto/Day/Week buttons always stay on the same row as the title; if space is very tight the title wraps instead of pushing the buttons down
- **Auto-scroll now pins the newest data to the right edge** (not the center) on every load, including the 60s auto-refresh — the live edge is immediately visible with no manual scrolling. The redundant scroll padding past the last point is removed (only ~10 min of lookahead remains), so scrolling to the end no longer lands on an empty canvas
- **Grid Availability heatmap: day labels are now fixed** — the Mon…Sun column sits outside the scrollable area (like the static y-axis on the line charts) and stays put while the grid scrolls. The heatmap keeps auto-centering the current time slot in the **middle** of the viewport on every load (unlike the line charts, which pin the newest data to the right edge)
- **Legend merged into the power line (no more duplicates)**: the separate clickable legend under each chart is removed; the live "Home: … W / Batt: … W" line is now the legend — every entry carries the series name, its current power and is clickable (click hides/shows the series, dimmed when off). Unregistered Load gained a "Total load" entry, Home Energy's Grid/SOC readouts stay non-clickable
- `GET /api/history` now returns a `socket` field per point — the sum of registered smart-socket power (all devices), aligned to the same minute as the power point (nearest match within 2 min, else `null`)

### Changed
- **Web Push is now fully encrypted (RFC 8291 aes128gcm) and sends standard **declarative** messages**, making it work on **iOS 18.4+/26 — without an Apple Developer account** (Apple dropped that requirement in iOS 18.4):
  - Pure-Node AES-128-GCM payload encryption: ECDH P-256 shared secret + HKDF (auth secret, `WebPush: info` context, `aes128gcm`/`nonce` infos), record `salt(16)+rs(4096)+keyid(65)+ciphertext` — verified byte-for-byte against RFC 8291 §5 example and cross-checked against the reference `http_ece` library used by all browsers
  - Payload is the declarative standard JSON `{"web_push":8030,"notification":{title,body,navigate,app_badge}}` — on iOS the badge updates and a notification shows even if the service worker is gone (ITP-proof); the SW still uses the same data on other platforms
  - Subscriptions now also store the app `origin` (sent by the frontend at subscribe time) so `navigate` points back to the app
  - **New "Public URL" setting** in the Netbird VPN settings card: the public HTTPS address of the app (e.g. `https://strum.eu1.netbird.services`). It is used as the preferred push `navigate` origin (falling back to the per-subscription origin), so after changing NetBird account/domain you just update this field and notification taps land on the new address
  - **Fix Apple VAPID rejection (`{"reason":"BadJwtToken"}`)**: Apple rejects the default JWT `sub` claim `mailto:strum@localhost` (invalid `localhost` domain). The VAPID subject is now derived from `cfg.netbird.publicUrl` (`mailto:strum@<host>`), falling back to `cfg.webpush.subject` override. Verified live: `web.push.apple.com` returns **201** (accepted) — iOS PWA now receives pushes
  - **Fix `POST /api/test-notification`**: it referenced `_sendExtNotification`, which was never passed into `registerRoutes` — returned 500. Now wired through `ctx`
  - On iOS every push shows a banner (WebKit enforces `userVisibleOnly`) — the badge is always in sync, but info-level events also produce a banner
  - **Fix stale home-screen badge on iOS**: WebKit's declarative parser reads `app_badge` from the **top level** of the push JSON (not from inside `notification` — the blog example is misleading), so our badge updates were silently ignored whenever the service worker didn't set them. `app_badge` is now emitted at the top level (duplicated inside `notification` for older builds); the service worker also now always syncs the badge — even when a window is open (it used to return early and skip `setAppBadge`)
- **Estimated Runtime now uses real inverter data instead of hardcoded assumptions**:
  - **Usable capacity respects the battery shutdown SOC** read live from the inverter (register `0x00D9` = 15% here), so runtime = `(SOC − shutdownSOC) × capacity / drain` — previously the whole 0–100% was treated as usable and runtime was overestimated
  - **When the battery is actually discharging, the real measured drain is used** (`batteryPower`, register `0x00BE`) — it already includes inverter conversion losses and inverter self-consumption
  - **Inverter self-consumption: conservative 45 W stub until real data exists**. The load-projection path starts at `load/0.965 + 45` and is **not** inflated by the on-grid idle measurement (≈11 W here) — that grid-derived value was tried and dropped because it made the estimate too optimistic and it isn't the "battery + load" overhead the projection needs. It is still sampled and exposed as `debug.inverterIdle` / metric, but only for diagnostics
  - **Clock-skew fix**: the server used to send an absolute `batteryEndsAt` epoch timestamp and the client subtracted its own `Date.now()` — a browser/device with a wrong clock showed a completely different remaining time. The server now sends `runtimeMin` (a duration); the client anchors its countdown to its own clock deltas, so the number is skew-proof (the "until HH:MM" label still uses the local clock)
  - **Fix outage-banner Runtime** showing "0 min" (it referenced an undefined `rt` instead of the computed runtime)
  - **PV is NOT subtracted from the projected runtime** (apartment = UPS, no meaningful solar): the projected drain stays `load/0.965 + idle`. A PV "bonus" in the estimate was tried and dropped — a daytime outage estimate that subtracts PV is misleading when the inverter is in UPS mode
  - **Island overhead is auto-learned and stored on disk**: during a real grid outage (grid off, battery **discharging** — `batteryPower > 5` on this inverter, where positive = discharge, negative = charge), with no PV, the total DC-side overhead (conversion losses + self-consumption) is sampled as `batteryPower − load` (register `0x00BE`), smoothed (EWMA) and persisted to `config.json` as `batteryOverheadW`. Once available it replaces the 45 W stub and the projection becomes `drain = load + overhead` (no `/0.965` — the overhead already includes the conversion loss, applying both would double-count)
  - **Usable-capacity is auto-learned and stored on disk** (`batteryCapacityFactor`, universal self-correction): every real island is a free measurement — the app integrates the battery's delivered energy (`Σ batteryPower·dt`) over the SOC span actually used, computes `effectiveCapacity = deliveredWh / ΔSOC·100`, and persists `capacityFactor = effectiveCapacity / batteryCapacityWh` (EWMA across islands, clamped to 0.5…1.3). The runtime formula then uses `usableWh = (SOC − shutdownSOC)/100 × capacityWh × capacityFactor`. This corrects in one shot all the systematic errors from empirical validation (SOC-linearity, sag under load, cold/current effects, real shutdown cutoff). Default 1.0 = no change until the first real island
  - **Changing the battery capacity in Settings resets the learned factor**: `capacityFactor` is relative to the configured capacity, so saving a new `batteryCapacityWh` clears it (the overhead `batteryOverheadW` stays — it belongs to the inverter, not the battery) and the first outage with the new battery re-learns from scratch
  - **Runtime is exposed in `/api/metrics`** (`energy_controller_runtime_minutes`, `energy_controller_runtime_mode`, `energy_controller_inverter_idle_watts`, `energy_controller_battery_overhead_watts`, `energy_controller_battery_capacity_factor`, `energy_controller_shutdown_soc_percent`) — the calculation now lives in one shared `computeRuntime()` used by both `/api/status` and the metrics endpoint
- Weekly "Grid Availability" heatmap now auto-centers the scroll on the current time slot when the Status page is opened and on returning to the tab, so the "now" column is always in view
- The "Last 7 Days" card on the status page is now an **Unregistered Load** chart: amber line = load not coming from the smart sockets (`load − socket sum`), teal dashed line = registered socket sum, blue dashed line = total load, over the last 24 h. Grid-off intervals are highlighted with a red band and the header shows live "Unreg: … W" / "Sockets: … W" readings; the chart keeps the 60s auto-refresh
- All line charts (Home Energy, Smart Plugs, Unregistered Load) now show a clickable legend — clicking a label hides/shows that line. The old auto-drawn line labels at the left edge of each chart (`lineLabels` plugin pills: Home/Batt/Unreg/…) are removed since the legend now names every series
- **Home Energy** period switcher slimmed down to **Auto / Day / Week** (the 1h/3h/6h/12h buttons are gone). **Auto** renders the current day at 1-minute resolution as a wide horizontally-scrollable chart (like the Grid Availability heatmap) that auto-centers on the current time when opened, on returning to the tab, and when re-selected — so the near-term detail is always in view. Day/Week stay as full-card overview charts
- **All day charts** (Home Energy Auto, Smart Plugs, Unregistered Load) now render the full current day at 1-minute resolution as a wide horizontally-scrollable plot with a static HTML legend (click to hide/show series) and a static left W-axis: only the chart body scrolls, the axis and legend stay visible. Shared helpers (`centerChartOnNow`, `setScrollWidth`, `buildHtmlLegend`, `buildHtmlYAxis`) drive all three; Home Energy's Day/Week modes remain non-scrolling full-card overviews
- **Smart Plugs** and **Unregistered Load** now have the same **Auto / Day / Week** period switcher as Home Energy: Auto = scrollable detailed current day, Day/Week = full-card overview charts

## v0.7.0 — 2026-08-01
### Added
- **Web Push** (badge + background notifications for the installed PWA), implemented with zero npm dependencies:
  - Service worker `sw.js` with a `push` handler: when the app is closed it fetches the live unread count from the server, syncs the icon badge and shows a background notification for non-info messages; when a tab is open it just pokes the page to re-poll
  - Pure-Node VAPID: ECDSA P-256 keypair auto-generated into `data/vapid.json`, ES256 JWT (`Authorization: vapid t=…,k=…`) with the `aud` derived from the push service origin
  - Minimal "tickle" scheme: empty-payload pushes (no RFC 8291 payload encryption) — the service worker pulls fresh content itself, so the badge/text is always current
  - Subscription store `data/push-subscriptions.json` (capped at 50); subscriptions auto-removed on 404/410; `pushsubscriptionchange` re-subscribes via the server
  - New API: `GET /api/push/vapid-key`, `POST /api/push/subscribe`, `POST /api/push/unsubscribe` (session-authenticated; the two POSTs are CSRF-exempt because the service worker has no CSRF token)
  - Broadcast triggered on every new notification (2s coalescing debounce), fire-and-forget so in-app delivery never blocks
- **Requirement:** the app must be served from a valid public HTTPS origin (e.g. a NetBird port-forward URL) — the browser refuses to register a service worker / subscribe push on the self-signed LAN IP. Without it the feature silently no-ops (badge/visibility logic still works in-app).


### Changed
- Notification chat groups like a messenger: consecutive messages from the same source now share a single avatar + sender name regardless of the time gap (day separators still reset the group). Each message keeps its own bubble with the time underneath it, but the time is skipped when it repeats the previous message's minute (no duplicate timestamps for same-minute bursts)
- Long-press a message bubble opens a context menu with **Copy message** (full text to clipboard, with an `execCommand` fallback), **Delete message** (with a preview) and **Cancel** — the individual dismissal available before is back, but now discoverable like in messengers instead of an always-visible × button
- Text selection disabled app-wide (PWA feel): `user-select:none` on the body + `-webkit-touch-callout:none` so long-press only triggers our context menu instead of the browser's native selection/loupe. Form fields (`input`/`textarea`/`select`/`[contenteditable]`) keep `user-select:text`
- Home-screen icon badge when installed as a PWA: the unread count is pushed to the app icon via the Badging API (`navigator.setAppBadge`/`clearAppBadge`, capped at 99) whenever the tab badge updates — like a real messenger. On iOS/iPadOS the badge requires the notification permission, so opening the Events tab with unread messages now requests it (`Notification.requestPermission`); elsewhere it falls back to a silent no-op (Android, Linux). Android Chromium ignores `setAppBadge` entirely — the only Android badge is the dot Android draws for an active push notification
- Returning to the app (visibilitychange → visible) now re-polls notifications immediately, so the icon badge refreshes right away instead of waiting for the next 15s poll

## v0.6.5 — 2026-08-01
### Added
- "Grid Availability" heatmap reworked from a yearly grid into a **weekly view**: current week (Mon–Sun) as 7 rows × 48 columns (30-minute cells covering 24h), hour labels (00/02/04/…/22) on top. Cells are stretched to ~yearly-grid width (48 × 14px cells). Cell value = grid-on fraction of the 30-min slot (`0` red / `0.5` partial green / `1` full green, gray = no data).
- `GET /api/week-heatmap` returns `{start, days: [{d, slots[48]}]}` for the current week, aggregated from the 15m RRD level (exactly 7 days of retention = full week at 30-min resolution).

### Removed
- Yearly heatmap (52-week daily grid, month labels) and the Year/Week switch — the weekly view is now the only mode.

## v0.6.4 — 2026-07-31
### Added
- New "Grid Availability" card on the status page (below "Last 7 Days"): a single GitHub-style heatmap of daily grid availability, columns = weeks, 7 rows = days of the week, with a period switch (**3M / 6M / 1Y**) and month labels on top:
  - Cells colored by grid hours per day (`l0–l3`); red = full outage day, gray = no data; hover/click shows the exact date + hours (e.g. `Mon, 4 Aug 2025 · 12 h of grid`)
  - Stats chips: total grid hours, outage days, best day, days tracked
- `GET /api/grid-heatmap?weeks=4..78` returns per-day `{d, hours, covered}` aggregated from the stored 15m/1h RRD levels (today from 1m/15m, older days from 1h)

### Changed
- "Grid Availability" heatmap simplified to the minimal daily grid: weeks × days (days of the week on the left, months on top) + legend only. Removed the period switch (3M/6M/1Y), the stats chips and the hover readout line; the grid always renders the last 52 weeks from `GET /api/grid-heatmap?weeks=52`

## v0.6.4 — 2026-07-31
### Changed
- Notification center (Events tab) redesigned as a real messenger chat: round avatar with the source icon on the left (Inverter → cpu, Automation → rocket-takeoff, Tuya/device → plug, Grid → lightning, System → gear…), sender name above the bubble, message text in the bubble, and time below it. Consecutive messages from the same source that arrived in the same minute are stacked into one bubble column (single avatar, time under the last one); as soon as the time differs they split into separate groups so each timestamp stays visible. Day separators (Today/Yesterday/date) and per-type coloring (info/warn/error) retained
- Opening the Events tab positions the chat like a messenger: if there are unread messages it lands at the read/unread boundary (the first unread peeks at the bottom edge, older read history fills the screen — unread require scrolling); if everything is read it opens at the newest message. Opening the tab marks messages as read (badge clears) without moving the scroll
- Message-management actions removed: no per-message delete, no Read All / Clear All — the chat is a pure scrollable history; individual dismissal is still available server-side (`/api/notifications/dismiss`)
- Chat auto-scrolls to the newest message when already at the bottom and preserves scroll position when browsing history

## v0.6.3 — 2026-07-31
### Changed
- `notify` action is now strictly in-app: it delivers to the notification center (Events tab) only and no longer auto-sends to ntfy/Telegram. External channels are decoupled — send them explicitly with the `Webhook / Push` action
- `Webhook / Push` action gained a target selector: `URL` (custom HTTP POST, as before), `ntfy`, or `Telegram`. The ntfy/Telegram targets reuse the credentials from Settings → Notifications, accept a title + message (message placeholders like `{{...}}` are expanded), and report the outcome on the scene trace (`ntfy ok` / `telegram error`) so failures are visible on the scene card
- "Test Notification" still verifies the configured ntfy/Telegram channels (result list unchanged) and additionally posts the test to the notification center

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


# AGENTS.md

## Проєкт
Strum — автономний енергоконтролер для Raspberry Pi (Node.js 22, ES modules, без npm-залежностей).
Слідкує за сонячним інвертором (Solarman V5 Modbus TCP), керує Tuya-розетками локально/через хмару,
автоматизації (сцени), push-сповіщення (ntfy/Telegram), PWA-фронтенд.

## Web Push (бейдж + фонові сповіщення)
- `lib/webpush.js` — нульові npm-залежності: VAPID (ECDSA P-256, ключі в `data/vapid.json`, ES256 JWT з
  `aud` = origin push-сервісу), сховище підписок `data/push-subscriptions.json` (кап 50; зберігається
  `origin` для `navigate`), повне **RFC 8291 aes128gcm-шифрування** (ECDH P-256 + HKDF; звірено з
  RFC 8291 §5 та `http_ece`), розсилка **declarative Web Push** JSON (`web_push:8030`; **`app_badge` на
  top-level**, дублюється в `notification` — WebKit-парсер читає його лише з top-level, тож інакше бейдж
  ігнорується). Debounce 2s.
- `navigate` у push: пріоритетно береться `cfg.netbird.publicUrl` (поле «Public URL» у налаштуваннях
  Netbird VPN), фолбек — `origin`, збережений при підписці. Зміна NetBird-домену = оновити поле в
  налаштуваннях.
- **VAPID subject (`sub` у JWT):** дефолт `mailto:strum@localhost` **відкидається Apple**
  (`BadJwtToken`, 403). Робочий ланцюжок: `cfg.webpush.subject` (якщо заданий) →
  інакше `mailto:strum@<host>` з `cfg.netbird.publicUrl`. Apple перевіряє `sub` як mailto:/URL.
- **iOS 18.4+/26 працює БЕЗ Apple Developer account** (вимогу прибрано в iOS 18.4). Apple приймає
  лише зашифрований payload; declarative fallback показує сповіщення + оновлює бейдж навіть без SW
  (стійко до ITP-видалення SW). Кожен push на iOS показує банер (userVisibleOnly).
- `public/sw.js` — `push` (відкритий додаток: `postMessage` → `pollNotifs`; закритий: parse
  `event.data` declarative JSON → `setAppBadge` + сповіщення для non-info; якщо даних нема —
  fetch unread), `notificationclick`, `pushsubscriptionchange`.
- API: `GET /api/push/vapid-key`, `POST /api/push/subscribe` (фронтенд шле `origin`),
  `POST /api/push/unsubscribe` (потребують сесії; два POST — CSRF-виняток у `server.js`, бо у SW нема токена).
- Тригер: `createNotifications(DATA_DIR, loadConfig, onNotify)` → `webpush.broadcast({ title, message,
  type, unread })` на кожне `pushNotification` (fire-and-forget, ніколи не блокує).
- **Критично:** SW/push реєструється лише з валідного публічного HTTPS-origin (NetBird port-forward
  URL, `.netbird.services`). На самопідписаному LAN-IP — тихий no-op.

## Команди
- Синтаксис: `node --check lib/*.js`
- Тести: `npm test` (`node --test tests/*.test.js`, Node ≥20). Тести чистої протокольної логіки: tuya-local (кадри 3.5/6699, pending), crc16, solarman (V5 framing).
- Лінт: відсутній

## Tuya Local (критично важливо)
- `lib/tuya-local.js` — локальне керування Tuya-пристроями (протокол 3.5/6699, порт TCP 6668).
- **Єдине джерело правди — цей розділ + код. НЕ перечитуй весь код для перевірки.**
- **Правило: при будь-якій зміні `lib/tuya-local.js` ОНОВИ цей розділ** (поведінку, рядки, md5)
  і додай запис у «Історія змін» нижче. Після деплою на Pi перевір md5: `md5sum lib/tuya-local.js`.
- Деплой: scp на `hb-service@raspberrypi.local:/opt/energy-controller/`, служба `energy-controller`
  (`sudo systemctl restart energy-controller`).

### Протокол 3.5/6699 (звірено з tinytuya 1.20.0, див. «Референси»)
- Кадр: `header(18B) + iv(12) + AES-128-GCM(ciphertext) + tag(16) + suffix(4B = 00 00 99 66)`.
- Header `>IHIII`: `prefix(00 00 66 99) | 0 | seqno | cmd | length`, length = `plaintext + 12 + 16`.
- AAD = `header[4:18]`; IV — випадковий 12B; tag 16B.
- Команди: `SESS_START=0x03`, `SESS_RESP=0x04`, `SESS_FINISH=0x05`, `CONTROL=0x07`,
  `HEART_BEAT=0x09`, `CONTROL_NEW=0x0D`, `DP_QUERY_NEW=0x10`.
- Handshake (session key): 1) клієнт шле 16B nonce (cmd 0x03); 2) пристрій →
  `deviceNonce(16) + hmac_sha256(localKey, clientNonce)(32)` (cmd 0x04), перевіряємо HMAC;
  3) шлемо `hmac_sha256(localKey, deviceNonce)` (cmd 0x05); 4) sessionKey =
  `AES-GCM(localKey, iv=clientNonce[:12])` шифрує `clientNonce ⊕ deviceNonce` → беремо 16B ciphertext.
- retcode — перші 4B розшифрованого payload. Для 3.5 seqno у відповіді **не валідується**
  (пристрій має глобальний лічильник, не ехо запиту).
- Версійний префікс `"3.5"+12×0x00`: додається **лише** для CONTROL/CONTROL_NEW; НЕ додається
  для DP_QUERY_NEW, HEART_BEAT, SESS_* (аналог `NO_PROTOCOL_HEADER_CMDS` у референсі).
- CONTROL_NEW payload: `{"protocol":5,"t":<unix>, "data":{"dps":{...}}}` (без пробілів).
  DP_QUERY_NEW payload: `{}`.
- Відхилення від референсу (свідомі): CONTROL — fire-and-forget (не чекаємо відповіді);
  без вкладеного `{"data":{"dps":...}}`; без ротації версій 3.5→3.4→3.3 (наші пристрої — 3.5).
- Режими керування (`cfg.tuya.controlMode` = auto/local/cloud, app-state.js `controlDevice`):
  **свідоме розширення понад HAOS** — HAOS має лише локальне керування (3 спроби, фінальний фейл →
  reset стану + error, без fallback; хмара тільки для налаштування). У нас auto = local-first
  (той самий цикл 3 спроби) + cloud-фолбек, коли пристрої недосяжні локально. Рішення користувача:
  залишити як є.

### Наша реалізація (lib/tuya-local.js, 658 рядків, md5 e9984340ee4d7cae8e3cd09395825fde)
- Ключові функції: `buildFrame` 32, `parseFrame` 49, `recvExact` 71, `recvFrame` 121,
  `handshake` 129, `parseDpsFromPayload` 157, `overlayPending` 167 (export), `confirmPending` 175 (export),
  `getLocalDevice` 188, `recordFailure` 212, `pendingOverlay` 242, `cacheSnapshot` 246,
  `confirmPendingLocal` 250, `closeSock` 251, `installPush` 268, `onPushData` 280,
  `doConnect` 307, `ensureConnected` 370, `startHeartbeat` 378, `settleFlush` 390,
  `schedulePendingFlush` 403, `sendPending` 428, `sendControl` 453, `sendCommand` 487,
  `enqueue` 507, `executeQuery` 513, `keeperLoop` 532, `queryAll` 567, `setDPs` 598, `setDP` 614.
- Константи: `TIMEOUT_MS=5000`, `CACHE_TTL_MS=30000`, `HEARTBEAT_INTERVAL_MS=5000` (як `_HEARTBEAT_INTERVAL=5` у HAOS),
  `CONNECT_RETRIES=3`, `QUERY_RETRIES=2`, `FAKE_IT_TIMEOUT_MS=5000`, `DEBOUNCE_MS=1000`,
  `FAILURE_ESCALATION_COUNT=10`, `BENIGN_RETCODES={900,904}`, backoff 1s→10s, keeper idle 5s.
- Життєвий цикл: `getLocalDevice` → keeperLoop (ensureConnected → query при протуханні кешу 30s;
  помилка → closeSock + backoff).
- Запити: `queryAll` = кеш (TTL) / живий запит (2 спроби, retcode!=0 окрім benign → помилка) /
  stale-кеш як fallback. `executeQuery` через `sendCommand` (CMD 0x10, чекає відповідь).
- Керування (аналог `async_set_properties` → `_debounce_sending_updates` → `_send_pending_updates`
  у референсі, включно з **await send**): `setDPs` пише в `pendingUpdates` (fake-it: значення видно
  одразу через `pendingOverlay`), дебаунс 1s → `sendPending` батчем усі unsent dp одним CONTROL_NEW;
  зміна значення скидає `sent=false`. **`setDPs`/`setDP` повертають проміс флашу** — await означає
  чекати фактичної відправки (resolves при успіху, throws при фінальній невдачі). Декілька `setDPs`
  у межах дебаунсу ділять один спільний флаш-проміс.
  `sendControl`: `CONNECT_RETRIES=3` спроб (між ними closeSock + пауза 1s); якщо мульті-DP кадр
  завалився на всіх спробах → fallback по одному dp (`maxSimultaneousDps=1`, warn, назавжди для пристрою).
- **Фінальна невдача флашу** (аналог `_reset_cached_state` у референсі): `sendPending` зчищає невідправлені
  pending-записи → throw; `schedulePendingFlush` логує `log.error` і реджектить флаш-проміс (тож
  `controlDevice`/сцени дізнаються про реальний фейл і повідомляють користувача).
- Підтвердження: push-кадр/відповідь запиту з тим самим dp=value знімає pending (`confirmPending`).
  Незпідтверджені вилітають за `FAKE_IT_TIMEOUT_MS=5s` (reference behavior).
- Фейли: `recordFailure` — warn на першому, error на 10-му (`FAILURE_ESCALATION_COUNT`), далі debug;
  скидання при успіху. retcode 900/904 (`BENIGN_RETCODES`) — пристрій живий, даних нема, кеш оновлюється.
- Push-безпека: `parseFrame` повертає `retcode:null` для пустого plaintext (<4B, напр. heartbeat-відповідь)
  замість RangeError. `onPushData` обгортає `parseFrame` у try/catch: помилка → warn + `closeSock('push_parse_error')`
  + скидання `pushBuf` (ніколи не крашить процес).
- `disconnect`/`destroy`: `settleFlush` реджектить незавершений флаш (ті, хто авеїтять, не зависають).

### Історія бага (не повторювати)
Crash-loop був через `sock.removeAllListeners()` у `closeSock`/`finish`, що знімав error-handler →
пізня повторна `error`-подія → `UNCAUGHT EXCEPTION`. Зараз: `finish()` знімає лише свої listener'и
+ постійний `swallowError` + `s.destroy()` при помилці.

### Історія змін lib/tuya-local.js (останні зверху)
| Дата | md5 | Зміна |
|---|---|---|
| 2026-08-04 | `e9984340ee4d7cae8e3cd09395825fde` | TDD-крок 4: `overlayPending`/`confirmPending` винесено в чисті module-level функції (експортовані, беруть `pendingUpdates`/`now` аргументами), внутрішні замикання делегують в них; додано експорт `buildFrame`/`parseFrame`/`parseDpsFromPayload`. Поведінка не змінена (20 тестів). |
| 2026-07-31 | `82172e33adfe33d9a10586aa0d5af13d` | Фікс: `setDP` кидав `ReferenceError: setDPs is not defined` (викликав неіснуючу замикальну функцію замість методу інстансу) → весь локальний контроль мовчки падав у cloud-фолбек. Тепер `setDP` делегує в `instance.setDPs`. |
| 2026-07-31 | `32026b4094905fe9b6c0e65f57f538a7` | Heartbeat вирівняно з HAOS: `HEARTBEAT_INTERVAL_MS` 25000→5000 (як `_HEARTBEAT_INTERVAL=5`, тримає TCP-канал відкритим через NAT, поки подієвий прийом push активний). |
| 2026-07-31 | `78453b43c78bd364a53be44b1a113c48` | Повний цикл як у HAOS: `setDPs` тепер **авеїтить send** (повертає флаш-проміс, `schedulePendingFlush` резолвить/реджектить), при фінальній невдачі `sendPending` зчищає pending + `log.error` (аналог `_reset_cached_state`), `settleFlush` при `disconnect`/`destroy` реджектить незавершений флаш. |
| 2026-07-31 | `7f7850868da15bab5e0921d388b78763` | P0 вирівнювання з tuya-local-2026.7.2: pending+батчинг+дебаунс для `setDPs` (fake-it через `pendingOverlay`), `sendPending`/`sendControl` з retry/fallback per-DP (`maxSimultaneousDps`), `confirmPending` (push/query знімає pending), `recordFailure` (warn→debug→error на 10-му), retcode 900/904 як benign, stale-кеш fallback. |
| 2026-07-31 | `7eb91f5b4483a5c12eb28ec193b6630c` | Push-безпека: `parseFrame` толерантний до пустого payload (heartbeat, retcode=null); `onPushData` ловить помилки розбору → closeSock замість крашу. |
| 2026-07-31 | `393b3a542f2110bd884c2b08d72f7bae` | Фікс crash-loop (описано вище). Деплой на Pi, 0 UNCAUGHT після. |

## Референси
- Референсні копії: `~/Documents/Strum-app/HAOS/` (core-2026.8.0b1, frontend-20260729.1,
  tuya-local-2026.7.2, solarman). Вони для звірки — туди нічого не писати.
- tinytuya 1.20.0 (використовується tuya-local): `/tmp/tinytuya-src` (клон). Звірку робив з
  `core/header.py`, `core/message_helper.py`, `core/command_types.py`, `core/XenonDevice.py`.

## Стиль
- Не додавати коментарі в код, якщо не попросили.
- Документацію (README/CHANGELOG) оновлювати при зміні поведінки.

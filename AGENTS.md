# AGENTS.md

## Проєкт
Strum — автономний енергоконтролер для Raspberry Pi (Node.js 22, ES modules, без npm-залежностей).
Слідкує за сонячним інвертором (Solarman V5 Modbus TCP), керує Tuya-розетками локально/через хмару,
автоматизації (сцени), push-сповіщення (ntfy/Telegram), PWA-фронтенд.

## Команди
- Синтаксис: `node --check lib/*.js`
- Тести: тестовий фреймворк відсутній — перевірка запуском сервісу та журналом (`journalctl -u energy-controller`)
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

### Наша реалізація (lib/tuya-local.js, 617 рядків, md5 7f7850868da15bab5e0921d388b78763)
- Ключові функції: `buildFrame` 32, `parseFrame` 49, `recvExact` 71, `recvFrame` 121,
  `handshake` 129, `parseDpsFromPayload` 157, `getLocalDevice` 169, `recordFailure` 209,
  `confirmPending` 233, `closeSock` 248, `installPush` 265, `onPushData` 277, `doConnect` 304,
  `ensureConnected` 367, `startHeartbeat` 375, `schedulePendingFlush` 387, `sendPending` 400,
  `sendControl` 420, `sendCommand` 454, `enqueue` 474, `executeQuery` 480, `keeperLoop` 499,
  `queryAll` 534, `setDPs` 565, `setDP` 582.
- Константи: `TIMEOUT_MS=5000`, `CACHE_TTL_MS=30000`, `HEARTBEAT_INTERVAL_MS=25000`,
  `CONNECT_RETRIES=3`, `QUERY_RETRIES=2`, `FAKE_IT_TIMEOUT_MS=5000`, `DEBOUNCE_MS=1000`,
  `FAILURE_ESCALATION_COUNT=10`, `BENIGN_RETCODES={900,904}`, backoff 1s→10s, keeper idle 5s.
- Життєвий цикл: `getLocalDevice` → keeperLoop (ensureConnected → query при протуханні кешу 30s;
  помилка → closeSock + backoff).
- Запити: `queryAll` = кеш (TTL) / живий запит (2 спроби, retcode!=0 окрім benign → помилка) /
  stale-кеш як fallback. `executeQuery` через `sendCommand` (CMD 0x10, чекає відповідь).
- Керування (аналог `set_property`/`set_multiple_values` у референсі, але fire-and-forget):
  `setDPs` пише в `pendingUpdates` (fake-it: значення видно одразу через `pendingOverlay`),
  дебаунс 1s → `sendPending` батчем усі unsent dp одним CONTROL_NEW; зміна значення скидає `sent=false`.
  `sendControl`: `CONNECT_RETRIES=3` спроб (між ними closeSock + пауза 1s); якщо мульті-DP кадр
  завалився на всіх спробах → fallback по одному dp (`maxSimultaneousDps=1`, warn, назавжди для пристрою).
- Підтвердження: push-кадр/відповідь запиту з тим самим dp=value знімає pending (`confirmPending`).
  Незпідтверджені вилітають за `FAKE_IT_TIMEOUT_MS=5s` (reference behavior).
- Фейли: `recordFailure` — warn на першому, error на 10-му (`FAILURE_ESCALATION_COUNT`), далі debug;
  скидання при успіху. retcode 900/904 (`BENIGN_RETCODES`) — пристрій живий, даних нема, кеш оновлюється.
- Push-безпека: `parseFrame` повертає `retcode:null` для пустого plaintext (<4B, напр. heartbeat-відповідь)
  замість RangeError. `onPushData` обгортає `parseFrame` у try/catch: помилка → warn + `closeSock('push_parse_error')`
  + скидання `pushBuf` (ніколи не крашить процес).

### Історія бага (не повторювати)
Crash-loop був через `sock.removeAllListeners()` у `closeSock`/`finish`, що знімав error-handler →
пізня повторна `error`-подія → `UNCAUGHT EXCEPTION`. Зараз: `finish()` знімає лише свої listener'и
+ постійний `swallowError` + `s.destroy()` при помилці.

### Історія змін lib/tuya-local.js (останні зверху)
| Дата | md5 | Зміна |
|---|---|---|
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

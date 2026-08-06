# ORDERS.md

Робочий список задач проєкту Strum. Формат: статyс | пріоритет | дата | джерело | задача | пояснення.
Останні зверху. Задачі, що потребують рішення власника, позначені **[власник]**.

## Черговий список (QUEUE)

| Статyс | Пріоритет | Дата | Джерело | Задача | Пояснення |
|---|---|---|---|---|---|
| TODO | MEDIUM | 2026-08-04 | security-review | Fail-open у `lib/crypto.js`: `encryptSecret`/`decryptSecret` при помилці повертають plaintext | **[власник]** Свідомий компроміс на користь доступності. Змінювати лише після обговорення: fail-closed → при втраті `data/secret.key` треба вручну переввести Tuya-кредити. |
| TODO | MEDIUM | 2026-08-04 | security-review | Username enumeration в `/login` через timing (немає scrypt для невідомого юзера) | **[власник]** Лікування: завжди dummy-scrypt. Низький практичний ризик (LAN + rate limit 5/хв). |
| TODO | MEDIUM | 2026-08-04 | GitHub security | Увімкнути Dependabot alerts | Репо public → фіча безкоштовна. Після ввімкнення: `gh api /repos/Lumeo-sd/strum-app/dependabot/alerts`. |
| TODO | MEDIUM | 2026-08-04 | GitHub security | Додати Code Scanning (CodeQL або osv-scanner) у `.github/workflows/ci.yml` | Наявний CI робить лише `node -c`. Рекомендовано: `github/codeql-action/init` (javascript) або `google/osv-scanner-action`. |
| TODO | LOW | 2026-08-04 | GitHub security | Увімкнути `secret_scanning_non_provider_patterns` та `secret_scanning_validity_checks` | Покращують покриття сканування секретів. |
| INFO | — | 2026-08-04 | Step 4 (TDD) | `saveSceneTimers()` пишеться раніше ніж застосується fire-and-forget exec-promise | Durability-ризик: stale timers при краші у вікні. Самовиправляється наступним checkScenes. |
| INFO | — | 2026-08-04 | GitHub security | Secret scanning: відкритих алертів 0, push protection увімкнена | Дія не потрібна. |

## Виконано (DONE) — довідка, не чіпати

| Дата | Пріоритет | Задача | Результат |
|---|---|---|---|
| 2026-08-04 | DONE | Stale `sessions` reference після `clearSessions()` | Виправлено: мутація об'єкта на місці. |
| 2026-08-04 | DONE | `POST /api/change-password` без rate limiting; оракул пароля | Виправлено: rate limit 5/хв/IP (спільний бакет з `/login`). |

## Історія безпеки (Security History) — не повторювати

- **RCE через shell-injection у `netbirdExec`** — закрито (команди не конкатенують user-input).
- **Authz-ескалація через fallback `getCurrentUser`** — закрито (немає fallback до admin).
- **Login rate-limit обходився через spoofing `X-Forwarded-For`** — закрито: IP береться через
  `getClientIp()` (header чесний лише від loopback-проксі).
- **Timing side-channel у `/api/metrics`** — закрито: `crypto.timingSafeEqual`.
- **Security headers** — всі відповіді: `X-Content-Type-Options`, `Referrer-Policy`,
  `X-Frame-Options`, `COOP`, `CORP`.
- **Path-check `/lib/`** — boundary по `path.sep` (не префікс-збіг).

## Тести

`npm test` (`node --test tests/*.test.js`, Node ≥20). На поточний момент: **123 тести**:
tuya-local 20, crc16 8, solarman 10, scene-engine 32, auth 26, appliance-detect 9,
over-consumption 7, notifications 6, inverter-resolve 5.

## Деплой

- Ціль: `hb-service@raspberrypi.local:/opt/energy-controller/`, служба `energy-controller`.
- Після зміни `lib/tuya-local.js`: `md5sum lib/tuya-local.js` → оновити AGENTS.md, рестарт служби.
- Тести на Pi обмежені (таймаут) — запускати `npm test` локально в канонічному клоні.

## Архіви / супутні

- Старі локальні орфани (не канонічні): `Strum-Qwen-UI-archived-orphan-20260806`,
  `Strum-backend-archived-orphan-20260806` у `~/Documents/Strum-app/`.
- Канонічний клон: `~/Documents/Strum-app/strum/`.
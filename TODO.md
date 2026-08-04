# TODO / Deferred items

Відкладені задачі з плану модернізації. Не виконувати без окремого рішення власника.
Останні зверху. Джерело кроку: github-security-review / security-review.

| Дата | Пріоритет | Джерело | Задача | Пояснення |
|---|---|---|---|---|
| 2026-08-04 | MEDIUM | Step 3 (security-review) | Fail-open у `lib/crypto.js`: `encryptSecret`/`decryptSecret` при помилці повертають plaintext замість throw | Свідомий компроміс на користь доступності (пошкоджений master key → сервіс працює, але Tuya password використовується як plaintext). Змінювати лише після обговорення: fail-closed → при втраті `data/secret.key` треба вручну переввести Tuya-кредити. |
| 2026-08-04 | MEDIUM | Step 3 (security-review) | `POST /api/change-password` не має rate limiting; `currentPassword` — оракул пароля адміна | Viewer-сесія може брутфорсити поточний пароль адміна без блокувань (безліміт). При успіху — зміна пароля адміна (DoS). Лікування: rate limit (як `/login`) + затримка. |
| 2026-08-04 | MEDIUM | Step 3 (security-review) | Username enumeration в `/login` через timing: scrypt не виконується для невідомого username | Відповідь для неіснуючого користувача приходить швидше (немає scrypt). Лікування: завжди виконувати dummy-scrypt. Низький практичний ризик (LAN + rate limit 5/хв). |
| 2026-08-04 | MEDIUM | Step 2 (GitHub security) | Увімкнути Dependabot alerts (Repo → Settings → Security → Code security and analysis → Dependabot alerts → Enable) | Алерти Dependabot **вимкнені** для репо (API → 403 `Dependabot alerts are disabled`). Репо public → фіча безкоштовна. Після ввімкнення: `gh api /repos/Lumeo-sd/strum-app/dependabot/alerts` для першого сканування. |
| 2026-08-04 | MEDIUM | Step 2 (GitHub security) | Додати Code Scanning (CodeQL або `osv-scanner`) у `.github/workflows/ci.yml` | Code Scanning: 404 `no analysis found` — аналіз ніколи не запускався; наявний CI робить лише `node -c` (синтаксис). Рекомендовано: `github/codeql-action/init` (javascript) + `analyze`, або легкий `google/osv-scanner-action` (zero-dep, підходить стилю репо). |
| 2026-08-04 | LOW | Step 2 (GitHub security) | Увімкнути `secret_scanning_non_provider_patterns` та `secret_scanning_validity_checks` | Вимкнені (`status: disabled`). Покращують покриття сканування секретів. |
| 2026-08-04 | INFO | Step 2 (GitHub security) | Відкритих алертів Secret Scanning немає; push protection увімкнена | `secret_scanning.status = enabled`, `secret_scanning_push_protection.status = enabled`, відкритих алертів: 0. Дія не потрібна. |

## Резерв для майбутніх кроків

- **Step 4 (TDD)** — тести на `lib/tuya-local.js`, `lib/solarman.js`, `lib/app-state.js` (scene engine), `lib/auth.js` (черга поза списком кроків плану).
- **Step 2 залишок** — якщо Dependabot/Code Scanning увімкнуть і з'являться алерти — зібрати їх у цей файл (без виправлень).

# AGENTS.md — viberuler

Файл — для агентов в рабочей копии владельца. Внешним контрибьюторам — `CONTRIBUTING.md`.

Общий контракт лаборатории — `C:\telo\AGENTS.md`: его HARD RULES действуют и в этом репо
(Codex читает AGENTS.md от корня своего git-репо и корневой файл отсюда может не увидеть).
Самое критичное, сжато:

- **LLM — только через гейтвей лаборатории** (адрес и пулы — в `C:\telo\AGENTS.md`):
  pool-алиасы; никаких сырых имён моделей, провайдерских SDK и ключей.
- **Git — поимённо:** `git add <файл>`, не `-A` / `.`; перед коммитом `git status` (коммит берёт
  весь индекс); `reset --hard` / `push --force` / `checkout --` — только по просьбе владельца.
- **Секреты** — не в argv, URL, на экране и в логах; живут в env-файлах.
- **Процессы снимать только по PID**, никогда по имени.
- **Честные exit-коды:** FAIL — значит ненулевой код; статус пайпом не красть.
- **Файлы — UTF-8 без BOM** (голый `>` в Windows PowerShell пишет UTF-16LE).
- **Таймауты на всей сети.**

## Этот репо

- Репо публичный: никаких личных данных и внутренних путей.
- npm-workspaces: `packages/cli` (пакет `viberuler`) и `packages/worker` (`viberuler-api`).
- Тесты: `npm test` (оба пакета); типы: `npm run typecheck`; сборка: `npm run build`.
  CI гоняет на ubuntu / macos / windows.
- Доки: `README.md`, `METHODOLOGY.md`, `PRIVACY.md`, `CONTRIBUTING.md`, `docs/`.

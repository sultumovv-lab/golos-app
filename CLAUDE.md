# Rezon — Telegram Mini App (репозиторий golos-app)

Перед работой прочитай `docs/STATUS.md` (текущее состояние + что дальше), затем при необходимости `docs/PLAN.md`, `docs/ROLEPLAY-DESIGN.md`, `docs/STRATEGY.md`.

Кратко:
- Фронт — один файл `index.html` (vanilla JS, без сборщика). API — Vercel-функции в `api/` (chat, plan, roleplay, state, voice).
- Деплой: `git push` в `main` → Vercel (фронт/API) и Railway (бот `bot.py`) пересобираются сами.
- Пуш в GitHub: нужен свежий PAT (`repo`) от владельца каждый раз.
- Локальный предпросмотр не выполняет `/api/*` — AI/бэкенд проверять curl'ом на проде или в Telegram.
- Иконки: гибрид — инлайн-SVG (`ic()` / `ICONS`) для навигации и контролов, эмодзи для персонажей/категорий/празднований.
- Текст интерфейса — по-русски. Тон тёплый, бренд «Тёплая студия».

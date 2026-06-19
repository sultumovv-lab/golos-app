"""
Бот листа ожидания «Голос на миллион» — @kaifgolos_bot

Функции:
  1. /start  — приветствие + запись пользователя в лист ожидания
  2. Админ-рассылка — когда владелец пишет боту любое сообщение
     (текст, фото, видео, кружочек, голосовое, опрос и т.д.),
     бот предлагает разослать его всем подписчикам.
  3. /test   — секретная команда: открывает мини-приложение (кнопка Web App)
     ТОЛЬКО для владельца. У остальных кнопка-меню с приложением скрыта.

Все секреты берутся из переменных окружения (Railway → Variables):
  BOT_TOKEN   — токен бота от @BotFather
  ADMIN_ID    — твой Telegram ID (число). Узнать: напиши @userinfobot
  WEBAPP_URL  — адрес мини-аппа (по умолчанию https://golos-app.vercel.app)
  DB_PATH     — путь к базе подписчиков (по умолчанию subscribers.db;
                на Railway лучше /data/subscribers.db с подключённым Volume)
"""

import asyncio
import logging
import os
import sqlite3

from telegram import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    MenuButtonDefault,
    MenuButtonWebApp,
    Update,
    WebAppInfo,
)
from telegram.constants import ChatType
from telegram.error import Forbidden, BadRequest
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

# --------------------------------------------------------------------------- #
#  Настройки
# --------------------------------------------------------------------------- #
BOT_TOKEN = os.environ["BOT_TOKEN"]
ADMIN_ID = int(os.environ["ADMIN_ID"])
WEBAPP_URL = os.environ.get("WEBAPP_URL", "https://golos-app.vercel.app")
DB_PATH = os.environ.get("DB_PATH", "subscribers.db")

WELCOME_TEXT = (
    "Привет! 👋\n\n"
    "Это лист ожидания «Голос на миллион» — приложения для голоса, речи и уверенности.\n\n"
    "Здесь я буду:\n"
    "🎤 Делиться бесплатными упражнениями\n"
    "💡 Давать рекомендации по голосу и речи\n"
    "🎬 Показывать как создаю приложение изнутри\n\n"
    "Приложение скоро откроется для всех — а ты узнаешь об этом первым "
    "и получишь специальные условия.\n\n"
    "Следи за сообщениями здесь 👇"
)

logging.basicConfig(
    format="%(asctime)s — %(name)s — %(levelname)s — %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger("golos-bot")


# --------------------------------------------------------------------------- #
#  База подписчиков (SQLite)
# --------------------------------------------------------------------------- #
def db_init() -> None:
    # Создаём папку для базы, если её ещё нет (например, /data)
    folder = os.path.dirname(DB_PATH)
    if folder:
        os.makedirs(folder, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS subscribers (
                user_id    INTEGER PRIMARY KEY,
                username   TEXT,
                first_name TEXT,
                joined_at  TEXT DEFAULT (datetime('now'))
            )
            """
        )


def db_add(user_id: int, username: str | None, first_name: str | None) -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT OR IGNORE INTO subscribers (user_id, username, first_name) "
            "VALUES (?, ?, ?)",
            (user_id, username, first_name),
        )


def db_remove(user_id: int) -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("DELETE FROM subscribers WHERE user_id = ?", (user_id,))


def db_all_ids() -> list[int]:
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute("SELECT user_id FROM subscribers").fetchall()
    return [r[0] for r in rows]


def db_count() -> int:
    with sqlite3.connect(DB_PATH) as conn:
        return conn.execute("SELECT COUNT(*) FROM subscribers").fetchone()[0]


# --------------------------------------------------------------------------- #
#  /start — приветствие + запись в лист ожидания
# --------------------------------------------------------------------------- #
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    db_add(user.id, user.username, user.first_name)
    await update.effective_message.reply_text(WELCOME_TEXT)


# --------------------------------------------------------------------------- #
#  /test — кнопка мини-аппа только для владельца
# --------------------------------------------------------------------------- #
async def test(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_user.id != ADMIN_ID:
        return  # для всех остальных команда «не существует»

    keyboard = InlineKeyboardMarkup(
        [[InlineKeyboardButton("🚀 Открыть приложение", web_app=WebAppInfo(url=WEBAPP_URL))]]
    )
    await update.effective_message.reply_text(
        "Тестовый доступ к приложению 👇", reply_markup=keyboard
    )
    # Включаем кнопку-меню с Web App лично для владельца
    await context.bot.set_chat_menu_button(
        chat_id=ADMIN_ID,
        menu_button=MenuButtonWebApp(text="Приложение", web_app=WebAppInfo(url=WEBAPP_URL)),
    )


# --------------------------------------------------------------------------- #
#  /stats — сколько людей в листе ожидания (только владелец)
# --------------------------------------------------------------------------- #
async def stats(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_user.id != ADMIN_ID:
        return
    await update.effective_message.reply_text(
        f"👥 В листе ожидания: {db_count()} чел."
    )


# --------------------------------------------------------------------------- #
#  Админ-рассылка
# --------------------------------------------------------------------------- #
async def admin_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Любое сообщение от владельца → предложить рассылку с подтверждением."""
    msg = update.effective_message

    # Запоминаем сообщение, которое будем рассылать
    context.bot_data["pending_chat_id"] = msg.chat_id
    context.bot_data["pending_message_id"] = msg.message_id
    context.bot_data["pending_poll"] = msg.poll  # объект опроса или None

    count = db_count()
    keyboard = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton(f"📢 Разослать ({count})", callback_data="bcast_yes"),
                InlineKeyboardButton("✖️ Отмена", callback_data="bcast_no"),
            ]
        ]
    )
    await msg.reply_text(
        "Разослать это сообщение всем подписчикам листа ожидания?",
        reply_markup=keyboard,
    )


async def broadcast_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()

    if query.from_user.id != ADMIN_ID:
        return

    if query.data == "bcast_no":
        await query.edit_message_text("Рассылка отменена.")
        return

    chat_id = context.bot_data.get("pending_chat_id")
    message_id = context.bot_data.get("pending_message_id")
    poll = context.bot_data.get("pending_poll")
    if not message_id:
        await query.edit_message_text("Нечего рассылать 🤷")
        return

    await query.edit_message_text("Рассылаю… ⏳")

    sent, failed = 0, 0
    for uid in db_all_ids():
        try:
            if poll is not None:
                # Опросы нельзя копировать — создаём заново
                await context.bot.send_poll(
                    chat_id=uid,
                    question=poll.question,
                    options=[o.text for o in poll.options],
                    is_anonymous=poll.is_anonymous,
                    type=poll.type,
                    allows_multiple_answers=poll.allows_multiple_answers,
                    correct_option_id=poll.correct_option_id,
                )
            else:
                # copy_message сохраняет любой тип: текст, фото, видео,
                # кружочек, голосовое, документ, стикер — без пометки «переслано»
                await context.bot.copy_message(
                    chat_id=uid, from_chat_id=chat_id, message_id=message_id
                )
            sent += 1
        except Forbidden:
            # пользователь заблокировал бота — убираем из базы
            db_remove(uid)
            failed += 1
        except BadRequest as e:
            logger.warning("Не доставлено %s: %s", uid, e)
            failed += 1
        except Exception as e:  # noqa: BLE001
            logger.warning("Ошибка для %s: %s", uid, e)
            failed += 1
        await asyncio.sleep(0.05)  # ~20 сообщений/сек — лимит Telegram

    await context.bot.send_message(
        ADMIN_ID, f"✅ Рассылка завершена.\nДоставлено: {sent}\nНе доставлено: {failed}"
    )


# --------------------------------------------------------------------------- #
#  Запуск
# --------------------------------------------------------------------------- #
async def on_startup(app: Application) -> None:
    """Скрываем кнопку-меню с приложением у всех (по умолчанию)."""
    await app.bot.set_chat_menu_button(menu_button=MenuButtonDefault())
    logger.info("Бот запущен. Подписчиков в базе: %s", db_count())


def main() -> None:
    db_init()

    app = Application.builder().token(BOT_TOKEN).post_init(on_startup).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("test", test))
    app.add_handler(CommandHandler("stats", stats))
    app.add_handler(CallbackQueryHandler(broadcast_callback, pattern=r"^bcast_"))

    # Любое НЕ-командное сообщение в личке от владельца → рассылка
    app.add_handler(
        MessageHandler(
            filters.User(ADMIN_ID)
            & filters.ChatType.PRIVATE
            & ~filters.COMMAND,
            admin_message,
        )
    )

    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()

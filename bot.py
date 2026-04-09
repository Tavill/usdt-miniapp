"""
Telegram Bot — точка входа в USDT → EUR Mini App
Использует библиотеку python-telegram-bot (v20+)
"""

import os
import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import Application, CommandHandler, ContextTypes

# ============================================================
# Логирование
# ============================================================
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

# ============================================================
# Конфигурация
# ============================================================
BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN')
MINI_APP_URL = os.environ.get('MINI_APP_URL', 'https://your-project.vercel.app')

if not BOT_TOKEN:
    raise ValueError('Необходимо задать переменную окружения TELEGRAM_BOT_TOKEN')

# ============================================================
# Вспомогательная функция: кнопка открытия Mini App
# ============================================================
def get_webapp_keyboard() -> InlineKeyboardMarkup:
    button = InlineKeyboardButton(
        text='📱 Открыть калькулятор',
        web_app=WebAppInfo(url=MINI_APP_URL),
    )
    return InlineKeyboardMarkup([[button]])

# ============================================================
# Команды
# ============================================================
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработчик команды /start"""
    await update.message.reply_text(
        text=(
            '👋 Привет! Я помогу рассчитать сумму USDT для выставления счёта в евро.\n\n'
            '💱 Цепочка: *USDT → KZT → EUR*\n\n'
            'Нажми кнопку ниже, чтобы открыть калькулятор. '
            'Курсы подтягиваются автоматически с P2P бирж и банка.'
        ),
        parse_mode='Markdown',
        reply_markup=get_webapp_keyboard(),
    )


async def calc(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработчик команды /calc"""
    await update.message.reply_text(
        text='Открой калькулятор 👇',
        reply_markup=get_webapp_keyboard(),
    )


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработчик команды /help"""
    await update.message.reply_text(
        text=(
            '📖 *Как пользоваться калькулятором:*\n\n'
            '1. Нажми «Открыть калькулятор»\n'
            '2. Дождись загрузки актуальных курсов\n'
            '3. Введи нужную сумму в EUR\n'
            '4. Выбери процент буфера (по умолчанию +3%)\n'
            '5. Получи итоговую сумму USDT для счёта\n\n'
            '💡 Буфер защищает от колебаний курса в момент обмена.\n\n'
            '🔄 Курсы обновляются каждые 10 минут.\n'
            'Нажми «Обновить» в приложении для принудительного обновления.'
        ),
        parse_mode='Markdown',
        reply_markup=get_webapp_keyboard(),
    )

# ============================================================
# Запуск бота
# ============================================================
def main() -> None:
    app = Application.builder().token(BOT_TOKEN).build()

    app.add_handler(CommandHandler('start', start))
    app.add_handler(CommandHandler('calc', calc))
    app.add_handler(CommandHandler('help', help_command))

    logger.info('Бот запущен. Ожидаю команды...')
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == '__main__':
    main()

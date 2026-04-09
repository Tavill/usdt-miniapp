# USDT → EUR Калькулятор | Telegram Mini App

Мини-приложение внутри Telegram для быстрого расчёта суммы USDT, которую нужно выставить в счёт, чтобы получить нужную сумму в евро через цепочку **USDT → KZT → EUR**.

Курсы подтягиваются автоматически с P2P бирж (Bybit, OKX) и Freedom Bank.

---

## Структура проекта

```
project/
├── index.html          — Mini App (калькулятор, интерфейс)
├── style.css           — Стили (светлая/тёмная тема, мобильная адаптация)
├── app.js              — Логика калькулятора и запросы к API
│
├── api/
│   └── rates.js        — Vercel Serverless Function (курсы P2P и банка)
│
├── bot/
│   └── bot.py          — Telegram-бот (точка входа в Mini App)
│
├── vercel.json         — Конфигурация деплоя Vercel
├── package.json        — Node.js зависимости
├── requirements.txt    — Python зависимости
├── .env.example        — Пример переменных окружения
└── README.md           — Эта инструкция
```

---

## Деплой: шаг за шагом

### Шаг 1 — Создать бота в Telegram

1. Открыть [@BotFather](https://t.me/BotFather) в Telegram
2. Написать `/newbot` → придумать имя и username (например `@usdt_calc_bot`)
3. Скопировать токен — понадобится на шаге 3

### Шаг 2 — Загрузить код на GitHub

1. Зарегистрироваться на [github.com](https://github.com)
2. Создать новый репозиторий: **New repository** → назвать `usdt-miniapp` → Public
3. Загрузить все файлы проекта через «uploading an existing file»

### Шаг 3 — Задеплоить на Vercel

1. Зарегистрироваться на [vercel.com](https://vercel.com) через GitHub аккаунт
2. Нажать **Add New → Project** → выбрать репозиторий `usdt-miniapp`
3. В разделе **Environment Variables** добавить:
   - `TELEGRAM_BOT_TOKEN` — токен из шага 1
4. Нажать **Deploy** → через 1–2 минуты получить URL вида `https://usdt-miniapp.vercel.app`

### Шаг 4 — Связать бота с Mini App

1. Скопировать URL из Vercel
2. Открыть @BotFather → `/mybots` → выбрать бота → **Bot Settings → Menu Button**
3. Вставить URL Mini App — теперь в боте появится кнопка «Открыть»
4. Также добавить `MINI_APP_URL` в переменные окружения Vercel (тот же URL)

### Шаг 5 — Запустить бота

**Вариант A — Локально (для теста):**
```bash
pip install -r requirements.txt
export TELEGRAM_BOT_TOKEN=ваш_токен
export MINI_APP_URL=https://usdt-miniapp.vercel.app
python bot/bot.py
```

**Вариант B — На Railway.app (бесплатно, всегда онлайн):**
1. Зарегистрироваться на [railway.app](https://railway.app)
2. Создать проект → **Deploy from GitHub** → выбрать репозиторий
3. В разделе Variables добавить `TELEGRAM_BOT_TOKEN` и `MINI_APP_URL`
4. Указать команду запуска: `python bot/bot.py`

> **Важно:** Mini App (калькулятор) живёт на Vercel. Бот (Python) живёт на Railway. Это два независимых сервиса.

---

## Переменные окружения

| Переменная | Описание | По умолчанию |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Токен бота от @BotFather | — (обязательно) |
| `MINI_APP_URL` | URL Mini App на Vercel | — (обязательно) |
| `CACHE_TTL_SECONDS` | Время кэша курсов в секундах | `600` (10 мин) |
| `DEFAULT_BUFFER_PCT` | Буфер по умолчанию в % | `3` |

---

## Команды бота

| Команда | Действие |
|---|---|
| `/start` | Приветствие + кнопка открытия калькулятора |
| `/calc` | Кнопка открытия калькулятора |
| `/help` | Инструкция по использованию |

---

## Логика расчёта

```
kzt_needed  = eur_needed × bank_rate
usdt_worst  = kzt_needed / p2p_min        # нужно больше USDT (по худшему курсу)
usdt_best   = kzt_needed / p2p_max        # нужно меньше USDT
usdt_avg    = kzt_needed / ((p2p_min + p2p_max) / 2)
usdt_result = ceil(usdt_worst × (1 + buffer / 100))   ← рекомендация
```

Рекомендация считается по худшему P2P курсу + буфер — консервативный подход, защищающий от просадки курса.

---

## Источники данных

| Источник | Данные | Метод |
|---|---|---|
| Bybit P2P | KZT/USDT вилка | POST `https://api2.bybit.com/fiat/otc/item/online` |
| OKX P2P | KZT/USDT вилка | GET `https://www.okx.com/v3/c2c/tradingOrders/books` |
| Freedom Bank | KZT/EUR курс покупки | JSON API / HTML парсинг `ffin.kz/ru/exchange` |

Курсы кэшируются в памяти serverless-функции на 10 минут. При недоступности одного источника используются данные другого.

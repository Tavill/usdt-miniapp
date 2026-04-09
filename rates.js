/**
 * Vercel Serverless Function — /api/rates
 * Запрашивает курсы USDT/KZT с Bybit P2P и OKX P2P,
 * курс KZT/EUR с Freedom Bank.
 * Кэширует результат на CACHE_TTL_SECONDS секунд.
 */

// ============================================================
// Кэш (хранится в памяти serverless-инстанса)
// ============================================================
let cache = null;
let cacheTime = 0;

const CACHE_TTL = parseInt(process.env.CACHE_TTL_SECONDS || '600', 10) * 1000; // ms
const TIMEOUT_MS = 5000; // 5 секунд на каждый источник

// ============================================================
// Вспомогательная функция: fetch с таймаутом
// ============================================================
async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ============================================================
// Bybit P2P — курс USDT/KZT
// ============================================================
async function fetchBybit() {
  const res = await fetchWithTimeout(
    'https://api2.bybit.com/fiat/otc/item/online',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tokenId: 'USDT',
        currencyId: 'KZT',
        side: '1',
        size: '5',
        page: '1',
      }),
    }
  );

  if (!res.ok) throw new Error(`Bybit HTTP ${res.status}`);
  const data = await res.json();

  const items = data?.result?.items || [];
  if (!items.length) throw new Error('Bybit: пустой ответ');

  const prices = items.slice(0, 5).map(item => parseFloat(item.price)).filter(p => !isNaN(p));
  if (!prices.length) throw new Error('Bybit: нет цен');

  return {
    min: Math.min(...prices),
    max: Math.max(...prices),
  };
}

// ============================================================
// OKX P2P — курс USDT/KZT
// ============================================================
async function fetchOKX() {
  const params = new URLSearchParams({
    quoteCurrency: 'KZT',
    baseCurrency:  'USDT',
    side:          'sell',
    count:         '5',
  });

  const res = await fetchWithTimeout(
    `https://www.okx.com/v3/c2c/tradingOrders/books?${params}`,
    { headers: { 'Accept': 'application/json' } }
  );

  if (!res.ok) throw new Error(`OKX HTTP ${res.status}`);
  const data = await res.json();

  // OKX может вернуть данные в разных полях в зависимости от версии API
  const asks = data?.data?.sell || data?.data?.asks || [];
  if (!asks.length) throw new Error('OKX: пустой ответ');

  const prices = asks.slice(0, 5).map(item => {
    const price = parseFloat(item.price || item[0]);
    return isNaN(price) ? null : price;
  }).filter(p => p !== null);

  if (!prices.length) throw new Error('OKX: нет цен');

  return {
    min: Math.min(...prices),
    max: Math.max(...prices),
  };
}

// ============================================================
// Freedom Bank — курс KZT/EUR
// ============================================================
async function fetchFreedomBank() {
  // Пробуем JSON API Freedom Bank (ffin.kz)
  try {
    const res = await fetchWithTimeout(
      'https://ffin.kz/api/currency/rates',
      { headers: { 'Accept': 'application/json' } }
    );
    if (res.ok) {
      const data = await res.json();
      // Ищем EUR в разных форматах ответа
      const rates = data?.data || data?.rates || data || [];
      const eurRate = Array.isArray(rates)
        ? rates.find(r => (r.currency || r.code || r.iso)?.toUpperCase() === 'EUR')
        : null;

      if (eurRate) {
        const buyRate = parseFloat(eurRate.buy || eurRate.buyRate || eurRate.purchase);
        if (!isNaN(buyRate) && buyRate > 0) return buyRate;
      }
    }
  } catch (_) {
    // Продолжаем к парсингу HTML
  }

  // Fallback: парсинг HTML страницы ffin.kz/ru/exchange
  const htmlRes = await fetchWithTimeout('https://ffin.kz/ru/exchange', {
    headers: {
      'Accept': 'text/html',
      'User-Agent': 'Mozilla/5.0 (compatible; USDT-Calculator/1.0)',
    },
  });

  if (!htmlRes.ok) throw new Error(`Freedom Bank HTTP ${htmlRes.status}`);

  const html = await htmlRes.text();

  // Ищем строку с EUR и колонку "Покупка"
  // Паттерн: EUR ... число (покупка) ... число (продажа)
  const patterns = [
    /EUR[\s\S]{0,200}?(\d{3,4}[.,]\d{1,2})/i,
    /EUR[^<]*<\/td>\s*<td[^>]*>[\s]*(\d{3,4}[.,]\d{1,2})/i,
    /"EUR"[\s\S]{0,100}?"buy"\s*:\s*"?(\d{3,4}[.,]\d{1,2})/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const rate = parseFloat(match[1].replace(',', '.'));
      if (!isNaN(rate) && rate > 100) return rate; // KZT/EUR должен быть > 100
    }
  }

  throw new Error('Freedom Bank: не удалось извлечь курс EUR');
}

// ============================================================
// Основная функция: получить все курсы
// ============================================================
async function getRates() {
  const results = await Promise.allSettled([
    fetchBybit(),
    fetchOKX(),
    fetchFreedomBank(),
  ]);

  const [bybitRes, okxRes, freedomRes] = results;

  // P2P: объединяем Bybit и OKX
  let p2p = null;
  const p2pSources = [];
  const p2pPrices = [];
  const p2pErrors = {};

  if (bybitRes.status === 'fulfilled') {
    p2pPrices.push(bybitRes.value);
    p2pSources.push('bybit');
  } else {
    p2pErrors.bybit = bybitRes.reason?.message || 'error';
    console.error('Bybit error:', bybitRes.reason);
  }

  if (okxRes.status === 'fulfilled') {
    p2pPrices.push(okxRes.value);
    p2pSources.push('okx');
  } else {
    p2pErrors.okx = okxRes.reason?.message || 'error';
    console.error('OKX error:', okxRes.reason);
  }

  if (p2pPrices.length > 0) {
    // Объединяем вилки: берём глобальный min и max
    const allMins = p2pPrices.map(p => p.min);
    const allMaxs = p2pPrices.map(p => p.max);
    p2p = {
      min: Math.min(...allMins),
      max: Math.max(...allMaxs),
      sources: p2pSources,
    };
  } else {
    p2p = {
      min: null,
      max: null,
      sources: [],
      error: Object.values(p2pErrors).join('; '),
    };
  }

  // Банк
  let bank = null;
  if (freedomRes.status === 'fulfilled') {
    bank = {
      eur_kzt: freedomRes.value,
      source: 'freedom',
    };
  } else {
    console.error('Freedom Bank error:', freedomRes.reason);
    bank = {
      eur_kzt: null,
      source: null,
      error: freedomRes.reason?.message || 'timeout',
    };
  }

  return { p2p, bank };
}

// ============================================================
// Vercel Handler
// ============================================================
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const forceRefresh = req.query.force === '1';
  const now = Date.now();

  // Отдать кэш если он свежий
  if (!forceRefresh && cache && now - cacheTime < CACHE_TTL) {
    return res.status(200).json({ ...cache, cache_hit: true });
  }

  try {
    const { p2p, bank } = await getRates();

    const responseData = {
      p2p,
      bank,
      updated_at: new Date().toISOString(),
      cache_hit: false,
    };

    // Сохранить в кэш
    cache = responseData;
    cacheTime = now;

    return res.status(200).json(responseData);
  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({
      error: 'Internal server error',
      message: err.message,
    });
  }
}

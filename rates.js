/**
 * Vercel Serverless Function — /api/rates
 *
 * Источники курсов (с автоматическим fallback):
 *
 * USDT/KZT:
 *   1. Bybit P2P API       — реальная P2P вилка (может блокировать)
 *   2. OKX P2P API         — реальная P2P вилка (может блокировать)
 *   3. CoinGecko API       — надёжный fallback, курс USDT/KZT без ключа
 *   4. Frankfurter API     — USD/KZT (USDT ≈ USD), самый надёжный запасной
 *
 * EUR/KZT:
 *   1. Freedom Bank        — реальный курс банка (может блокировать)
 *   2. Frankfurter API     — надёжный fallback, курс EUR/KZT без ключа
 */

let cache = null;
let cacheTime = 0;
const CACHE_TTL = parseInt(process.env.CACHE_TTL_SECONDS || '600', 10) * 1000;
const TIMEOUT_MS = 6000;

// ─── fetch с таймаутом ────────────────────────────────────────
async function fetchWithTimeout(url, options = {}, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    clearTimeout(t);
    return res;
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

// ─── Bybit P2P ────────────────────────────────────────────────
async function fetchBybit() {
  const res = await fetchWithTimeout(
    'https://api2.bybit.com/fiat/otc/item/online',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenId: 'USDT', currencyId: 'KZT', side: '1', size: '5', page: '1' }),
    }
  );
  if (!res.ok) throw new Error(`Bybit ${res.status}`);
  const data = await res.json();
  const prices = (data?.result?.items || [])
    .slice(0, 5).map(i => parseFloat(i.price)).filter(p => p > 0);
  if (!prices.length) throw new Error('Bybit: нет цен');
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

// ─── OKX P2P ─────────────────────────────────────────────────
async function fetchOKX() {
  const params = new URLSearchParams({ quoteCurrency: 'KZT', baseCurrency: 'USDT', side: 'sell', count: '5' });
  const res = await fetchWithTimeout(`https://www.okx.com/v3/c2c/tradingOrders/books?${params}`);
  if (!res.ok) throw new Error(`OKX ${res.status}`);
  const data = await res.json();
  const asks = data?.data?.sell || data?.data?.asks || [];
  const prices = asks.slice(0, 5).map(i => parseFloat(i.price || i[0])).filter(p => p > 0);
  if (!prices.length) throw new Error('OKX: нет цен');
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

// ─── CoinGecko — USDT/KZT (fallback) ─────────────────────────
async function fetchCoinGecko() {
  const res = await fetchWithTimeout(
    'https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=kzt',
    { headers: { 'Accept': 'application/json' } }
  );
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const data = await res.json();
  const rate = data?.tether?.kzt;
  if (!rate || rate <= 0) throw new Error('CoinGecko: нет курса KZT');
  // CoinGecko даёт единственную цену — делаем символическую вилку ±0.5%
  return {
    min: Math.round(rate * 0.995 * 100) / 100,
    max: Math.round(rate * 1.005 * 100) / 100,
    isFallback: true,
  };
}

// ─── Frankfurter — USD/KZT (самый надёжный fallback) ─────────
async function fetchFrankfurterUSD() {
  const res = await fetchWithTimeout('https://api.frankfurter.app/latest?from=USD&to=KZT');
  if (!res.ok) throw new Error(`Frankfurter USD ${res.status}`);
  const data = await res.json();
  const rate = data?.rates?.KZT;
  if (!rate || rate <= 0) throw new Error('Frankfurter: нет KZT');
  return {
    min: Math.round(rate * 0.995 * 100) / 100,
    max: Math.round(rate * 1.005 * 100) / 100,
    isFallback: true,
  };
}

// ─── Freedom Bank — EUR/KZT ───────────────────────────────────
async function fetchFreedomBank() {
  // Пробуем JSON API
  try {
    const res = await fetchWithTimeout('https://ffin.kz/api/currency/rates', {
      headers: { 'Accept': 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      const rates = data?.data || data?.rates || data || [];
      const eur = Array.isArray(rates)
        ? rates.find(r => (r.currency || r.code || r.iso)?.toUpperCase() === 'EUR')
        : null;
      if (eur) {
        const buy = parseFloat(eur.buy || eur.buyRate || eur.purchase);
        if (buy > 100) return buy;
      }
    }
  } catch (_) {}

  // Fallback: HTML
  const res = await fetchWithTimeout('https://ffin.kz/ru/exchange', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bot/1.0)' },
  });
  if (!res.ok) throw new Error(`Freedom ${res.status}`);
  const html = await res.text();
  for (const re of [
    /EUR[^<]*<\/td>\s*<td[^>]*>\s*(\d{3,4}[.,]\d{1,2})/i,
    /EUR[\s\S]{0,300}?(\d{3,4}[.,]\d{1,2})/,
  ]) {
    const m = html.match(re);
    if (m) {
      const v = parseFloat(m[1].replace(',', '.'));
      if (v > 100) return v;
    }
  }
  throw new Error('Freedom Bank: не удалось извлечь EUR');
}

// ─── Frankfurter — EUR/KZT (надёжный fallback) ───────────────
async function fetchFrankfurterEUR() {
  const res = await fetchWithTimeout('https://api.frankfurter.app/latest?from=EUR&to=KZT');
  if (!res.ok) throw new Error(`Frankfurter EUR ${res.status}`);
  const data = await res.json();
  const rate = data?.rates?.KZT;
  if (!rate || rate <= 0) throw new Error('Frankfurter EUR: нет KZT');
  return rate;
}

// ─── Собрать все курсы ────────────────────────────────────────
async function getRates() {
  const [bybitRes, okxRes, cgRes, fxUsdRes, freedomRes, fxEurRes] = await Promise.allSettled([
    fetchBybit(),
    fetchOKX(),
    fetchCoinGecko(),
    fetchFrankfurterUSD(),
    fetchFreedomBank(),
    fetchFrankfurterEUR(),
  ]);

  // ── P2P USDT/KZT ──
  let p2p = null;
  const p2pSources = [];
  const p2pPrices = [];

  if (bybitRes.status === 'fulfilled') {
    p2pPrices.push(bybitRes.value);
    p2pSources.push('bybit');
  }
  if (okxRes.status === 'fulfilled') {
    p2pPrices.push(okxRes.value);
    p2pSources.push('okx');
  }

  if (p2pPrices.length > 0) {
    // Есть реальные P2P данные
    p2p = {
      min: Math.min(...p2pPrices.map(p => p.min)),
      max: Math.max(...p2pPrices.map(p => p.max)),
      sources: p2pSources,
    };
  } else if (cgRes.status === 'fulfilled') {
    // Fallback: CoinGecko
    p2p = { ...cgRes.value, sources: ['coingecko'] };
    console.log('P2P fallback: CoinGecko');
  } else if (fxUsdRes.status === 'fulfilled') {
    // Fallback: Frankfurter USD/KZT
    p2p = { ...fxUsdRes.value, sources: ['frankfurter'] };
    console.log('P2P fallback: Frankfurter USD/KZT');
  } else {
    p2p = { min: null, max: null, sources: [], error: 'all sources failed' };
  }

  // ── EUR/KZT банк ──
  let bank = null;
  if (freedomRes.status === 'fulfilled') {
    bank = { eur_kzt: freedomRes.value, source: 'freedom' };
  } else if (fxEurRes.status === 'fulfilled') {
    // Fallback: Frankfurter EUR/KZT
    bank = { eur_kzt: fxEurRes.value, source: 'frankfurter' };
    console.log('Bank fallback: Frankfurter EUR/KZT');
  } else {
    bank = { eur_kzt: null, source: null, error: 'all sources failed' };
  }

  return { p2p, bank };
}

// ─── Vercel Handler ───────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const force = req.query.force === '1';
  const now = Date.now();

  if (!force && cache && now - cacheTime < CACHE_TTL) {
    return res.status(200).json({ ...cache, cache_hit: true });
  }

  try {
    const { p2p, bank } = await getRates();
    const data = { p2p, bank, updated_at: new Date().toISOString(), cache_hit: false };
    cache = data;
    cacheTime = now;
    return res.status(200).json(data);
  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
}

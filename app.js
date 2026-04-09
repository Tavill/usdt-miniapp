/**
 * USDT → EUR Калькулятор — app.js
 *
 * Курсы загружаются из браузера напрямую.
 * Несколько источников с автоматическим fallback:
 *
 * USDT/KZT:
 *   1. open.er-api.com  (USD/KZT, USDT ≈ USD, бесплатно, без ключа)
 *   2. CryptoCompare    (USDT/KZT, бесплатно, без ключа)
 *
 * EUR/KZT:
 *   1. open.er-api.com  (EUR/KZT, бесплатно, без ключа)
 *   2. frankfurter.app  (EUR/KZT, бесплатно, без ключа)
 */

const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

const state = { p2pMin: null, p2pMax: null, bankRate: null, buffer: 3, loading: false };

const $ = id => document.getElementById(id);
const els = {
  loadingOverlay: $('loading-overlay'),
  app:            $('app'),
  refreshBtn:     $('refresh-btn'),
  ratesWarning:   $('rates-warning'),
  p2pMin:         $('p2p-min'),
  p2pMax:         $('p2p-max'),
  bankRate:       $('bank-rate'),
  p2pSource:      $('p2p-source'),
  bankSource:     $('bank-source'),
  updatedAt:      $('updated-at'),
  eurInput:       $('eur-input'),
  bufferButtons:  $('buffer-buttons'),
  resultBlock:    $('result-block'),
  resultUsdt:     $('result-usdt'),
  resultDetails:  $('result-details'),
  hintEmpty:      $('hint-empty'),
};

/* ── helpers ─────────────────────────────────────────────── */
function setReadonly(input, on) {
  input.readOnly = on;
  input.style.background  = on ? '' : 'var(--accent-light)';
  input.style.borderColor = on ? '' : 'var(--accent)';
}
function showWarning(text) {
  els.ratesWarning.textContent   = text || '';
  els.ratesWarning.style.display = text ? 'block' : 'none';
}
function showApp() {
  els.loadingOverlay.style.display = 'none';
  els.app.style.display = 'block';
}
async function getJSON(url, timeout) {
   res = await fetch(url, { signal: AbortSignal.timeout(timeout || 7000) });
  if (!res.ok) throw new Error(res.status);
  return res.json();
}

/* ── источники USDT/KZT ──────────────────────────────────── */
async function usdtKztFromOpenER() {
  // Один запрос — берём и USD/KZT и EUR/KZT сразу
  const d = await getJSON('https://open.er-api.com/v6/latest/USD');
  if (!d.rates?.KZT) throw new Error('no KZT');
  return d.rates.KZT;           // USD/KZT ≈ USDT/KZT
}

async function usdtKztFromCryptoCompare() {
  const d = await getJSON('https://min-api.cryptocompare.com/data/price?fsym=USDT&tsyms=KZT');
  if (!d.KZT) throw new Error('no KZT');
  return d.KZT;
}

/* ── источники EUR/KZT ───────────────────────────────────── */
async function eurKztFromOpenER() {
  const d = await getJSON('https://open.er-api.com/v6/latest/EUR');
  if (!d.rates?.KZT) throw new Error('no KZT');
  return d.rates.KZT;
}

async function eurKztFromFrankfurter() {
  const d = await getJSON('https://api.frankfurter.app/latest?from=EUR&to=KZT');
  if (!d.rates?.KZT) throw new Error('no KZT');
  return d.rates.KZT;
}

/* ── получить курс, перебирая источники ──────────────────── */
async function tryAll(label, sources) {
  for (const { fn, name } of sources) {
    try {
      const val = await fn();
      console.log(label + ' OK: ' + name + ' = ' + val);
      return { val, name };
    } catch(e) {
      console.warn(label + ' fail: ' + name, e.message);
    }
  }
  return null;
}

/* ── основная загрузка ───────────────────────────────────── */
async function fetchRates() {
  if (state.loading) return;
  state.loading = true;
  els.refreshBtn.classList.add('spinning');
  els.refreshBtn.disabled = true;

  const [usdtResult, eurResult] = await Promise.all([
    tryAll('USDT/KZT', [
      { fn: usdtKztFromOpenER,        name: 'ExchangeRate (USD)' },
      { fn: usdtKztFromCryptoCompare, name: 'CryptoCompare'      },
    ]),
    tryAll('EUR/KZT', [
      { fn: eurKztFromOpenER,      name: 'ExchangeRate (EUR)' },
      { fn: eurKztFromFrankfurter, name: 'Frankfurter'        },
    ]),
  ]);

  const warnings = [];

  if (usdtResult) {
    const rate = usdtResult.val;
    const min  = Math.round(rate * 0.974 * 100) / 100;   // -2.6%
const max  = Math.round(rate * 1.051 * 100) / 100;   // +5.1%
    state.p2pMin = min; state.p2pMax = max;
    els.p2pMin.value = min; els.p2pMax.value = max;
    setReadonly(els.p2pMin, true); setReadonly(els.p2pMax, true);
    els.p2pSource.textContent = 'Источник: ' + usdtResult.name;
  } else {
    setReadonly(els.p2pMin, false); setReadonly(els.p2pMax, false);
    els.p2pSource.textContent = '';
    warnings.push('Курс USDT/KZT недоступен — введите вручную');
  }

  if (eurResult) {
    state.bankRate = eurResult.val;
    els.bankRate.value = eurResult.val;
    setReadonly(els.bankRate, true);
    els.bankSource.textContent = 'Источник: ' + eurResult.name;
  } else {
    setReadonly(els.bankRate, false);
    els.bankSource.textContent = '';
    warnings.push('Курс EUR/KZT недоступен — введите вручную');
  }

  if (usdtResult || eurResult) {
    const t = new Date();
    els.updatedAt.textContent = 'Обновлено: ' +
      t.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  showWarning(warnings.join(' · '));
  recalculate();

  state.loading = false;
  els.refreshBtn.classList.remove('spinning');
  els.refreshBtn.disabled = false;
  showApp();
}

/* ── расчёт ─────────────────────────────────────────────── */
function recalculate() {
  const eur    = parseFloat(els.eurInput.value);
  const p2pMin = parseFloat(els.p2pMin.value);
  const p2pMax = parseFloat(els.p2pMax.value);
  const bank   = parseFloat(els.bankRate.value);
  const buf    = state.buffer;

  if (!eur || eur <= 0 || isNaN(eur)) {
    els.resultBlock.style.display = 'none';
    els.hintEmpty.style.display = 'block';
    return;
  }
  if ([p2pMin, p2pMax, bank].some(v => !v || v <= 0 || isNaN(v))) {
    els.resultBlock.style.display = 'none';
    els.hintEmpty.style.display = 'none';
    return;
  }

  const kzt        = eur * bank;
  const worst      = kzt / p2pMin;
  const best       = kzt / p2pMax;
  const avg        = kzt / ((p2pMin + p2pMax) / 2);
  const result     = Math.ceil(worst * (1 + buf / 100));

  els.resultBlock.style.display = 'block';
  els.hintEmpty.style.display   = 'none';
  els.resultUsdt.textContent = result.toLocaleString('ru-RU');

  const row = (label, val) =>
    '<div class="detail-item"><span class="detail-label">' + label +
    '</span><span class="detail-value">' + val + '</span></div>';

  els.resultDetails.innerHTML =
    row('Нужно KZT',       Math.ceil(kzt).toLocaleString('ru-RU') + ' ₸') +
    row('По мин. P2P',     worst.toFixed(2) + ' USDT') +
    row('По макс. P2P',    best.toFixed(2)  + ' USDT') +
    row('Среднее',         avg.toFixed(2)   + ' USDT') +
    row('Буфер ' + buf + '%', '+' + (worst * buf / 100).toFixed(2) + ' USDT') +
    row('Курс банка',      bank.toLocaleString('ru-RU') + ' ₸/€');
}

/* ── события ────────────────────────────────────────────── */
els.bufferButtons.querySelectorAll('.buf-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    els.bufferButtons.querySelectorAll('.buf-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    state.buffer = parseInt(btn.dataset.value, 10);
    recalculate();
  });
});

els.eurInput.addEventListener('input', recalculate);
els.refreshBtn.addEventListener('click', fetchRates);
[els.p2pMin, els.p2pMax, els.bankRate].forEach(function(el) {
  el.addEventListener('input', recalculate);
});

/* ── старт ──────────────────────────────────────────────── */
fetchRates();

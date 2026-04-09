/**
 * USDT → EUR Калькулятор
 * Telegram Mini App — app.js
 *
 * Курсы подтягиваются напрямую из браузера:
 *   USDT/KZT — CoinGecko (бесплатно, без ключа, CORS разрешён)
 *   EUR/KZT  — frankfurter.app (бесплатно, без ключа, CORS разрешён)
 */

// ── Telegram SDK ──────────────────────────────────────────────
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

// ── Состояние ─────────────────────────────────────────────────
const state = {
  p2pMin:      null,
  p2pMax:      null,
  bankRate:    null,
  buffer:      3,
  ratesLoading: false,
};

// ── DOM ───────────────────────────────────────────────────────
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

// ── Вспомогательные ──────────────────────────────────────────
function formatTime(date) {
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function setReadonly(input, on) {
  input.readOnly = on;
  input.style.background   = on ? '' : 'var(--accent-light)';
  input.style.borderColor  = on ? '' : 'var(--accent)';
}

function showApp() {
  els.loadingOverlay.style.display = 'none';
  els.app.style.display = 'block';
}

function showWarning(text) {
  if (text) {
    els.ratesWarning.textContent = text;
    els.ratesWarning.style.display = 'block';
  } else {
    els.ratesWarning.style.display = 'none';
  }
}

// ── Получить USDT/KZT с CoinGecko ────────────────────────────
async function fetchUSDT_KZT() {
  const res = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=kzt',
    { signal: AbortSignal.timeout(8000) }
  );
  if (!res.ok) throw new Error('CoinGecko ' + res.status);
  const data = await res.json();
  const rate = data?.tether?.kzt;
  if (!rate || rate <= 0) throw new Error('CoinGecko: нет данных');
  return {
    min: Math.round(rate * 0.995 * 100) / 100,
    max: Math.round(rate * 1.005 * 100) / 100,
    source: 'CoinGecko',
  };
}

// ── Получить EUR/KZT с Frankfurter ───────────────────────────
async function fetchEUR_KZT() {
  const res = await fetch(
    'https://api.frankfurter.app/latest?from=EUR&to=KZT',
    { signal: AbortSignal.timeout(8000) }
  );
  if (!res.ok) throw new Error('Frankfurter ' + res.status);
  const data = await res.json();
  const rate = data?.rates?.KZT;
  if (!rate || rate <= 0) throw new Error('Frankfurter: нет данных');
  return { rate, source: 'Frankfurter' };
}

// ── Загрузить курсы ──────────────────────────────────────────
async function fetchRates() {
  if (state.ratesLoading) return;
  state.ratesLoading = true;
  els.refreshBtn.classList.add('spinning');
  els.refreshBtn.disabled = true;

  const warnings = [];

  const [usdtRes, eurRes] = await Promise.allSettled([
    fetchUSDT_KZT(),
    fetchEUR_KZT(),
  ]);

  // USDT/KZT
  if (usdtRes.status === 'fulfilled') {
    const { min, max, source } = usdtRes.value;
    state.p2pMin = min;
    state.p2pMax = max;
    els.p2pMin.value = min;
    els.p2pMax.value = max;
    setReadonly(els.p2pMin, true);
    setReadonly(els.p2pMax, true);
    els.p2pSource.textContent = 'Источник: ' + source;
  } else {
    console.error('USDT/KZT:', usdtRes.reason);
    setReadonly(els.p2pMin, false);
    setReadonly(els.p2pMax, false);
    els.p2pSource.textContent = '';
    warnings.push('Курс USDT/KZT недоступен — введите вручную');
  }

  // EUR/KZT
  if (eurRes.status === 'fulfilled') {
    const { rate, source } = eurRes.value;
    state.bankRate = rate;
    els.bankRate.value = rate;
    setReadonly(els.bankRate, true);
    els.bankSource.textContent = 'Источник: ' + source;
  } else {
    console.error('EUR/KZT:', eurRes.reason);
    setReadonly(els.bankRate, false);
    els.bankSource.textContent = '';
    warnings.push('Курс EUR/KZT недоступен — введите вручную');
  }

  if (usdtRes.status === 'fulfilled' || eurRes.status === 'fulfilled') {
    els.updatedAt.textContent = 'Обновлено: ' + formatTime(new Date());
  }

  showWarning(warnings.join(' · '));
  recalculate();

  state.ratesLoading = false;
  els.refreshBtn.classList.remove('spinning');
  els.refreshBtn.disabled = false;
  showApp();
}

// ── Расчёт ───────────────────────────────────────────────────
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
  if (isNaN(p2pMin) || isNaN(p2pMax) || isNaN(bank) || p2pMin <= 0 || p2pMax <= 0 || bank <= 0) {
    els.resultBlock.style.display = 'none';
    els.hintEmpty.style.display = 'none';
    return;
  }

  const kztNeeded  = eur * bank;
  const usdtWorst  = kztNeeded / p2pMin;
  const usdtBest   = kztNeeded / p2pMax;
  const usdtAvg    = kztNeeded / ((p2pMin + p2pMax) / 2);
  const usdtResult = Math.ceil(usdtWorst * (1 + buf / 100));

  els.resultBlock.style.display = 'block';
  els.hintEmpty.style.display = 'none';
  els.resultUsdt.textContent = usdtResult.toLocaleString('ru-RU');

  els.resultDetails.innerHTML =
    '<div class="detail-item"><span class="detail-label">Нужно KZT</span>' +
    '<span class="detail-value">' + Math.ceil(kztNeeded).toLocaleString('ru-RU') + ' ₸</span></div>' +
    '<div class="detail-item"><span class="detail-label">По мин. P2P</span>' +
    '<span class="detail-value">' + usdtWorst.toFixed(2) + ' USDT</span></div>' +
    '<div class="detail-item"><span class="detail-label">По макс. P2P</span>' +
    '<span class="detail-value">' + usdtBest.toFixed(2) + ' USDT</span></div>' +
    '<div class="detail-item"><span class="detail-label">Среднее</span>' +
    '<span class="detail-value">' + usdtAvg.toFixed(2) + ' USDT</span></div>' +
    '<div class="detail-item"><span class="detail-label">Буфер ' + buf + '%</span>' +
    '<span class="detail-value">+' + (usdtWorst * buf / 100).toFixed(2) + ' USDT</span></div>' +
    '<div class="detail-item"><span class="detail-label">Курс банка</span>' +
    '<span class="detail-value">' + bank.toLocaleString('ru-RU') + ' ₸/€</span></div>';
}

// ── Обработчики событий ───────────────────────────────────────
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
els.p2pMin.addEventListener('input', recalculate);
els.p2pMax.addEventListener('input', recalculate);
els.bankRate.addEventListener('input', recalculate);

// ── Старт ─────────────────────────────────────────────────────
fetchRates();

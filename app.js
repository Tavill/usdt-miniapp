/**
 * USDT → EUR Калькулятор
 * Telegram Mini App — app.js
 */

// ============================================================
// Инициализация Telegram Mini App SDK
// ============================================================
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

// ============================================================
// Константы и состояние
// ============================================================
const API_URL = '/api/rates';
const DEFAULT_BUFFER = 3;

const state = {
  p2pMin: null,
  p2pMax: null,
  bankRate: null,
  buffer: DEFAULT_BUFFER,
  eurAmount: null,
  ratesLoading: false,
  ratesError: null,
  p2pManual: false,  // пользователь вводит P2P вручную
  bankManual: false, // пользователь вводит банк вручную
  updatedAt: null,
};

// ============================================================
// Элементы DOM
// ============================================================
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

// ============================================================
// Загрузка курсов с API
// ============================================================
async function fetchRates(force = false) {
  if (state.ratesLoading) return;
  state.ratesLoading = true;

  els.refreshBtn.classList.add('spinning');
  els.refreshBtn.disabled = true;

  const url = force ? `${API_URL}?force=1` : API_URL;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    applyRates(data);
  } catch (err) {
    handleRatesError(err);
  } finally {
    state.ratesLoading = false;
    els.refreshBtn.classList.remove('spinning');
    els.refreshBtn.disabled = false;
    showApp();
  }
}

function applyRates(data) {
  const warnings = [];

  // P2P курсы
  if (data.p2p && data.p2p.min != null && data.p2p.max != null) {
    if (!state.p2pManual) {
      state.p2pMin = data.p2p.min;
      state.p2pMax = data.p2p.max;
      els.p2pMin.value = data.p2p.min;
      els.p2pMax.value = data.p2p.max;
      setInputReadonly(els.p2pMin, true);
      setInputReadonly(els.p2pMax, true);
    }
    const sources = data.p2p.sources || [];
    if (sources.length === 1) {
      warnings.push(`Данные P2P только из ${sources[0].toUpperCase()}`);
    }
    els.p2pSource.textContent = sources.length ? `Источники: ${sources.join(', ').toUpperCase()}` : '';
  } else {
    // Нет P2P данных — разблокировать ручной ввод
    state.p2pManual = true;
    setInputReadonly(els.p2pMin, false);
    setInputReadonly(els.p2pMax, false);
    els.p2pSource.textContent = '';
    warnings.push('P2P данные недоступны — введите курс вручную');
  }

  // Курс банка
  if (data.bank && data.bank.eur_kzt != null) {
    if (!state.bankManual) {
      state.bankRate = data.bank.eur_kzt;
      els.bankRate.value = data.bank.eur_kzt;
      setInputReadonly(els.bankRate, true);
    }
    els.bankSource.textContent = data.bank.source ? `Источник: ${data.bank.source}` : '';
    if (data.bank.error) {
      warnings.push(`Курс банка: ${data.bank.error}`);
    }
  } else {
    state.bankManual = true;
    setInputReadonly(els.bankRate, false);
    els.bankSource.textContent = '';
    warnings.push('Курс банка недоступен — введите вручную');
  }

  // Время обновления
  if (data.updated_at) {
    state.updatedAt = new Date(data.updated_at);
    const cacheLabel = data.cache_hit ? ' (кэш)' : '';
    els.updatedAt.textContent = `Обновлено: ${formatTime(state.updatedAt)}${cacheLabel}`;
  }

  // Предупреждения
  if (warnings.length) {
    els.ratesWarning.textContent = warnings.join(' · ');
    els.ratesWarning.style.display = 'block';
  } else {
    els.ratesWarning.style.display = 'none';
  }

  recalculate();
}

function handleRatesError(err) {
  console.error('Ошибка загрузки курсов:', err);
  // Разблокировать все поля для ручного ввода
  state.p2pManual = true;
  state.bankManual = true;
  setInputReadonly(els.p2pMin, false);
  setInputReadonly(els.p2pMax, false);
  setInputReadonly(els.bankRate, false);
  els.ratesWarning.textContent = 'Не удалось загрузить курсы. Введите вручную.';
  els.ratesWarning.style.display = 'block';
  els.p2pSource.textContent = '';
  els.bankSource.textContent = '';
  els.updatedAt.textContent = '—';
}

function setInputReadonly(input, readonly) {
  input.readOnly = readonly;
  input.style.opacity = readonly ? '1' : '1';
  input.style.background = readonly ? '' : 'var(--accent-light)';
  input.style.borderColor = readonly ? '' : 'var(--accent)';
}

function showApp() {
  els.loadingOverlay.style.display = 'none';
  els.app.style.display = 'block';
}

// ============================================================
// Формат времени
// ============================================================
function formatTime(date) {
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ============================================================
// Логика расчёта
// ============================================================
function recalculate() {
  const eurAmount = parseFloat(els.eurInput.value);
  const p2pMin   = parseFloat(els.p2pMin.value);
  const p2pMax   = parseFloat(els.p2pMax.value);
  const bankRate = parseFloat(els.bankRate.value);
  const buffer   = state.buffer;

  // Нет суммы
  if (!eurAmount || isNaN(eurAmount) || eurAmount <= 0) {
    els.resultBlock.style.display = 'none';
    els.hintEmpty.style.display = 'block';
    return;
  }

  // Нет курсов
  if (isNaN(p2pMin) || isNaN(p2pMax) || isNaN(bankRate) ||
      p2pMin <= 0 || p2pMax <= 0 || bankRate <= 0) {
    els.resultBlock.style.display = 'none';
    els.hintEmpty.style.display = 'none';
    return;
  }

  // Расчёт по формулам из ТЗ
  const kztNeeded  = eurAmount * bankRate;
  const usdtWorst  = kztNeeded / p2pMin;                          // по минимальному P2P (нужно больше)
  const usdtBest   = kztNeeded / p2pMax;                          // по максимальному P2P
  const usdtAvg    = kztNeeded / ((p2pMin + p2pMax) / 2);        // среднее
  const usdtResult = Math.ceil(usdtWorst * (1 + buffer / 100));  // рекомендация: худший + буфер

  // Показать результат
  els.resultBlock.style.display = 'block';
  els.hintEmpty.style.display = 'none';
  els.resultUsdt.textContent = usdtResult.toLocaleString('ru-RU');

  els.resultDetails.innerHTML = `
    <div class="detail-item">
      <span class="detail-label">Нужно KZT</span>
      <span class="detail-value">${Math.ceil(kztNeeded).toLocaleString('ru-RU')} ₸</span>
    </div>
    <div class="detail-item">
      <span class="detail-label">По мин. P2P</span>
      <span class="detail-value">${usdtWorst.toFixed(2)} USDT</span>
    </div>
    <div class="detail-item">
      <span class="detail-label">По макс. P2P</span>
      <span class="detail-value">${usdtBest.toFixed(2)} USDT</span>
    </div>
    <div class="detail-item">
      <span class="detail-label">Среднее</span>
      <span class="detail-value">${usdtAvg.toFixed(2)} USDT</span>
    </div>
    <div class="detail-item">
      <span class="detail-label">Буфер ${buffer}%</span>
      <span class="detail-value">+${(usdtWorst * buffer / 100).toFixed(2)} USDT</span>
    </div>
    <div class="detail-item">
      <span class="detail-label">Курс банка</span>
      <span class="detail-value">${bankRate.toLocaleString('ru-RU')} ₸/€</span>
    </div>
  `;
}

// ============================================================
// Обработчики событий
// ============================================================

// Кнопки буфера
els.bufferButtons.querySelectorAll('.buf-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    els.bufferButtons.querySelectorAll('.buf-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.buffer = parseInt(btn.dataset.value, 10);
    recalculate();
  });
});

// Ввод EUR — мгновенный пересчёт
els.eurInput.addEventListener('input', recalculate);

// Кнопка обновления
els.refreshBtn.addEventListener('click', () => fetchRates(true));

// Ручной ввод курсов
els.p2pMin.addEventListener('input', () => { state.p2pManual = true; recalculate(); });
els.p2pMax.addEventListener('input', () => { state.p2pManual = true; recalculate(); });
els.bankRate.addEventListener('input', () => { state.bankManual = true; recalculate(); });

// ============================================================
// Запуск
// ============================================================
fetchRates();

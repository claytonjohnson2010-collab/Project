// ─── Helpers ───────────────────────────────────────────────────────────
const HIDDEN_VAL = '••••••';
let balanceHidden = localStorage.getItem('balanceHidden') === 'true';

const fmt = n => {
  if (n == null) return '—';
  if (balanceHidden) return HIDDEN_VAL;
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtOz  = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 4 }) + ' oz';
const fmtPct = n => (n >= 0 ? '+' : '') + Number(n).toFixed(2) + '%';
const esc    = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const METALS       = ['gold','silver','platinum','palladium'];
const METAL_LABELS = { gold:'Gold', silver:'Silver', platinum:'Platinum', palladium:'Palladium' };
const METAL_COLORS = { gold:'#f5c842', silver:'#b0bec5', platinum:'#90caf9', palladium:'#ce93d8' };

let prices = {}, holdings = [], currentRange = '1M';
let historyCharts = {}, allocationChart = null, costValueChart = null;
let pieChart = null, pieCostChart = null;
let allocView = localStorage.getItem('allocView') || 'bar';
let groupCollapsed = { gold:false, silver:false, platinum:false, palladium:false };
// sort state per metal group: { col: 'description'|'oz'|'cost'|'mv'|'gl'|'date'|null, dir: 1|-1 }
let groupSort = { gold:{col:null,dir:1}, silver:{col:null,dir:1}, platinum:{col:null,dir:1}, palladium:{col:null,dir:1} };
let historyCollapsed = localStorage.getItem('historyCollapsed') === 'true';

// ─── Theme ─────────────────────────────────────────────────────────────
function initTheme() {
  const t = localStorage.getItem('theme') || 'dark';
  applyTheme(t);
}
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  document.getElementById('theme-icon').textContent = t === 'dark' ? '☀️' : '🌙';
}
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('theme', next);
  redrawCharts();
}

// ─── Visibility toggle ─────────────────────────────────────────────────
function initVisibility() {
  applyVisibility();
}
function applyVisibility() {
  document.body.classList.toggle('balance-hidden', balanceHidden);
  const btn = document.getElementById('visibility-btn');
  if (balanceHidden) {
    btn.classList.add('active');
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
  } else {
    btn.classList.remove('active');
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  }
}
function toggleVisibility() {
  balanceHidden = !balanceHidden;
  localStorage.setItem('balanceHidden', balanceHidden);
  applyVisibility();
  // Re-render everything that shows money values
  if (window._lastPortfolio) {
    renderHero(window._lastPortfolio);
    renderByMetal(window._lastPortfolio.by_metal);
    renderHoldings(holdings, window._lastPortfolio.prices);
    renderAllocationCharts(window._lastPortfolio);
  }
}

// ─── Data loading ───────────────────────────────────────────────────────
async function load() {
  try {
    const [portfolio, holdingsData, metrics] = await Promise.all([
      fetch('/api/portfolio').then(r => r.json()),
      fetch('/api/holdings').then(r => r.json()),
      fetch('/api/metrics').then(r => r.json()),
    ]);
    prices = portfolio.prices || {};
    holdings = holdingsData;
    window._lastPortfolio = portfolio;
    window._lastMetrics   = metrics;
    renderHero(portfolio);
    renderSpotPrices(portfolio.prices, metrics);
    renderMetrics(metrics, portfolio.prices);
    renderByMetal(portfolio.by_metal);
    renderHoldings(holdingsData, portfolio.prices);
    renderAllocationCharts(portfolio);
    document.getElementById('last-updated').textContent =
      'Updated ' + new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  } catch (e) {
    console.error('load error:', e);
  }
}

async function loadHistory() {
  const results = await Promise.all(
    METALS.map(m =>
      fetch(`/api/history/${m}?range=${currentRange}`)
        .then(r => r.json())
        .catch(() => ({ labels:[], data:[] }))
    )
  );
  METALS.forEach((m, i) => renderHistoryChart(m, results[i]));
}

// ─── Hero ───────────────────────────────────────────────────────────────
function renderHero(p) {
  const gl    = p.total_gain_loss    || 0;
  const glPct = p.total_gain_loss_pct || 0;
  const pos   = gl >= 0;

  document.getElementById('hero-value').textContent =
    balanceHidden ? HIDDEN_VAL : ('$' + Number(p.total_value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  const glEl = document.getElementById('hero-gl');
  const glStr = balanceHidden
    ? `${HIDDEN_VAL} (${fmtPct(glPct)})`
    : `${pos ? '+' : ''}${fmt(gl)} (${fmtPct(glPct)})`;
  glEl.textContent = glStr;
  glEl.className   = 'hero-gl ' + (pos ? 'positive' : 'negative');

  const costEl = document.getElementById('hero-cost');
  costEl.textContent = balanceHidden ? HIDDEN_VAL
    : '$' + Number(p.total_cost || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Allocation bars
  const alloc = document.getElementById('hero-allocation');
  alloc.innerHTML = '';
  const totalValue = p.total_value || 0;
  (p.by_metal || []).forEach(m => {
    const pct   = totalValue > 0 ? (m.market_value / totalValue * 100) : 0;
    const color = METAL_COLORS[m.metal];
    const ozStr = fmtOz(m.total_oz);
    alloc.innerHTML += `
      <div class="alloc-row">
        <div class="alloc-label" style="color:${color}">${METAL_LABELS[m.metal]}</div>
        <div class="alloc-bar-track">
          <div class="alloc-bar-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div>
        </div>
        <div class="alloc-oz">${ozStr}</div>
        <div class="alloc-pct">${pct.toFixed(0)}%</div>
        <div class="alloc-val blur-val">${fmt(m.market_value)}</div>
      </div>`;
  });
}

// ─── Spot Prices ────────────────────────────────────────────────────────
function renderSpotPrices(priceMap, metrics) {
  const el = document.getElementById('spot-prices');
  el.innerHTML = '';
  METALS.forEach(metal => {
    const price = priceMap[metal];
    if (price == null) return;
    const prev      = metrics?.[metal]?.previous_close;
    const change    = prev ? price - prev : null;
    const changePct = prev ? (change / prev * 100) : null;
    const pos       = change >= 0;
    const sign      = pos ? '+' : '';
    el.innerHTML += `
      <div class="card spot-card metal-${metal}">
        <div class="metal-name ${metal}-text">${METAL_LABELS[metal]}</div>
        <div class="price">${'$' + Number(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        <div class="price-sub">per troy oz</div>
        ${change != null ? `<div class="day-change ${pos ? 'positive' : 'negative'}">${sign}$${Math.abs(change).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} (${sign}${Math.abs(changePct).toFixed(2)}%)</div>` : ''}
      </div>`;
  });
}

// ─── Market Metrics ──────────────────────────────────────────────────────
function renderMetrics(metrics, priceMap) {
  const el = document.getElementById('metrics-row');
  el.innerHTML = '';

  const ratio = metrics.gold_silver_ratio;
  el.innerHTML += `
    <div class="card metric-card ratio-card" style="min-width:150px">
      <div class="metric-title">Gold / Silver Ratio</div>
      <div class="ratio-val">${ratio ? ratio.toFixed(1) : '—'}</div>
      <div class="ratio-sub">oz silver per oz gold</div>
    </div>`;

  METALS.forEach(metal => {
    const m     = metrics[metal] || {};
    const price = priceMap?.[metal];
    const high  = m.fifty_two_week_high;
    const low   = m.fifty_two_week_low;
    const pctFromHigh = high && price ? ((price - high) / high * 100) : null;
    el.innerHTML += `
      <div class="card metric-card" style="min-width:160px">
        <div class="metric-title" style="color:var(--${metal})">${METAL_LABELS[metal]} 52-Week</div>
        <div class="metric-main">${'$' + Number(price || 0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
        <div class="metric-row"><span>52W High</span><span>${high ? '$'+Number(high).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'}</span></div>
        <div class="metric-row"><span>52W Low</span><span>${low ? '$'+Number(low).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'}</span></div>
        ${pctFromHigh != null ? `<div class="metric-row"><span>From High</span><span class="${pctFromHigh >= 0 ? 'positive' : 'negative'}">${pctFromHigh >= 0 ? '+' : ''}${pctFromHigh.toFixed(1)}%</span></div>` : ''}
      </div>`;
  });
}

// ─── History Charts ─────────────────────────────────────────────────────
function setRange(btn, range) {
  currentRange = range;
  document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  Object.values(historyCharts).forEach(c => c?.destroy());
  historyCharts = {};
  loadHistory();
}

function renderHistoryChart(metal, { labels, data }) {
  const canvas = document.getElementById(`chart-${metal}`);
  if (!canvas) return;
  if (historyCharts[metal]) historyCharts[metal].destroy();

  const parent    = canvas.parentElement;
  const existMsg  = parent.querySelector('.no-data-msg');
  if (existMsg) existMsg.remove();

  if (!labels?.length) {
    canvas.style.display = 'none';
    const msg = document.createElement('div');
    msg.className = 'no-data-msg';
    msg.textContent = 'No price data available';
    parent.appendChild(msg);
    return;
  }
  canvas.style.display = '';

  const color = METAL_COLORS[metal];
  const cc    = chartTheme();
  historyCharts[metal] = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: color,
        backgroundColor: hexAlpha(color, 0.1),
        borderWidth: 2,
        pointRadius: labels.length > 60 ? 0 : 2,
        pointHoverRadius: 5,
        fill: true,
        tension: 0.35,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cc.tooltip,
          titleColor: cc.text,
          bodyColor: cc.text,
          borderColor: cc.border,
          borderWidth: 1,
          callbacks: { label: ctx => ' $' + ctx.raw.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) }
        }
      },
      scales: {
        x: { ticks:{ color:cc.muted, maxTicksLimit:7, maxRotation:0 }, grid:{ color:cc.grid } },
        y: { ticks:{ color:cc.muted, callback:v => '$'+v.toLocaleString() }, grid:{ color:cc.grid } }
      }
    }
  });
}

// ─── Alloc view toggle ───────────────────────────────────────────────────
function setAllocView(view) {
  allocView = view;
  localStorage.setItem('allocView', view);
  document.getElementById('alloc-bar-view').classList.toggle('hidden', view !== 'bar');
  document.getElementById('alloc-pie-view').classList.toggle('hidden', view !== 'pie');
  document.getElementById('alloc-bar-btn').classList.toggle('active', view === 'bar');
  document.getElementById('alloc-pie-btn').classList.toggle('active', view === 'pie');
  if (window._lastPortfolio) renderAllocationCharts(window._lastPortfolio);
}

// ─── Bar / Pie Charts ─────────────────────────────────────────────────────
function renderAllocationCharts(p) {
  if (!p?.by_metal) return;
  const cc     = chartTheme();
  const labels = p.by_metal.map(m => METAL_LABELS[m.metal]);
  const colors = p.by_metal.map(m => METAL_COLORS[m.metal]);

  if (allocView === 'bar') {
    if (allocationChart) allocationChart.destroy();
    const ac = document.getElementById('chart-allocation');
    if (ac && p.by_metal.length) {
      allocationChart = new Chart(ac, {
        type: 'bar',
        data: { labels, datasets:[{ data: p.by_metal.map(m => m.market_value), backgroundColor: colors, borderRadius:6, borderSkipped:false }] },
        options: barOpts(cc)
      });
    }

    if (costValueChart) costValueChart.destroy();
    const cv = document.getElementById('chart-costvsvalue');
    if (cv && p.by_metal.length) {
      costValueChart = new Chart(cv, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label:'Cost Basis',   data: p.by_metal.map(m => m.total_cost),    backgroundColor: colors.map(c => hexAlpha(c,0.35)), borderRadius:6, borderSkipped:false },
            { label:'Market Value', data: p.by_metal.map(m => m.market_value),  backgroundColor: colors, borderRadius:6, borderSkipped:false }
          ]
        },
        options: { ...barOpts(cc), plugins:{ ...barOpts(cc).plugins, legend:{ display:true, labels:{ color:cc.muted, boxWidth:10, padding:12, font:{ size:11 } } } } }
      });
    }
  } else {
    if (pieChart) pieChart.destroy();
    const pc = document.getElementById('chart-pie');
    if (pc && p.by_metal.length) {
      pieChart = new Chart(pc, {
        type: 'doughnut',
        data: { labels, datasets:[{ data: p.by_metal.map(m => m.market_value), backgroundColor: colors, borderWidth: 2, borderColor: cc.tooltip }] },
        options: pieOpts(cc)
      });
    }

    if (pieCostChart) pieCostChart.destroy();
    const pcc = document.getElementById('chart-pie-cost');
    if (pcc && p.by_metal.length) {
      const costData  = p.by_metal.map(m => m.total_cost);
      const valueData = p.by_metal.map(m => m.market_value);
      pieCostChart = new Chart(pcc, {
        type: 'doughnut',
        data: {
          labels: ['Cost Basis', 'Unrealized Gain'],
          datasets:[{
            data: [p.total_cost, Math.max(0, p.total_value - p.total_cost)],
            backgroundColor: ['rgba(90,98,130,0.7)', '#4caf82'],
            borderWidth: 2,
            borderColor: cc.tooltip
          }]
        },
        options: pieOpts(cc)
      });
    }
  }
}

function pieOpts(cc) {
  return {
    responsive: true,
    plugins: {
      legend: { display:true, position:'bottom', labels:{ color:cc.muted, boxWidth:12, padding:14, font:{ size:11 } } },
      tooltip: {
        backgroundColor: cc.tooltip,
        titleColor: cc.text,
        bodyColor: cc.text,
        borderColor: cc.border,
        borderWidth: 1,
        callbacks: { label: ctx => ' $' + ctx.raw.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) }
      }
    }
  };
}

function barOpts(cc) {
  return {
    responsive: true,
    plugins: {
      legend: { display:false },
      tooltip: {
        backgroundColor: cc.tooltip,
        titleColor: cc.text,
        bodyColor: cc.text,
        borderColor: cc.border,
        borderWidth: 1,
        callbacks: { label: ctx => ' $' + ctx.raw.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) }
      }
    },
    scales: {
      x: { ticks:{ color:cc.muted }, grid:{ color:cc.grid } },
      y: { ticks:{ color:cc.muted, callback:v => '$'+v.toLocaleString() }, grid:{ color:cc.grid } }
    }
  };
}

function chartTheme() {
  const light = document.documentElement.getAttribute('data-theme') === 'light';
  return {
    grid:    light ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)',
    muted:   '#5a6282',
    tooltip: light ? '#ffffff' : '#111520',
    text:    light ? '#0f1120' : '#e2e6f3',
    border:  light ? '#e1e4ef' : '#252b42',
  };
}

function redrawCharts() {
  Object.values(historyCharts).forEach(c => c?.destroy());
  historyCharts = {};
  if (allocationChart) { allocationChart.destroy(); allocationChart = null; }
  if (costValueChart)  { costValueChart.destroy();  costValueChart  = null; }
  if (pieChart)        { pieChart.destroy();        pieChart        = null; }
  if (pieCostChart)    { pieCostChart.destroy();    pieCostChart    = null; }
  loadHistory();
  renderAllocationCharts(window._lastPortfolio);
}

// ─── Price History collapse ──────────────────────────────────────────────
function initHistorySection() {
  applyHistoryCollapse();
}
function toggleHistorySection() {
  historyCollapsed = !historyCollapsed;
  localStorage.setItem('historyCollapsed', historyCollapsed);
  applyHistoryCollapse();
}
function applyHistoryCollapse() {
  const grid = document.getElementById('history-grid');
  const icon = document.getElementById('history-toggle-icon');
  const tabs = document.getElementById('range-tabs');
  if (historyCollapsed) {
    grid.style.display = 'none';
    tabs.style.display = 'none';
    icon.textContent = '▸';
  } else {
    grid.style.display = '';
    tabs.style.display = '';
    icon.textContent = '▾';
  }
}

// ─── By-Metal Cards ──────────────────────────────────────────────────────
function renderByMetal(byMetal) {
  const el = document.getElementById('by-metal');
  el.innerHTML = '';
  if (!byMetal?.length) { el.innerHTML = '<p class="muted">No holdings yet.</p>'; return; }
  byMetal.forEach(m => {
    const pos  = m.gain_loss >= 0;
    const sign = pos ? '+' : '';
    el.innerHTML += `
      <div class="card metal-card">
        <div class="metal-card-header">
          <div class="metal-dot dot-${m.metal}"></div>
          <strong>${METAL_LABELS[m.metal]}</strong>
          <span class="count">${m.holdings_count} holding${m.holdings_count !== 1 ? 's' : ''}</span>
        </div>
        <div class="stat"><span class="k">Total Weight</span><span class="v">${fmtOz(m.total_oz)}</span></div>
        <div class="stat"><span class="k">Spot Price</span><span class="v">${'$'+Number(m.price_per_oz||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}/oz</span></div>
        <div class="stat"><span class="k">Cost Basis</span><span class="v blur-val">${fmt(m.total_cost)}</span></div>
        <div class="stat"><span class="k">Market Value</span><span class="v blur-val">${fmt(m.market_value)}</span></div>
        <div class="stat"><span class="k">Gain / Loss</span><span class="v ${pos ? 'positive' : 'negative'} blur-val">${sign}${fmt(m.gain_loss)} (${sign}${m.gain_loss_pct.toFixed(2)}%)</span></div>
      </div>`;
  });
}

// ─── Holdings Groups ─────────────────────────────────────────────────────
function toOz(qty, unit) {
  if (unit === 'oz') return qty;
  if (unit === 'g')  return qty / 31.1035;
  if (unit === 'kg') return qty * 1000 / 31.1035;
  return qty;
}

// sortable column definitions: [display label, sort key, sortable?]
const SORT_COLS = [
  ['Description', 'description', true],
  ['Qty',         'quantity',    true],
  ['Unit',        null,          false],
  ['Troy oz',     'oz',          true],
  ['Cost Basis',  'cost',        true],
  ['Mkt Value',   'mv',          true],
  ['Gain / Loss', 'gl',          true],
  ['Date',        'date',        true],
  ['Notes',       null,          false],
  ['',            null,          false],
];

function sortedRows(rows, metal, priceMap) {
  const { col, dir } = groupSort[metal];
  if (!col) return rows;
  const price = priceMap[metal] || 0;
  return [...rows].sort((a, b) => {
    let av, bv;
    if (col === 'description') { av = a.description.toLowerCase(); bv = b.description.toLowerCase(); }
    else if (col === 'quantity')  { av = a.quantity; bv = b.quantity; }
    else if (col === 'oz')        { av = toOz(a.quantity, a.unit); bv = toOz(b.quantity, b.unit); }
    else if (col === 'cost')      { av = a.cost_basis; bv = b.cost_basis; }
    else if (col === 'mv')        { av = toOz(a.quantity, a.unit) * price; bv = toOz(b.quantity, b.unit) * price; }
    else if (col === 'gl')        { av = toOz(a.quantity, a.unit) * price - a.cost_basis; bv = toOz(b.quantity, b.unit) * price - b.cost_basis; }
    else if (col === 'date')      { av = a.purchase_date || ''; bv = b.purchase_date || ''; }
    else return 0;
    if (av < bv) return -1 * dir;
    if (av > bv) return  1 * dir;
    return 0;
  });
}

function thHtml(metal) {
  const { col: activeCol, dir } = groupSort[metal];
  return SORT_COLS.map(([label, key, sortable]) => {
    if (!sortable) return `<th>${label}</th>`;
    const isActive = activeCol === key;
    const arrow    = isActive ? (dir === 1 ? ' ↑' : ' ↓') : '';
    return `<th class="th-sort${isActive ? ' th-sort-active' : ''}" data-sort-col="${key}" data-sort-metal="${metal}">${label}${arrow}</th>`;
  }).join('');
}

function renderHoldings(list, priceMap) {
  const container = document.getElementById('holdings-groups');
  container.innerHTML = '';
  if (!list.length) {
    container.innerHTML = '<div class="card" style="text-align:center;padding:28px;color:var(--muted)">No holdings yet. Click <strong>+ Add Holding</strong> to get started.</div>';
    return;
  }
  const groups = {};
  METALS.forEach(m => groups[m] = []);
  list.forEach(h => { if (groups[h.metal]) groups[h.metal].push(h); });

  METALS.forEach(metal => {
    const rows = groups[metal];
    if (!rows.length) return;
    const collapsed = groupCollapsed[metal];
    const totalOz   = rows.reduce((s, h) => s + toOz(h.quantity, h.unit), 0);
    const totalMV   = rows.reduce((s, h) => s + toOz(h.quantity, h.unit) * (priceMap[metal] || 0), 0);
    const totalCost = rows.reduce((s, h) => s + h.cost_basis, 0);
    const totalGL   = totalMV - totalCost;
    const pos       = totalGL >= 0;

    const displayRows = sortedRows(rows, metal, priceMap);
    const rowsHtml = displayRows.map(h => {
      const oz    = toOz(h.quantity, h.unit);
      const price = priceMap[metal] || 0;
      const mv    = oz * price;
      const gl    = mv - h.cost_basis;
      const glPct = h.cost_basis > 0 ? (gl / h.cost_basis * 100) : 0;
      const hPos  = gl >= 0;
      return `<tr>
        <td>${esc(h.description)}</td>
        <td>${Number(h.quantity).toLocaleString('en-US',{ maximumFractionDigits:6 })}</td>
        <td>${h.unit}</td>
        <td>${fmtOz(oz)}</td>
        <td class="blur-val">${fmt(h.cost_basis)}</td>
        <td class="blur-val">${price ? fmt(mv) : '—'}</td>
        <td class="${hPos ? 'positive' : 'negative'} blur-val">${price ? (hPos?'+':'') + fmt(gl) + ' (' + (hPos?'+':'') + glPct.toFixed(1) + '%)' : '—'}</td>
        <td class="muted">${h.purchase_date || '—'}</td>
        <td class="muted">${esc(h.notes || '')}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-edit btn-sm" data-action="edit" data-id="${h.id}">Edit</button>
          <button class="btn btn-danger btn-sm" data-action="delete" data-id="${h.id}">Del</button>
        </td>
      </tr>`;
    }).join('');

    container.innerHTML += `
      <div class="group-block">
        <div class="group-header" onclick="toggleGroup('${metal}')">
          <div class="group-header-left">
            <div class="metal-dot dot-${metal}"></div>
            <strong>${METAL_LABELS[metal]}</strong>
            <span class="group-header-meta">${rows.length} holding${rows.length!==1?'s':''} · ${fmtOz(totalOz)}</span>
          </div>
          <div class="group-header-right">
            <span class="blur-val ${pos ? 'positive' : 'negative'}">${pos?'+':''}${fmt(totalGL)}</span>
            <span class="group-chevron ${collapsed ? 'collapsed' : ''}">▾</span>
          </div>
        </div>
        <div class="group-body ${collapsed ? 'hidden' : ''}">
          <div class="table-wrap">
            <table>
              <thead><tr>${thHtml(metal)}</tr></thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
        </div>
      </div>`;
  });
}

function toggleGroup(metal) {
  groupCollapsed[metal] = !groupCollapsed[metal];
  renderHoldings(holdings, prices);
}
function toggleAllGroups(expand) {
  METALS.forEach(m => groupCollapsed[m] = !expand);
  renderHoldings(holdings, prices);
}

// ─── Modal ────────────────────────────────────────────────────────────────
document.addEventListener('click', e => {
  // Edit / delete buttons
  const btn = e.target.closest('[data-action]');
  if (btn) {
    const id = Number(btn.dataset.id);
    if (btn.dataset.action === 'edit')   openEditModal(id);
    if (btn.dataset.action === 'delete') deleteHolding(id);
    return;
  }
  // Sortable column headers
  const th = e.target.closest('[data-sort-col]');
  if (th) {
    const col   = th.dataset.sortCol;
    const metal = th.dataset.sortMetal;
    if (groupSort[metal].col === col) {
      groupSort[metal].dir *= -1;
    } else {
      groupSort[metal].col = col;
      groupSort[metal].dir = 1;
    }
    renderHoldings(holdings, prices);
  }
});

function setQty(val) { document.getElementById('f-quantity').value = val; }

function openAddModal() {
  document.getElementById('modal-title').textContent = 'Add Holding';
  document.getElementById('holding-id').value = '';
  document.getElementById('holding-form').reset();
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function openEditModal(id) {
  const h = holdings.find(x => Number(x.id) === Number(id));
  if (!h) { console.warn('Holding not found:', id); return; }
  document.getElementById('modal-title').textContent = 'Edit Holding';
  document.getElementById('holding-id').value   = h.id;
  document.getElementById('f-metal').value       = h.metal;
  document.getElementById('f-description').value = h.description;
  document.getElementById('f-quantity').value    = h.quantity;
  document.getElementById('f-unit').value        = h.unit;
  document.getElementById('f-cost').value        = h.cost_basis;
  document.getElementById('f-date').value        = h.purchase_date || '';
  document.getElementById('f-notes').value       = h.notes || '';
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal(e) {
  if (e && e.target !== document.getElementById('modal-overlay')) return;
  document.getElementById('modal-overlay').classList.add('hidden');
}

async function submitHolding(e) {
  e.preventDefault();
  const id   = document.getElementById('holding-id').value;
  const body = {
    metal:         document.getElementById('f-metal').value,
    description:   document.getElementById('f-description').value,
    unit:          document.getElementById('f-unit').value,
    quantity:      parseFloat(document.getElementById('f-quantity').value),
    cost_basis:    parseFloat(document.getElementById('f-cost').value),
    purchase_date: document.getElementById('f-date').value  || null,
    notes:         document.getElementById('f-notes').value || null,
  };
  await fetch(id ? `/api/holdings/${id}` : '/api/holdings', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  document.getElementById('modal-overlay').classList.add('hidden');
  load();
}

async function deleteHolding(id) {
  if (!confirm('Delete this holding?')) return;
  await fetch(`/api/holdings/${Number(id)}`, { method:'DELETE' });
  load();
}

// ─── Utility ──────────────────────────────────────────────────────────────
function hexAlpha(hex, a) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

// ─── Refresh prices ───────────────────────────────────────────────────────
async function refreshPrices() {
  const btn  = document.getElementById('refresh-btn');
  const icon = document.getElementById('refresh-icon');
  btn.disabled = true;
  icon.style.animation = 'spin 0.8s linear infinite';
  try {
    await fetch('/api/prices/refresh', { method: 'POST' });
    await load();
  } finally {
    btn.disabled = false;
    icon.style.animation = '';
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────
initTheme();
initVisibility();
initHistorySection();
// Apply persisted alloc view without re-saving
(function() {
  document.getElementById('alloc-bar-view').classList.toggle('hidden', allocView !== 'bar');
  document.getElementById('alloc-pie-view').classList.toggle('hidden', allocView !== 'pie');
  document.getElementById('alloc-bar-btn').classList.toggle('active', allocView === 'bar');
  document.getElementById('alloc-pie-btn').classList.toggle('active', allocView === 'pie');
})();
load();
loadHistory();
setInterval(load, 5 * 60 * 1000);

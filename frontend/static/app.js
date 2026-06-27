// ---- Formatting helpers ----
const fmt = n => n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtOz = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 4 }) + ' oz';
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const METAL_LABELS = { gold: 'Gold', silver: 'Silver', platinum: 'Platinum', palladium: 'Palladium' };
const METAL_COLORS = { gold: '#f5c842', silver: '#b0bec5', platinum: '#90caf9', palladium: '#ce93d8' };
const METALS = ['gold', 'silver', 'platinum', 'palladium'];

let prices = {};
let holdings = [];
let currentRange = '1M';
let historyCharts = {};
let allocationChart = null;
let costValueChart = null;
// track which metal groups are collapsed; default all expanded
let groupCollapsed = { gold: false, silver: false, platinum: false, palladium: false };

// ---- Theme ----
function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  applyTheme(saved);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('theme-icon').textContent = theme === 'dark' ? '☀️' : '🌙';
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('theme', next);
  // Redraw charts to match new theme colors
  Object.values(historyCharts).forEach(c => c && c.destroy());
  historyCharts = {};
  if (allocationChart) { allocationChart.destroy(); allocationChart = null; }
  if (costValueChart) { costValueChart.destroy(); costValueChart = null; }
  loadHistory();
  renderAllocationCharts(window._lastPortfolio);
}

function chartColors() {
  const light = document.documentElement.getAttribute('data-theme') === 'light';
  return {
    grid: light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)',
    tick: '#6b7280',
    tooltip: light ? '#ffffff' : '#1a1d27',
    tooltipText: light ? '#111827' : '#e8eaf0',
  };
}

// ---- Data loading ----
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
    renderSummary(portfolio);
    renderSpotPrices(portfolio.prices, metrics);
    renderMetrics(metrics, portfolio.prices);
    renderByMetal(portfolio.by_metal);
    renderHoldings(holdingsData, portfolio.prices);
    renderAllocationCharts(portfolio);
    document.getElementById('last-updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
  } catch (e) {
    console.error('load error:', e);
  }
}

async function loadHistory() {
  const results = await Promise.all(
    METALS.map(m =>
      fetch(`/api/history/${m}?range=${currentRange}`)
        .then(r => r.json())
        .catch(() => ({ labels: [], data: [] }))
    )
  );
  METALS.forEach((metal, i) => renderHistoryChart(metal, results[i]));
}

// ---- Summary ----
function renderSummary(p) {
  document.getElementById('total-cost').textContent = fmt(p.total_cost);
  document.getElementById('total-value').textContent = fmt(p.total_value);
  const gl = p.total_gain_loss;
  const pct = p.total_gain_loss_pct;
  const glEl = document.getElementById('total-gl');
  glEl.textContent = (gl >= 0 ? '+' : '') + fmt(gl);
  glEl.className = 'value ' + (gl >= 0 ? 'positive' : 'negative');
  document.getElementById('total-gl-pct').textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
}

// ---- Spot prices ----
function renderSpotPrices(priceMap, metrics) {
  const el = document.getElementById('spot-prices');
  el.innerHTML = '';
  METALS.forEach(metal => {
    const price = priceMap[metal];
    if (price == null) return;
    const prev = metrics?.[metal]?.previous_close;
    const change = prev ? price - prev : null;
    const changePct = prev ? (change / prev * 100) : null;
    const sign = change >= 0 ? '+' : '';
    const cls = change >= 0 ? 'positive' : 'negative';
    el.innerHTML += `
      <div class="card spot-card">
        <div class="metal-name" style="color:var(--${metal})">${METAL_LABELS[metal]}</div>
        <div class="price">${fmt(price)}</div>
        <div class="price-sub">per troy oz</div>
        ${change != null ? `<div class="day-change ${cls}">${sign}${fmt(change)} (${sign}${changePct.toFixed(2)}%)</div>` : ''}
      </div>`;
  });
}

// ---- Market Metrics ----
function renderMetrics(metrics, priceMap) {
  const el = document.getElementById('metrics-row');
  el.innerHTML = '';

  const ratio = metrics.gold_silver_ratio;
  el.innerHTML += `
    <div class="card metric-card ratio-card" style="min-width:160px">
      <div class="metric-title">Gold / Silver Ratio</div>
      <div class="ratio-val">${ratio ? ratio.toFixed(1) : '—'}</div>
      <div class="ratio-sub">oz of silver to buy 1 oz of gold</div>
    </div>`;

  METALS.forEach(metal => {
    const m = metrics[metal] || {};
    const price = priceMap?.[metal];
    const high = m.fifty_two_week_high;
    const low = m.fifty_two_week_low;
    const pctFromHigh = high && price ? ((price - high) / high * 100) : null;
    el.innerHTML += `
      <div class="card metric-card" style="min-width:180px">
        <div class="metric-title" style="color:var(--${metal})">${METAL_LABELS[metal]} 52-Week</div>
        <div class="metric-main">${fmt(price)}</div>
        <div class="metric-row"><span class="k">52W High</span><span>${fmt(high)}</span></div>
        <div class="metric-row"><span class="k">52W Low</span><span>${fmt(low)}</span></div>
        ${pctFromHigh != null ? `<div class="metric-row"><span class="k">From High</span><span class="${pctFromHigh >= 0 ? 'positive' : 'negative'}">${pctFromHigh >= 0 ? '+' : ''}${pctFromHigh.toFixed(1)}%</span></div>` : ''}
      </div>`;
  });
}

// ---- History Charts ----
function setRange(range) {
  currentRange = range;
  document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  Object.values(historyCharts).forEach(c => c && c.destroy());
  historyCharts = {};
  loadHistory();
}

function renderHistoryChart(metal, { labels, data }) {
  const canvas = document.getElementById(`chart-${metal}`);
  if (!canvas) return;
  if (historyCharts[metal]) historyCharts[metal].destroy();

  const parent = canvas.parentElement;
  const existingMsg = parent.querySelector('.no-data-msg');
  if (existingMsg) existingMsg.remove();

  if (!labels || !labels.length) {
    canvas.style.display = 'none';
    const msg = document.createElement('div');
    msg.className = 'no-data-msg muted';
    msg.textContent = 'No price data available';
    parent.appendChild(msg);
    return;
  }

  canvas.style.display = '';
  const color = METAL_COLORS[metal];
  const cc = chartColors();

  historyCharts[metal] = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: color,
        backgroundColor: hexToRgba(color, 0.12),
        borderWidth: 2,
        pointRadius: labels.length > 60 ? 0 : 2,
        pointHoverRadius: 4,
        fill: true,
        tension: 0.3,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cc.tooltip,
          titleColor: cc.tooltipText,
          bodyColor: cc.tooltipText,
          callbacks: { label: ctx => fmt(ctx.raw) }
        }
      },
      scales: {
        x: {
          ticks: { color: cc.tick, maxTicksLimit: 8, maxRotation: 0 },
          grid: { color: cc.grid }
        },
        y: {
          ticks: { color: cc.tick, callback: v => '$' + v.toLocaleString() },
          grid: { color: cc.grid }
        }
      }
    }
  });
}

// ---- Allocation Bar Charts ----
function renderAllocationCharts(p) {
  if (!p) return;
  const cc = chartColors();
  const metals = (p.by_metal || []).map(m => METAL_LABELS[m.metal]);
  const colors = (p.by_metal || []).map(m => METAL_COLORS[m.metal]);

  if (allocationChart) allocationChart.destroy();
  const ac = document.getElementById('chart-allocation');
  if (ac && p.by_metal?.length) {
    allocationChart = new Chart(ac, {
      type: 'bar',
      data: {
        labels: metals,
        datasets: [{ label: 'Market Value', data: p.by_metal.map(m => m.market_value), backgroundColor: colors, borderRadius: 6 }]
      },
      options: barOptions(cc)
    });
  }

  if (costValueChart) costValueChart.destroy();
  const cv = document.getElementById('chart-costvsvalue');
  if (cv && p.by_metal?.length) {
    costValueChart = new Chart(cv, {
      type: 'bar',
      data: {
        labels: metals,
        datasets: [
          { label: 'Cost Basis', data: p.by_metal.map(m => m.total_cost), backgroundColor: colors.map(c => hexToRgba(c, 0.4)), borderRadius: 6 },
          { label: 'Market Value', data: p.by_metal.map(m => m.market_value), backgroundColor: colors, borderRadius: 6 }
        ]
      },
      options: { ...barOptions(cc), plugins: { ...barOptions(cc).plugins, legend: { display: true, labels: { color: cc.tick, boxWidth: 12, padding: 12 } } } }
    });
  }
}

function barOptions(cc) {
  return {
    responsive: true,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: cc.tooltip,
        titleColor: cc.tooltipText,
        bodyColor: cc.tooltipText,
        callbacks: { label: ctx => ' ' + fmt(ctx.raw) }
      }
    },
    scales: {
      x: { ticks: { color: cc.tick }, grid: { color: cc.grid } },
      y: { ticks: { color: cc.tick, callback: v => '$' + v.toLocaleString() }, grid: { color: cc.grid } }
    }
  };
}

// ---- By Metal Breakdown ----
function renderByMetal(byMetal) {
  const el = document.getElementById('by-metal');
  el.innerHTML = '';
  if (!byMetal?.length) {
    el.innerHTML = '<p class="muted">No holdings yet.</p>';
    return;
  }
  byMetal.forEach(m => {
    const sign = m.gain_loss >= 0 ? '+' : '';
    el.innerHTML += `
      <div class="card metal-card">
        <div class="metal-header">
          <div class="metal-dot dot-${m.metal}"></div>
          <strong>${METAL_LABELS[m.metal]}</strong>
          <span class="muted" style="margin-left:auto;font-size:0.75rem">${m.holdings_count} holding${m.holdings_count !== 1 ? 's' : ''}</span>
        </div>
        <div class="stat"><span class="k">Total</span><span>${fmtOz(m.total_oz)}</span></div>
        <div class="stat"><span class="k">Spot</span><span>${fmt(m.price_per_oz)}/oz</span></div>
        <div class="stat"><span class="k">Cost Basis</span><span>${fmt(m.total_cost)}</span></div>
        <div class="stat"><span class="k">Market Value</span><span>${fmt(m.market_value)}</span></div>
        <div class="stat"><span class="k">Gain / Loss</span>
          <span class="${m.gain_loss >= 0 ? 'positive' : 'negative'}">${sign}${fmt(m.gain_loss)} (${sign}${m.gain_loss_pct.toFixed(2)}%)</span>
        </div>
      </div>`;
  });
}

// ---- Holdings Table (grouped by metal, collapsible) ----
function toOz(qty, unit) {
  if (unit === 'oz') return qty;
  if (unit === 'g') return qty / 31.1035;
  if (unit === 'kg') return qty * 1000 / 31.1035;
  return qty;
}

function renderHoldings(list, priceMap) {
  const container = document.getElementById('holdings-groups');
  container.innerHTML = '';

  if (!list.length) {
    container.innerHTML = '<div class="card" style="text-align:center;padding:24px;color:var(--muted)">No holdings yet. Click "+ Add Holding" to get started.</div>';
    return;
  }

  // Group by metal
  const groups = {};
  METALS.forEach(m => groups[m] = []);
  list.forEach(h => { if (groups[h.metal]) groups[h.metal].push(h); });

  METALS.forEach(metal => {
    const rows = groups[metal];
    if (!rows.length) return;

    const collapsed = groupCollapsed[metal];
    const totalOz = rows.reduce((s, h) => s + toOz(h.quantity, h.unit), 0);
    const totalMV = rows.reduce((s, h) => s + toOz(h.quantity, h.unit) * (priceMap[metal] || 0), 0);
    const totalCost = rows.reduce((s, h) => s + h.cost_basis, 0);
    const totalGL = totalMV - totalCost;
    const glSign = totalGL >= 0 ? '+' : '';
    const glCls = totalGL >= 0 ? 'positive' : 'negative';

    const rowsHtml = rows.map(h => {
      const oz = toOz(h.quantity, h.unit);
      const price = priceMap[metal] || 0;
      const mv = oz * price;
      const gl = mv - h.cost_basis;
      const glPct = h.cost_basis > 0 ? (gl / h.cost_basis * 100) : 0;
      const sign = gl >= 0 ? '+' : '';
      return `<tr>
        <td>${esc(h.description)}</td>
        <td>${Number(h.quantity).toLocaleString('en-US', { maximumFractionDigits: 6 })}</td>
        <td>${h.unit}</td>
        <td>${fmtOz(oz)}</td>
        <td>${fmt(h.cost_basis)}</td>
        <td>${price ? fmt(mv) : '—'}</td>
        <td class="${gl >= 0 ? 'positive' : 'negative'}">${price ? sign + fmt(gl) + ' (' + sign + glPct.toFixed(1) + '%)' : '—'}</td>
        <td>${h.purchase_date || '—'}</td>
        <td class="muted">${esc(h.notes || '')}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-edit" onclick="openEditModal(${h.id})">Edit</button>
          <button class="btn btn-danger" onclick="deleteHolding(${h.id})">Del</button>
        </td>
      </tr>`;
    }).join('');

    container.innerHTML += `
      <div class="group-block" style="margin-bottom:10px">
        <div class="group-header" onclick="toggleGroup('${metal}')">
          <div style="display:flex;align-items:center;gap:10px">
            <div class="metal-dot dot-${metal}"></div>
            <strong>${METAL_LABELS[metal]}</strong>
            <span class="muted" style="font-size:0.8rem">${rows.length} holding${rows.length !== 1 ? 's' : ''} · ${fmtOz(totalOz)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:16px">
            <span class="${glCls}" style="font-size:0.85rem">${glSign}${fmt(totalGL)}</span>
            <span class="group-chevron ${collapsed ? 'collapsed' : ''}">▾</span>
          </div>
        </div>
        <div class="group-body ${collapsed ? 'hidden' : ''}">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Oz (troy)</th>
                  <th>Cost Basis</th>
                  <th>Market Value</th>
                  <th>Gain / Loss</th>
                  <th>Purchase Date</th>
                  <th>Notes</th>
                  <th></th>
                </tr>
              </thead>
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

// ---- Modal ----
function setQty(val) {
  document.getElementById('f-quantity').value = val;
}

function openAddModal() {
  document.getElementById('modal-title').textContent = 'Add Holding';
  document.getElementById('holding-id').value = '';
  document.getElementById('holding-form').reset();
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function openEditModal(id) {
  const h = holdings.find(x => x.id === id);
  if (!h) return;
  document.getElementById('modal-title').textContent = 'Edit Holding';
  document.getElementById('holding-id').value = h.id;
  document.getElementById('f-metal').value = h.metal;
  document.getElementById('f-description').value = h.description;
  document.getElementById('f-quantity').value = h.quantity;
  document.getElementById('f-unit').value = h.unit;
  document.getElementById('f-cost').value = h.cost_basis;
  document.getElementById('f-date').value = h.purchase_date || '';
  document.getElementById('f-notes').value = h.notes || '';
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal(e) {
  if (e && e.target !== document.getElementById('modal-overlay')) return;
  document.getElementById('modal-overlay').classList.add('hidden');
}

async function submitHolding(e) {
  e.preventDefault();
  const id = document.getElementById('holding-id').value;
  const body = {
    metal: document.getElementById('f-metal').value,
    description: document.getElementById('f-description').value,
    unit: document.getElementById('f-unit').value,
    quantity: parseFloat(document.getElementById('f-quantity').value),
    cost_basis: parseFloat(document.getElementById('f-cost').value),
    purchase_date: document.getElementById('f-date').value || null,
    notes: document.getElementById('f-notes').value || null,
  };
  const url = id ? `/api/holdings/${id}` : '/api/holdings';
  const method = id ? 'PUT' : 'POST';
  await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  document.getElementById('modal-overlay').classList.add('hidden');
  load();
}

async function deleteHolding(id) {
  if (!confirm('Delete this holding?')) return;
  await fetch(`/api/holdings/${id}`, { method: 'DELETE' });
  load();
}

// ---- Utility ----
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ---- Init ----
initTheme();
load();
loadHistory();
setInterval(load, 5 * 60 * 1000);

const fmt = (n) => n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtOz = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 4 }) + ' oz';
const fmtQty = (n, unit) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 }) + ' ' + unit;

let prices = {};
let holdings = [];

async function load() {
  try {
    const [portfolio, holdingsData] = await Promise.all([
      fetch('/api/portfolio').then(r => r.json()),
      fetch('/api/holdings').then(r => r.json()),
    ]);
    prices = portfolio.prices || {};
    holdings = holdingsData;
    renderSummary(portfolio);
    renderSpotPrices(portfolio.prices);
    renderByMetal(portfolio.by_metal);
    renderHoldings(holdingsData, portfolio.prices);
    document.getElementById('last-updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
  } catch (e) {
    console.error(e);
  }
}

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

const METAL_COLORS = { gold: 'gold', silver: 'silver', platinum: 'platinum', palladium: 'palladium' };
const METAL_LABELS = { gold: 'Gold', silver: 'Silver', platinum: 'Platinum', palladium: 'Palladium' };

function renderSpotPrices(priceMap) {
  const el = document.getElementById('spot-prices');
  el.innerHTML = '';
  const order = ['gold', 'silver', 'platinum', 'palladium'];
  order.forEach(metal => {
    const price = priceMap[metal];
    if (price == null) return;
    el.innerHTML += `
      <div class="card spot-card">
        <div class="metal-name" style="color:var(--${metal})">${METAL_LABELS[metal]}</div>
        <div class="price">${fmt(price)}</div>
        <div class="price-sub">per troy oz</div>
      </div>`;
  });
}

function renderByMetal(byMetal) {
  const el = document.getElementById('by-metal');
  el.innerHTML = '';
  if (!byMetal || byMetal.length === 0) {
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

function toOz(qty, unit) {
  if (unit === 'oz') return qty;
  if (unit === 'g') return qty / 31.1035;
  if (unit === 'kg') return qty * 1000 / 31.1035;
  return qty;
}

function renderHoldings(list, priceMap) {
  const tbody = document.getElementById('holdings-body');
  tbody.innerHTML = '';
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="11" class="muted" style="text-align:center;padding:24px">No holdings yet. Click "+ Add Holding" to get started.</td></tr>';
    return;
  }
  list.forEach(h => {
    const oz = toOz(h.quantity, h.unit);
    const price = priceMap[h.metal] || 0;
    const mv = oz * price;
    const gl = mv - h.cost_basis;
    const glPct = h.cost_basis > 0 ? (gl / h.cost_basis * 100) : 0;
    const sign = gl >= 0 ? '+' : '';
    tbody.innerHTML += `
      <tr>
        <td><span class="metal-badge badge-${h.metal}">${h.metal}</span></td>
        <td>${esc(h.description)}</td>
        <td>${fmtQty(h.quantity, '')}</td>
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
  });
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Modal
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

// Auto-refresh every 5 minutes
load();
setInterval(load, 5 * 60 * 1000);

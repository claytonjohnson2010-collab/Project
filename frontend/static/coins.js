// ─── Coin Collection Module ───────────────────────────────────────────────────

let allCoins = [];
let filteredCoins = [];
let coinStats = null;
let coinSort = { col: 'gregorian_year', dir: 1 };

let gradeChart = null;
let decadeChart = null;

// ─── Tab switching ────────────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.getElementById('metals-panel').classList.toggle('hidden', tab !== 'metals');
  document.getElementById('coins-panel').classList.toggle('hidden', tab !== 'coins');

  if (tab === 'coins' && allCoins.length === 0) {
    loadCoinData();
  }
}

// ─── Data loading ─────────────────────────────────────────────────────────────
async function loadCoinData() {
  try {
    const [stats, coins, dups, gaps] = await Promise.all([
      fetch('/api/coins/stats').then(r => r.json()),
      fetch('/api/coins').then(r => r.json()),
      fetch('/api/coins/duplicates').then(r => r.json()),
      fetch('/api/coins/gaps').then(r => r.json()),
    ]);
    coinStats = stats;
    allCoins  = coins;
    filteredCoins = coins;

    populateFilterDropdowns(coins, stats);
    renderCoinHero(stats);
    renderCoinStatCards(stats);
    renderCoinCharts(stats);
    renderCoinsByCountry(stats.by_issuer || []);
    renderCoinsTable(filteredCoins);
    renderDuplicates(dups);
    renderGaps(gaps);
  } catch (e) {
    console.error('Coin data load error:', e);
  }
}

// ─── Hero ─────────────────────────────────────────────────────────────────────
function renderCoinHero(stats) {
  document.getElementById('coins-hero-count').textContent =
    (stats.total_coins || 0) + ' Coins';
  document.getElementById('coins-hero-sub').textContent =
    (stats.by_issuer?.length || 0) + ' Countries · ' +
    (stats.for_exchange_count || 0) + ' available for exchange';
  document.getElementById('coins-hero-est').textContent =
    stats.total_estimate ? fmtUSD(stats.total_estimate) : '—';

  const alloc = document.getElementById('coins-hero-allocation');
  alloc.innerHTML = '';
  const total = stats.total_coins || 1;
  const top5  = (stats.by_issuer || []).slice(0, 6);
  top5.forEach((item, i) => {
    const pct   = (item.count / total * 100).toFixed(1);
    const color = countryColor(i);
    alloc.innerHTML += `
      <div class="alloc-row">
        <div class="alloc-label" style="color:${color};font-size:0.7rem;width:120px">${escC(item.issuer)}</div>
        <div class="alloc-bar-track">
          <div class="alloc-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <div class="alloc-pct">${pct}%</div>
        <div class="alloc-val">${item.count} coins</div>
      </div>`;
  });
}

// ─── Stat Cards ───────────────────────────────────────────────────────────────
function renderCoinStatCards(stats) {
  const el = document.getElementById('coin-stat-cards');
  const cards = [
    { label: 'Total Coins',     value: stats.total_coins || 0,          sub: 'in collection' },
    { label: 'Estimated Value', value: fmtUSD(stats.total_estimate||0), sub: 'catalog value' },
    { label: 'For Exchange',    value: stats.for_exchange_count || 0,    sub: 'coins available' },
    { label: 'Duplicates',      value: stats.duplicates_count || 0,      sub: 'groups flagged', warn: stats.duplicates_count > 0 },
  ];
  el.innerHTML = cards.map(c => `
    <div class="card" style="min-width:160px">
      <div class="metric-title">${escC(c.label)}</div>
      <div class="metric-main" style="${c.warn ? 'color:var(--red)' : ''}">${escC(String(c.value))}</div>
      <div class="ratio-sub">${escC(c.sub)}</div>
    </div>`).join('');
}

// ─── Charts ───────────────────────────────────────────────────────────────────
function renderCoinCharts(stats) {
  const cc = chartTheme();

  if (gradeChart) gradeChart.destroy();
  const gc = document.getElementById('chart-grades');
  if (gc && stats.grade_distribution?.length) {
    const labels = stats.grade_distribution.map(g => g.grade);
    const data   = stats.grade_distribution.map(g => g.count);
    const colors = labels.map(gradeBarColor);
    gradeChart = new Chart(gc, {
      type: 'bar',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 4, borderSkipped: false }] },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: { backgroundColor: cc.tooltip, titleColor: cc.text, bodyColor: cc.text,
                     borderColor: cc.border, borderWidth: 1,
                     callbacks: { label: ctx => ` ${ctx.raw} coin${ctx.raw !== 1 ? 's' : ''}` } }
        },
        scales: {
          x: { ticks: { color: cc.muted, maxRotation: 45 }, grid: { color: cc.grid } },
          y: { ticks: { color: cc.muted, stepSize: 1 }, grid: { color: cc.grid } }
        }
      }
    });
    gc.closest('.card').querySelector('.chart-label')?.remove();
    const lbl = document.createElement('div');
    lbl.className = 'chart-label';
    lbl.textContent = 'Grade Distribution';
    gc.closest('.card').prepend(lbl);
  }

  if (decadeChart) decadeChart.destroy();
  const dc = document.getElementById('chart-decades');
  if (dc && stats.decade_distribution?.length) {
    const labels = stats.decade_distribution.map(d => d.decade);
    const data   = stats.decade_distribution.map(d => d.count);
    decadeChart = new Chart(dc, {
      type: 'bar',
      data: { labels, datasets: [{ data, backgroundColor: 'rgba(97,117,248,0.6)', borderRadius: 4, borderSkipped: false }] },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: { backgroundColor: cc.tooltip, titleColor: cc.text, bodyColor: cc.text,
                     borderColor: cc.border, borderWidth: 1,
                     callbacks: { label: ctx => ` ${ctx.raw} coin${ctx.raw !== 1 ? 's' : ''}` } }
        },
        scales: {
          x: { ticks: { color: cc.muted, maxRotation: 45 }, grid: { color: cc.grid } },
          y: { ticks: { color: cc.muted, stepSize: 1 }, grid: { color: cc.grid } }
        }
      }
    });
    dc.closest('.card').querySelector('.chart-label')?.remove();
    const lbl2 = document.createElement('div');
    lbl2.className = 'chart-label';
    lbl2.textContent = 'Coins by Decade';
    dc.closest('.card').prepend(lbl2);
  }
}

// ─── By Country ───────────────────────────────────────────────────────────────
function renderCoinsByCountry(byIssuer) {
  const el = document.getElementById('coins-by-country');
  el.innerHTML = '';
  byIssuer.forEach((item, i) => {
    const color = countryColor(i);
    const est   = item.estimate ? fmtUSD(item.estimate) : '—';
    el.innerHTML += `
      <div class="card country-card">
        <div class="country-card-header">
          <div class="metal-dot" style="background:${color}"></div>
          <strong>${escC(item.issuer)}</strong>
          <span class="count">${item.count} coins</span>
        </div>
        <div class="stat"><span class="k">Est. Value</span><span class="v">${est}</span></div>
      </div>`;
  });
}

// ─── Filters ─────────────────────────────────────────────────────────────────
function populateFilterDropdowns(coins, stats) {
  const issuerSel = document.getElementById('coin-filter-issuer');
  const gradeSel  = document.getElementById('coin-filter-grade');

  const issuers = [...new Set(coins.map(c => c.issuer))].sort();
  issuers.forEach(i => {
    const opt = document.createElement('option');
    opt.value = i; opt.textContent = i;
    issuerSel.appendChild(opt);
  });

  const grades = (stats.grade_distribution || []).map(g => g.grade).filter(g => g !== 'Ungraded');
  grades.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g; opt.textContent = g;
    gradeSel.appendChild(opt);
  });
}

function applyCoinFilters() {
  const search    = document.getElementById('coin-search').value.trim().toLowerCase();
  const issuer    = document.getElementById('coin-filter-issuer').value;
  const grade     = document.getElementById('coin-filter-grade').value;
  const yearFrom  = parseInt(document.getElementById('coin-year-from').value) || null;
  const yearTo    = parseInt(document.getElementById('coin-year-to').value)   || null;

  filteredCoins = allCoins.filter(c => {
    if (issuer && c.issuer !== issuer) return false;
    if (grade  && c.grade  !== grade)  return false;
    if (yearFrom && (c.gregorian_year || 0) < yearFrom) return false;
    if (yearTo   && (c.gregorian_year || 0) > yearTo)   return false;
    if (search) {
      const haystack = [c.issuer, c.title, c.reference, c.grade,
                        c.comment, c.public_comment, c.private_comment,
                        String(c.gregorian_year || ''), c.mintmark]
                       .join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
  renderCoinsTable(filteredCoins);
}

function clearCoinFilters() {
  document.getElementById('coin-search').value      = '';
  document.getElementById('coin-filter-issuer').value = '';
  document.getElementById('coin-filter-grade').value  = '';
  document.getElementById('coin-year-from').value   = '';
  document.getElementById('coin-year-to').value     = '';
  filteredCoins = allCoins;
  renderCoinsTable(filteredCoins);
}

// ─── Table ────────────────────────────────────────────────────────────────────
const COIN_SORT_COLS = ['issuer', 'title', 'gregorian_year', 'grade', 'estimate'];

document.addEventListener('click', e => {
  const th = e.target.closest('[data-coin-sort]');
  if (!th) return;
  const col = th.dataset.coinSort;
  if (coinSort.col === col) coinSort.dir *= -1;
  else { coinSort.col = col; coinSort.dir = 1; }
  renderCoinsTable(filteredCoins);
});

function sortedCoins(coins) {
  const { col, dir } = coinSort;
  if (!col) return coins;
  return [...coins].sort((a, b) => {
    let av = a[col], bv = b[col];
    if (col === 'grade') {
      const ORDER = ['UNC','AU','XF','EF','VF','F','VG','G','AG','P','FR'];
      const ai = ORDER.findIndex(g => (av||'').toUpperCase().includes(g));
      const bi = ORDER.findIndex(g => (bv||'').toUpperCase().includes(g));
      av = ai === -1 ? 99 : ai;
      bv = bi === -1 ? 99 : bi;
    }
    if (av == null) av = col === 'gregorian_year' ? 0 : '';
    if (bv == null) bv = col === 'gregorian_year' ? 0 : '';
    if (av < bv) return -dir;
    if (av > bv) return  dir;
    return 0;
  });
}

function renderCoinsTable(coins) {
  const sorted = sortedCoins(coins);
  const tbody  = document.getElementById('coins-tbody');
  const empty  = document.getElementById('coins-table-empty');
  const count  = document.getElementById('coins-table-count');

  // Update sort arrows in header
  document.querySelectorAll('#coins-table th[data-coin-sort]').forEach(th => {
    const col = th.dataset.coinSort;
    th.classList.toggle('th-sort-active', col === coinSort.col);
    const arrow = col === coinSort.col ? (coinSort.dir === 1 ? ' ↑' : ' ↓') : '';
    th.textContent = th.textContent.replace(/ [↑↓]$/, '') + arrow;
  });

  if (!sorted.length) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    count.textContent = '';
    return;
  }
  empty.classList.add('hidden');
  count.textContent = `Showing ${sorted.length} of ${allCoins.length} coins`;

  tbody.innerHTML = sorted.map(c => {
    const yearStr = [c.year, c.mintmark].filter(Boolean).join('-');
    const notes   = [c.public_comment, c.private_comment].filter(Boolean).join(' · ');
    const estStr  = c.estimate ? fmtUSD(c.estimate) : '—';
    return `<tr>
      <td><span class="muted">${escC(c.issuer)}</span></td>
      <td>
        <div style="font-weight:500">${escC(c.title)}</div>
        <div class="text-xs muted">${escC(c.reference)}${c.n_number ? ' · ' + escC(c.n_number) : ''}</div>
      </td>
      <td style="white-space:nowrap">${escC(yearStr)}</td>
      <td>${escC(c.mintmark || '')}</td>
      <td>${gradeBadgeHtml(c.grade)}</td>
      <td style="white-space:nowrap;font-weight:500">${estStr}</td>
      <td class="muted text-xs" style="max-width:220px">${escC(notes)}</td>
    </tr>`;
  }).join('');
}

// ─── Duplicates ───────────────────────────────────────────────────────────────
function renderDuplicates(dups) {
  const badge = document.getElementById('dup-badge');
  const list  = document.getElementById('dup-list');

  if (!dups.length) {
    badge.style.display = 'none';
    list.innerHTML = '<p class="muted">No duplicate entries detected.</p>';
    return;
  }

  badge.style.display = 'inline-flex';
  badge.textContent   = dups.length + ' groups';

  list.innerHTML = dups.map(g => {
    const mintLabel = g.mintmark ? `-${g.mintmark}` : '';
    const grades    = g.coins.map(c => gradeBadgeHtml(c.grade || '—')).join(' ');
    const notes     = g.coins.map(c => [c.public_comment, c.private_comment].filter(Boolean).join('; ')).filter(Boolean);
    return `
      <div class="dup-group">
        <div class="dup-group-header">${escC(g.title)} · ${escC(g.year)}${escC(mintLabel)}</div>
        <div class="dup-group-sub">${escC(g.issuer)} · ${escC(g.reference)} · ${g.count} entries</div>
        <div class="dup-grades">${grades}</div>
        ${notes.length ? `<div class="text-xs muted" style="margin-top:6px">${notes.map(esc).join('<br>')}</div>` : ''}
      </div>`;
  }).join('');
}

// ─── Gap Analysis ─────────────────────────────────────────────────────────────
function renderGaps(gaps) {
  const badge = document.getElementById('gap-badge');
  const list  = document.getElementById('gap-list');

  if (!gaps.length) {
    badge.style.display = 'none';
    list.innerHTML = '<p class="muted">No series gaps found.</p>';
    return;
  }

  badge.style.display = 'inline-flex';
  badge.textContent   = gaps.length + ' series';

  list.innerHTML = gaps.map(g => {
    const ownedSet = new Set(g.years_owned);
    const gapSet   = new Set(g.gaps);
    const allYears = Array.from(
      { length: g.max_year - g.min_year + 1 },
      (_, i) => g.min_year + i
    );
    const yearPills = allYears.map(y => {
      const cls = ownedSet.has(y) ? 'owned' : 'missing';
      return `<span class="gap-year ${cls}">${y}</span>`;
    }).join('');
    return `
      <div class="gap-series">
        <div class="gap-series-header">
          <span class="gap-series-title">${escC(g.title)}</span>
          <span class="gap-series-meta">${escC(g.issuer)} · ${escC(g.reference)}</span>
        </div>
        <div class="gap-years">${yearPills}</div>
        <div class="text-xs muted" style="margin-top:8px">
          <span style="color:var(--green)">█</span> owned (${g.years_owned.length}) &nbsp;
          <span style="color:var(--red)">□</span> missing (${g.gaps.length})
        </div>
      </div>`;
  }).join('');
}

// ─── Collapsible sections ─────────────────────────────────────────────────────
function toggleCoinSection(bodyId, chevronId) {
  const body    = document.getElementById(bodyId);
  const chevron = document.getElementById(chevronId);
  const hidden  = body.style.display === 'none';
  body.style.display    = hidden ? '' : 'none';
  chevron.style.transform = hidden ? '' : 'rotate(-90deg)';
}

// ─── CSV Export ───────────────────────────────────────────────────────────────
function exportCoinsCsv() {
  const headers = ['Issuer','Reference','N# Number','Title','Year','Mintmark',
                   'Grade','Estimate (USD)','Comment','Public Comment','Private Comment'];
  const rows = filteredCoins.map(c => [
    c.issuer, c.reference, c.n_number, c.title, c.year || c.gregorian_year, c.mintmark,
    c.grade, c.estimate ?? '', c.comment, c.public_comment, c.private_comment,
  ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`));

  const csv  = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'coin_collection.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function fmtUSD(n) {
  if (n == null) return '—';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function gradeBadgeHtml(grade) {
  if (!grade) return '<span class="grade-badge grade-none">—</span>';
  const g = grade.toUpperCase();
  let cls = 'grade-none';
  if (g.includes('UNC') || g.includes('MS') || g.includes('PF') || g === 'BU') cls = 'grade-unc';
  else if (g.startsWith('AU'))  cls = 'grade-au';
  else if (g.startsWith('XF') || g.startsWith('EF')) cls = 'grade-xf';
  else if (g.startsWith('VF'))  cls = 'grade-vf';
  else if (g === 'F')           cls = 'grade-f';
  else if (g.startsWith('VG') || g === 'G' || g === 'AG' || g.startsWith('FR')) cls = 'grade-g';
  return `<span class="grade-badge ${cls}">${escC(grade)}</span>`;
}

function gradeBarColor(grade) {
  const g = (grade || '').toUpperCase();
  if (g.includes('UNC') || g.includes('MS') || g.includes('PF')) return 'rgba(52,211,153,0.7)';
  if (g.startsWith('AU'))  return 'rgba(97,117,248,0.7)';
  if (g.startsWith('XF') || g.startsWith('EF')) return 'rgba(141,164,248,0.7)';
  if (g.startsWith('VF'))  return 'rgba(245,200,66,0.7)';
  if (g === 'F')           return 'rgba(201,164,48,0.7)';
  return 'rgba(248,113,113,0.6)';
}

const COUNTRY_COLORS = [
  '#6175f8','#f5c842','#34d399','#f87171','#90caf9','#ce93d8',
  '#fb923c','#4ade80','#60a5fa','#f472b6',
];
function countryColor(i) { return COUNTRY_COLORS[i % COUNTRY_COLORS.length]; }

// esc() is defined in app.js; escC wraps it to handle null/undefined safely
function escC(s) { return esc(String(s ?? '')); }

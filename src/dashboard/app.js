/**
 * Venice Caching Health Monitor - Dashboard JavaScript
 * Simplified - no SSE, no runs, just results
 */

const BASE_PATH = '/cache';

// Chart instances
let comparisonChart = null;
let trendChart = null;

// State
let testEvidence = [];
let currentLogFilter = 'all';
let testEvidenceDisplayLimit = 50;
const TEST_EVIDENCE_PAGE_SIZE = 50;

// Models state for sorting and filtering
let modelsData = [];
let sparklinesData = {};
let modelsSortColumn = 'avg_cache_rate';
let modelsSortDirection = 'desc';
let providerFilter = 'all';
let statusFilter = 'all';

// Auto-refresh state
let refreshCountdown = 60;
let refreshInterval = null;

// ============ Initialization ============

document.addEventListener('DOMContentLoaded', () => {
  initDashboard();
  setupEventListeners();
  initRefreshCountdown();
  initTableSorting();
  initFilters();
});

async function initDashboard() {
  // Load each independently - don't let one failure block others
  loadStats().catch(e => console.error('loadStats failed:', e));
  loadModels().catch(e => console.error('loadModels failed:', e));
  loadCachingSummary().catch(e => console.error('loadCachingSummary failed:', e));
  loadTestEvidence().catch(e => console.error('loadTestEvidence failed:', e));
  loadServerLogs().catch(e => console.error('loadServerLogs failed:', e));
  loadUsageStats().catch(e => console.error('loadUsageStats failed:', e));
  initComparisonChart().catch(e => console.error('initComparisonChart failed:', e));
  initTrendChart().catch(e => console.error('initTrendChart failed:', e));
  initMicroscope();
}

function setupEventListeners() {
  // Trend days selector
  const trendDays = document.getElementById('trend-days');
  if (trendDays) {
    trendDays.addEventListener('change', (e) => {
      initTrendChart(parseInt(e.target.value));
    });
  }

  // Log filter radio buttons
  document.querySelectorAll('input[name="log-filter"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      currentLogFilter = e.target.value;
      renderTestEvidence();
    });
  });

  // Refresh logs button
  const refreshLogsBtn = document.getElementById('refresh-logs');
  if (refreshLogsBtn) {
    refreshLogsBtn.addEventListener('click', loadServerLogs);
  }
}

async function refreshDashboard() {
  await Promise.all([
    loadStats(),
    loadModels(),
    loadCachingSummary(),
    loadTestEvidence(),
    loadUsageStats(),
  ]);
  updateComparisonChart();
}

// ============ Stats Loading ============

async function loadStats() {
  try {
    const response = await fetch(`${BASE_PATH}/api/stats`);
    const stats = await response.json();

    // Update health badge
    const badge = document.getElementById('health-badge');
    badge.classList.remove('loading', 'good', 'warning', 'bad');

    if (stats.modelsWithCaching > 0 && stats.avgCacheRate > 50) {
      badge.classList.add('good');
      badge.textContent = `${stats.modelsWithCaching} Caching`;
    } else if (stats.modelsWithCaching > 0) {
      badge.classList.add('warning');
      badge.textContent = `${stats.modelsWithCaching} Caching`;
    } else if (stats.totalModels > 0) {
      badge.classList.add('loading');
      badge.textContent = 'No Cache';
    } else {
      badge.classList.add('loading');
      badge.textContent = 'No Data';
    }

    // Update inline stats
    document.getElementById('stat-last-test').textContent =
      `Last: ${stats.lastTestAt ? formatDate(stats.lastTestAt) : '--'}`;

    document.getElementById('stat-total-models').textContent =
      `Models: ${stats.totalModels || '0'}`;

    document.getElementById('stat-caching-models').textContent =
      `Caching: ${stats.modelsWithCaching || '0'}`;

    document.getElementById('stat-avg-rate').textContent =
      `Avg: ${stats.avgCacheRate ? stats.avgCacheRate.toFixed(1) : '0'}%`;

  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

// ============ Token Usage Stats ============

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

async function loadUsageStats() {
  try {
    const response = await fetch(`${BASE_PATH}/api/usage?days=30`);
    const data = await response.json();

    if (data.error) {
      console.error('Usage API error:', data.error);
      return;
    }

    const { stats, daily } = data;

    // Update usage cards
    document.getElementById('usage-requests').textContent = formatNumber(stats.totalRequests || 0);
    document.getElementById('usage-prompt').textContent = formatNumber(stats.totalPromptTokens || 0);
    document.getElementById('usage-cached').textContent = formatNumber(stats.totalCachedTokens || 0);
    document.getElementById('usage-completion').textContent = formatNumber(stats.totalCompletionTokens || 0);
    document.getElementById('usage-savings').textContent =
      stats.savingsPercent ? stats.savingsPercent.toFixed(1) + '%' : '0%';

    // Calculate daily average
    if (daily && daily.length > 0) {
      const totalTokens = stats.totalPromptTokens + stats.totalCompletionTokens;
      const avgDaily = Math.round(totalTokens / daily.length);
      document.getElementById('usage-daily-avg').textContent = formatNumber(avgDaily);
    } else {
      document.getElementById('usage-daily-avg').textContent = '--';
    }

  } catch (error) {
    console.error('Failed to load usage stats:', error);
  }
}

// ============ Caching Summary ============

async function loadCachingSummary() {
  try {
    const response = await fetch(`${BASE_PATH}/api/models`);
    const models = await response.json();

    const cachingModels = models.filter(m => (m.best_cache_rate || 0) > 0).sort((a, b) => (b.best_cache_rate || 0) - (a.best_cache_rate || 0));
    const pendingModels = models.filter(m => !m.best_cache_rate || m.best_cache_rate === 0);

    document.getElementById('summary-count').textContent = cachingModels.length;
    document.getElementById('summary-total').textContent = `of ${models.length} tested`;

    const cachingList = document.getElementById('caching-models-list');
    if (cachingModels.length === 0) {
      cachingList.innerHTML = '<span class="loading-text">No models with caching yet</span>';
    } else {
      cachingList.innerHTML = cachingModels.map(m => `
        <div class="caching-model-card">
          <span class="model-name">${m.model_name || m.model_id}</span>
          <span class="cache-rate">${(m.best_cache_rate || 0).toFixed(1)}%</span>
        </div>
      `).join('');
    }

    document.getElementById('pending-count').textContent = pendingModels.length;
    const pendingList = document.getElementById('pending-models-list');
    if (pendingModels.length === 0) {
      document.getElementById('pending-models-section').style.display = 'none';
    } else {
      document.getElementById('pending-models-section').style.display = 'block';
      pendingList.innerHTML = pendingModels.map(m =>
        `<span class="pending-model-tag">${m.model_name || m.model_id}</span>`
      ).join('');
    }

  } catch (error) {
    console.error('Failed to load caching summary:', error);
  }
}

// ============ Models Loading ============

async function loadModels() {
  try {
    // Load models and sparklines in parallel
    const [modelsResp, sparklinesResp] = await Promise.all([
      fetch(`${BASE_PATH}/api/models`),
      fetch(`${BASE_PATH}/api/sparklines`)
    ]);

    modelsData = await modelsResp.json();

    // Convert sparklines array to lookup object
    const sparklines = await sparklinesResp.json();
    sparklinesData = {};
    for (const s of sparklines) {
      sparklinesData[s.model_id] = s.rates;
    }

    populateProviderFilter();
    renderModelsTable();
  } catch (error) {
    console.error('Failed to load models:', error);
  }
}

/**
 * Generate an inline SVG sparkline
 * @param {number[]} values - Array of values (0-100)
 * @param {number} width - SVG width
 * @param {number} height - SVG height
 */
function generateSparkline(values, width = 60, height = 20) {
  if (!values || values.length === 0) {
    return '<span class="sparkline-empty">--</span>';
  }

  const padding = 2;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  // Normalize values (0-100 scale for cache rates)
  const min = 0;
  const max = 100;
  const range = max - min || 1;

  // Calculate points
  const points = values.map((v, i) => {
    const x = padding + (i / (values.length - 1 || 1)) * innerWidth;
    const y = padding + innerHeight - ((v - min) / range) * innerHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  // Determine color based on trend (last vs first)
  const trend = values.length > 1 ? values[values.length - 1] - values[0] : 0;
  let strokeColor = 'var(--text-muted)';
  if (trend > 10) strokeColor = 'var(--status-good)';
  else if (trend < -10) strokeColor = 'var(--status-error)';

  // Also color based on overall performance
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  if (avg >= 50) strokeColor = 'var(--status-good)';
  else if (avg >= 25) strokeColor = 'var(--status-warning)';
  else if (avg > 0) strokeColor = 'var(--status-error)';

  return `
    <svg width="${width}" height="${height}" class="sparkline">
      <polyline
        points="${points.join(' ')}"
        fill="none"
        stroke="${strokeColor}"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle cx="${points[points.length - 1].split(',')[0]}" cy="${points[points.length - 1].split(',')[1]}" r="2" fill="${strokeColor}" />
    </svg>
  `;
}

function renderModelsTable() {
  const tbody = document.getElementById('models-tbody');

  if (modelsData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">No models tested yet</td></tr>';
    return;
  }

  // Apply filters
  let filtered = modelsData;

  if (providerFilter !== 'all') {
    filtered = filtered.filter(m => getProvider(m.model_id) === providerFilter);
  }

  if (statusFilter === 'caching') {
    filtered = filtered.filter(m => (m.avg_cache_rate || 0) > 0);
  } else if (statusFilter === 'no-caching') {
    filtered = filtered.filter(m => (m.avg_cache_rate || 0) === 0);
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">No models match filters</td></tr>';
    return;
  }

  // Sort the data
  const sorted = [...filtered].sort((a, b) => {
    let aVal, bVal;

    switch (modelsSortColumn) {
      case 'model_name':
        aVal = (a.model_name || a.model_id || '').toLowerCase();
        bVal = (b.model_name || b.model_id || '').toLowerCase();
        break;
      case 'caching_works':
        aVal = (a.avg_cache_rate || 0) > 0 ? 1 : 0;
        bVal = (b.avg_cache_rate || 0) > 0 ? 1 : 0;
        break;
      case 'avg_cache_rate':
        aVal = a.avg_cache_rate || 0;
        bVal = b.avg_cache_rate || 0;
        break;
      case 'best_cache_rate':
        aVal = a.best_cache_rate || 0;
        bVal = b.best_cache_rate || 0;
        break;
      case 'reliability':
        aVal = a.cache_reliability_score || 0;
        bVal = b.cache_reliability_score || 0;
        break;
      case 'last_tested':
        aVal = a.last_tested_at || '';
        bVal = b.last_tested_at || '';
        break;
      default:
        aVal = a.avg_cache_rate || 0;
        bVal = b.avg_cache_rate || 0;
    }

    if (aVal < bVal) return modelsSortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return modelsSortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  tbody.innerHTML = sorted.map(model => {
    const provider = getProvider(model.model_id);
    const sparklineRates = sparklinesData[model.model_id] || [];
    return `
      <tr data-model-id="${model.model_id}">
        <td class="model-cell">
          <span class="provider-badge">${provider}</span>
          ${model.model_name || model.model_id}
          <span class="model-id" title="Click to copy" onclick="copyModelId('${model.model_id}')">${model.model_id}</span>
        </td>
        <td>${(model.avg_cache_rate || 0) > 0 ? '<span class="status-yes">✓</span>' : '<span class="status-no">✗</span>'}</td>
        <td class="cache-rate ${getCacheRateClass(model.avg_cache_rate || 0)}">${(model.avg_cache_rate || 0).toFixed(1)}%</td>
        <td class="cache-rate ${getCacheRateClass(model.best_cache_rate || 0)}">${(model.best_cache_rate || 0).toFixed(1)}%</td>
        <td class="sparkline-cell">${generateSparkline(sparklineRates)}</td>
        <td>${(model.cache_reliability_score || 0).toFixed(0)}%</td>
        <td>${model.last_tested_at ? formatDate(model.last_tested_at) : '--'}</td>
      </tr>
    `;
  }).join('');
}

function copyModelId(modelId) {
  navigator.clipboard.writeText(modelId).then(() => {
    // Show brief feedback
    const el = document.querySelector(`tr[data-model-id="${modelId}"] .model-id`);
    if (el) {
      const original = el.textContent;
      el.textContent = 'Copied!';
      el.classList.add('copied');
      setTimeout(() => {
        el.textContent = original;
        el.classList.remove('copied');
      }, 1000);
    }
  });
}

function initTableSorting() {
  const headers = document.querySelectorAll('#model-table th');
  const columns = ['model_name', 'caching_works', 'avg_cache_rate', 'best_cache_rate', null, 'reliability', 'last_tested']; // null = trend (not sortable)

  headers.forEach((header, index) => {
    if (columns[index]) {
      header.classList.add('sortable');
      header.dataset.column = columns[index];
      header.addEventListener('click', () => {
        const column = columns[index];
        if (modelsSortColumn === column) {
          modelsSortDirection = modelsSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          modelsSortColumn = column;
          modelsSortDirection = 'desc';
        }
        updateSortIndicators();
        renderModelsTable();
      });
    }
  });
  updateSortIndicators();
}

function updateSortIndicators() {
  document.querySelectorAll('#model-table th').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.column === modelsSortColumn) {
      th.classList.add(modelsSortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
}

// ============ Filters ============

function initFilters() {
  const providerSelect = document.getElementById('provider-filter');
  const statusSelect = document.getElementById('status-filter');

  if (providerSelect) {
    providerSelect.addEventListener('change', (e) => {
      providerFilter = e.target.value;
      renderModelsTable();
    });
  }

  if (statusSelect) {
    statusSelect.addEventListener('change', (e) => {
      statusFilter = e.target.value;
      renderModelsTable();
    });
  }
}

function populateProviderFilter() {
  const providerSelect = document.getElementById('provider-filter');
  if (!providerSelect || modelsData.length === 0) return;

  // Extract unique providers
  const providers = new Set();
  modelsData.forEach(model => {
    providers.add(getProvider(model.model_id));
  });

  // Clear and repopulate (keeping "All" option)
  const currentValue = providerSelect.value;
  providerSelect.innerHTML = '<option value="all">All Providers</option>';

  Array.from(providers).sort().forEach(provider => {
    const option = document.createElement('option');
    option.value = provider;
    option.textContent = provider;
    providerSelect.appendChild(option);
  });

  // Restore selection if still valid
  if (currentValue && providers.has(currentValue)) {
    providerSelect.value = currentValue;
  }
}

// Extract provider from model_id for grouping display
function getProvider(modelId) {
  if (modelId.includes('claude') || modelId.includes('opus') || modelId.includes('sonnet')) return 'Anthropic';
  if (modelId.includes('gpt') || modelId.includes('openai')) return 'OpenAI';
  if (modelId.includes('glm') || modelId.includes('zai-org')) return 'Zhipu';
  if (modelId.includes('deepseek')) return 'DeepSeek';
  if (modelId.includes('grok')) return 'xAI';
  if (modelId.includes('kimi') || modelId.includes('moonshot')) return 'Moonshot';
  if (modelId.includes('llama') || modelId.includes('meta')) return 'Meta';
  if (modelId.includes('mistral')) return 'Mistral';
  if (modelId.includes('qwen')) return 'Alibaba';
  if (modelId.includes('gemini') || modelId.includes('google')) return 'Google';
  return 'Other';
}

// ============ Auto-Refresh Countdown ============

function initRefreshCountdown() {
  refreshCountdown = 60;
  updateRefreshDisplay();

  // Countdown every second
  setInterval(() => {
    refreshCountdown--;
    if (refreshCountdown <= 0) {
      refreshCountdown = 60;
      refreshDashboard();
    }
    updateRefreshDisplay();
  }, 1000);
}

function updateRefreshDisplay() {
  const el = document.getElementById('refresh-countdown');
  if (el) {
    el.textContent = `${refreshCountdown}s`;
  }
}

function manualRefresh() {
  refreshCountdown = 60;
  refreshDashboard();
  updateRefreshDisplay();
}

function getCacheRateClass(rate) {
  // Aligned with cachingSupportThreshold.minCacheHitRate (50%)
  if (rate >= 50) return 'high';
  if (rate >= 25) return 'medium';
  return 'low';
}

// ============ Charts ============

async function initComparisonChart() {
  try {
    const response = await fetch(`${BASE_PATH}/api/models`);
    const models = await response.json();

    if (models.length === 0) return;

    const ctx = document.getElementById('comparison-chart').getContext('2d');

    if (comparisonChart) comparisonChart.destroy();

    comparisonChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: models.slice(0, 15).map(m => m.model_name || m.model_id),
        datasets: [
          {
            label: 'Avg',
            data: models.slice(0, 15).map(m => m.avg_cache_rate || 0),
            backgroundColor: 'rgba(75, 192, 192, 0.7)',
            barThickness: 12,
          },
          {
            label: 'Best',
            data: models.slice(0, 15).map(m => m.best_cache_rate || 0),
            backgroundColor: 'rgba(54, 162, 235, 0.7)',
            barThickness: 12,
          },
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, max: 100, ticks: { font: { size: 9 }, stepSize: 25 } },
          x: { ticks: { font: { size: 9 }, maxRotation: 0, autoSkip: true } }
        },
        plugins: {
          legend: { display: true, position: 'top', labels: { font: { size: 9 }, boxWidth: 10, padding: 4 } },
        }
      }
    });

  } catch (error) {
    console.error('Failed to init comparison chart:', error);
  }
}

async function updateComparisonChart() {
  try {
    const response = await fetch(`${BASE_PATH}/api/models`);
    const models = await response.json();

    if (!comparisonChart || models.length === 0) return;

    comparisonChart.data.labels = models.slice(0, 15).map(m => m.model_name || m.model_id);
    comparisonChart.data.datasets[0].data = models.slice(0, 15).map(m => m.avg_cache_rate || 0);
    comparisonChart.data.datasets[1].data = models.slice(0, 15).map(m => m.best_cache_rate || 0);
    comparisonChart.update();

  } catch (error) {
    console.error('Failed to update comparison chart:', error);
  }
}

async function initTrendChart(days = 30) {
  try {
    const response = await fetch(`${BASE_PATH}/api/history?days=${days}`);
    const history = await response.json();

    const ctx = document.getElementById('trend-chart').getContext('2d');

    if (trendChart) trendChart.destroy();

    if (history.length === 0) {
      ctx.font = '16px sans-serif';
      ctx.fillStyle = '#999';
      ctx.textAlign = 'center';
      ctx.fillText('No historical data yet', ctx.canvas.width / 2, ctx.canvas.height / 2);
      return;
    }

    trendChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: history.map(h => h.date),
        datasets: [{
          label: 'Avg Rate',
          data: history.map(h => h.avgRate),
          borderColor: 'rgb(75, 192, 192)',
          borderWidth: 1,
          fill: false,
          tension: 0.2,
          pointRadius: 2,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, max: 100, ticks: { font: { size: 9 }, stepSize: 25 } },
          x: { ticks: { font: { size: 9 }, maxRotation: 0, autoSkip: true } }
        },
        plugins: { legend: { display: false } }
      }
    });

  } catch (error) {
    console.error('Failed to init trend chart:', error);
  }
}

// ============ Test Evidence ============

async function loadTestEvidence() {
  try {
    const response = await fetch(`${BASE_PATH}/api/results?limit=100`);
    testEvidence = await response.json();
    renderTestEvidence();
  } catch (error) {
    console.error('Failed to load test evidence:', error);
    testEvidence = [];
    renderTestEvidence();
  }
}

function renderTestEvidence() {
  const tbody = document.getElementById('logs-body');

  if (!testEvidence || testEvidence.length === 0) {
    tbody.innerHTML = '<tr class="logs-placeholder"><td colspan="5">No test results yet</td></tr>';
    return;
  }

  // Apply filter
  let filtered = testEvidence;
  if (currentLogFilter === 'errors') {
    filtered = testEvidence.filter(r => r.error);
  } else if (currentLogFilter === 'rate-limits') {
    filtered = testEvidence.filter(r => {
      const errorType = extractErrorType(r.details);
      return errorType === 'rate_limit';
    });
  } else if (currentLogFilter === 'timeouts') {
    filtered = testEvidence.filter(r => {
      const errorType = extractErrorType(r.details);
      return errorType === 'timeout';
    });
  } else if (currentLogFilter === 'cache-hits') {
    filtered = testEvidence.filter(r => r.cachingWorks);
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr class="logs-placeholder"><td colspan="5">No matching results</td></tr>';
    updateLogsPagination(0, 0);
    return;
  }

  const displayed = filtered.slice(0, testEvidenceDisplayLimit);

  tbody.innerHTML = displayed.map(r => {
    const timeStr = formatLogTimestamp(r.testedAt);
    const cacheRate = r.cacheHitRate?.toFixed(1) || '0';
    const rowClass = r.error ? 'log-error' : (r.cachingWorks ? 'log-hit' : '');

    // Error type badge
    let errorTypeBadge = '';
    if (r.error && r.details) {
      const errorType = extractErrorType(r.details);
      if (errorType) {
        const badgeClass = errorType === 'rate_limit' ? 'error-badge-rate-limit' :
                           errorType === 'timeout' ? 'error-badge-timeout' :
                           'error-badge-api-error';
        const badgeText = errorType === 'rate_limit' ? 'Rate Limited' :
                          errorType === 'timeout' ? 'Timeout' :
                          'API Error';
        errorTypeBadge = `<span class="${badgeClass}">${badgeText}</span>`;
      }
    }

    // Token info
    let tokenInfo = '--';
    let usage = r.details?.secondRequest?.usage || r.details?.firstRequest?.usage;
    if (!usage && r.details?.requests?.length > 0) {
      usage = r.details.requests[r.details.requests.length - 1]?.usage;
    }
    if (!usage && r.details?.sizes) {
      usage = r.details.sizes.xlarge?.secondRequest?.usage || r.details.sizes.large?.secondRequest?.usage;
    }
    if (usage) {
      const cached = usage.cachedTokens || 0;
      const total = usage.promptTokens || 0;
      tokenInfo = `${cached}/${total}`;
    }

    const detailData = btoa(encodeURIComponent(JSON.stringify({ details: r.details, error: r.error, cacheRate: r.cacheHitRate, cachingWorks: r.cachingWorks })));

    return `
      <tr class="log-row ${rowClass}" data-detail="${detailData}" onclick="toggleLogDetail(this)">
        <td>${timeStr}</td>
        <td>${escapeHtml(r.modelName || r.modelId)}</td>
        <td>${escapeHtml(r.testName)} ${errorTypeBadge}</td>
        <td class="cache-rate ${getCacheRateClass(r.cacheHitRate || 0)}">${cacheRate}%</td>
        <td>${tokenInfo}</td>
      </tr>
    `;
  }).join('');

  updateLogsPagination(displayed.length, filtered.length);
}

function updateLogsPagination(showing, total) {
  const paginationDiv = document.getElementById('logs-pagination');
  const showingSpan = document.getElementById('logs-showing');
  const showMoreBtn = document.getElementById('logs-show-more');

  if (total === 0) {
    paginationDiv.classList.add('hidden');
    return;
  }

  paginationDiv.classList.remove('hidden');
  showingSpan.textContent = `Showing ${showing} of ${total}`;

  if (showing >= total) {
    showMoreBtn.classList.add('hidden');
  } else {
    showMoreBtn.classList.remove('hidden');
    showMoreBtn.onclick = () => {
      testEvidenceDisplayLimit += TEST_EVIDENCE_PAGE_SIZE;
      renderTestEvidence();
    };
  }
}

function toggleLogDetail(row) {
  const existingDetail = row.nextElementSibling;
  if (existingDetail && existingDetail.classList.contains('log-detail-row')) {
    existingDetail.remove();
    return;
  }

  let detail;
  try {
    detail = JSON.parse(decodeURIComponent(atob(row.dataset.detail)));
  } catch (e) {
    console.error('Failed to parse detail:', e);
    return;
  }

  let content = '<div class="evidence-container">';

  if (detail.error) {
    let errorTypeInfo = '';
    const errorType = extractErrorType(detail.details);
    if (errorType) {
      const typeLabel = errorType === 'rate_limit' ? '⚠️ Rate Limit' :
                        errorType === 'timeout' ? '⏱️ Timeout' :
                        '❌ API Error';
      errorTypeInfo = `<div class="error-type-label">${typeLabel}</div>`;
    }
    content += `<div class="evidence-section evidence-error"><h4>Error</h4>${errorTypeInfo}<pre class="evidence-pre">${escapeHtml(detail.error)}</pre></div>`;
  }

  if (detail.details) {
    content += `<div class="evidence-section"><h4>Test Data</h4><pre class="evidence-pre">${syntaxHighlightJSON(JSON.stringify(detail.details, null, 2))}</pre></div>`;
  }

  content += '</div>';

  const detailRow = document.createElement('tr');
  detailRow.className = 'log-detail-row';
  detailRow.innerHTML = `<td colspan="5">${content}</td>`;
  row.after(detailRow);
}

// ============ Server Logs ============

async function loadServerLogs() {
  try {
    const response = await fetch(`${BASE_PATH}/api/logs?lines=50`);
    const data = await response.json();
    const logsEl = document.getElementById('server-logs');

    if (data.logs && data.logs.length > 0) {
      logsEl.textContent = data.logs.join('\n');
    } else {
      logsEl.textContent = 'No logs yet';
    }
  } catch (error) {
    console.error('Failed to load server logs:', error);
    document.getElementById('server-logs').textContent = 'Failed to load logs';
  }
}

// ============ Utilities ============

function formatDate(dateStr) {
  const normalizedDate = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  const date = new Date(normalizedDate);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return '<1m';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d`;

  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const mins = String(date.getMinutes()).padStart(2, '0');
  return `${month}/${day} ${hours}:${mins}`;
}

function formatLogTimestamp(timestamp) {
  const normalizedDate = timestamp.includes('T') ? timestamp : timestamp.replace(' ', 'T') + 'Z';
  const date = new Date(normalizedDate);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function syntaxHighlightJSON(json) {
  json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    function (match) {
      let cls = 'json-number';
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? 'json-key' : 'json-string';
      } else if (/true|false/.test(match)) {
        cls = 'json-boolean';
      } else if (/null/.test(match)) {
        cls = 'json-null';
      }
      return '<span class="' + cls + '">' + match + '</span>';
    }
  );
}

/**
 * Extract error type from test details
 * Checks various locations where errorType might be stored
 */
function extractErrorType(details) {
  if (!details) return null;

  // Check firstRequest/secondRequest pattern (basic, partial_cache tests)
  if (details.firstRequest?.errorType) return details.firstRequest.errorType;
  if (details.secondRequest?.errorType) return details.secondRequest.errorType;

  // Check requests array (persistence test)
  if (details.requests && Array.isArray(details.requests)) {
    const reqWithError = details.requests.find(req => req.errorType);
    if (reqWithError) return reqWithError.errorType;
  }

  // Check sizes object (prompt_sizes test)
  if (details.sizes) {
    for (const size of Object.values(details.sizes)) {
      if (size.firstRequest?.errorType) return size.firstRequest.errorType;
      if (size.secondRequest?.errorType) return size.secondRequest.errorType;
    }
  }

  // Check delays object (ttl test)
  if (details.delays) {
    for (const delay of Object.values(details.delays)) {
      if (delay.firstRequest?.errorType) return delay.firstRequest.errorType;
      if (delay.secondRequest?.errorType) return delay.secondRequest.errorType;
    }
  }

  return null;
}

// ============ Cache Microscope ============

let allModels = []; // Store models for microscope dropdowns

function initMicroscope() {
  const model1Select = document.getElementById('microscope-model1');
  const model2Select = document.getElementById('microscope-model2');
  const runComparisonBtn = document.getElementById('run-comparison');
  const runSingleBtn = document.getElementById('run-single');
  const copyCurlBtn = document.getElementById('copy-curl');

  if (!model1Select || !model2Select) return;

  // Populate model dropdowns
  populateMicroscopeModels();

  // Event listeners
  runComparisonBtn?.addEventListener('click', runComparisonTest);
  runSingleBtn?.addEventListener('click', runSingleTest);
  copyCurlBtn?.addEventListener('click', copyCurlToClipboard);
}

async function populateMicroscopeModels() {
  try {
    const response = await fetch(`${BASE_PATH}/api/models`);
    allModels = await response.json();

    const model1Select = document.getElementById('microscope-model1');
    const model2Select = document.getElementById('microscope-model2');

    // Sort: models with caching first, then by name
    const sortedModels = [...allModels].sort((a, b) => {
      if (a.caching_works !== b.caching_works) return b.caching_works - a.caching_works;
      return (a.model_name || a.model_id).localeCompare(b.model_name || b.model_id);
    });

    // Add options
    sortedModels.forEach(model => {
      const name = model.model_name || model.model_id;
      const cacheIcon = model.caching_works ? '✓' : '✗';
      const rate = model.avg_cache_rate ? ` (${model.avg_cache_rate.toFixed(0)}%)` : '';

      const option1 = document.createElement('option');
      option1.value = model.model_id;
      option1.textContent = `${cacheIcon} ${name}${rate}`;
      model1Select.appendChild(option1);

      const option2 = document.createElement('option');
      option2.value = model.model_id;
      option2.textContent = `${cacheIcon} ${name}${rate}`;
      model2Select.appendChild(option2);
    });

    // Pre-select a broken model (like Opus) and a working one (like GLM)
    const opusModel = sortedModels.find(m => m.model_id.includes('opus'));
    const glmModel = sortedModels.find(m => m.model_id.includes('glm') && m.caching_works);

    if (opusModel) model1Select.value = opusModel.model_id;
    if (glmModel) model2Select.value = glmModel.model_id;

  } catch (error) {
    console.error('Failed to populate microscope models:', error);
  }
}

async function runSingleTest() {
  const model1 = document.getElementById('microscope-model1').value;
  if (!model1) {
    alert('Please select Model 1');
    return;
  }

  showMicroscopeStatus('Running test on ' + model1 + '... (takes ~5 seconds)');
  disableMicroscopeButtons(true);

  try {
    const response = await fetch(`${BASE_PATH}/api/test/${encodeURIComponent(model1)}`);
    const result = await response.json();

    if (result.error) {
      showMicroscopeStatus('Error: ' + result.error);
      return;
    }

    displaySingleResult(result);
  } catch (error) {
    showMicroscopeStatus('Test failed: ' + error.message);
  } finally {
    disableMicroscopeButtons(false);
  }
}

async function runComparisonTest() {
  const model1 = document.getElementById('microscope-model1').value;
  const model2 = document.getElementById('microscope-model2').value;

  if (!model1 || !model2) {
    alert('Please select both models');
    return;
  }

  showMicroscopeStatus('Running comparison test... (takes ~15 seconds)');
  disableMicroscopeButtons(true);

  try {
    const response = await fetch(`${BASE_PATH}/api/compare/${encodeURIComponent(model1)}/${encodeURIComponent(model2)}`);
    const result = await response.json();

    if (result.error) {
      showMicroscopeStatus('Error: ' + result.error);
      return;
    }

    displayComparisonResult(result);
  } catch (error) {
    showMicroscopeStatus('Test failed: ' + error.message);
  } finally {
    disableMicroscopeButtons(false);
  }
}

function showMicroscopeStatus(text) {
  const status = document.getElementById('microscope-status');
  const results = document.getElementById('microscope-results');

  status.classList.remove('hidden');
  status.querySelector('.status-text').textContent = text;
  results.classList.add('hidden');
}

function disableMicroscopeButtons(disabled) {
  document.getElementById('run-comparison').disabled = disabled;
  document.getElementById('run-single').disabled = disabled;
}

function displaySingleResult(result) {
  const status = document.getElementById('microscope-status');
  const results = document.getElementById('microscope-results');
  const card1 = document.getElementById('result-model1');
  const card2 = document.getElementById('result-model2');
  const conclusion = document.getElementById('comparison-conclusion');

  status.classList.add('hidden');
  results.classList.remove('hidden');
  card2.classList.add('hidden');
  conclusion.classList.add('hidden');

  populateResultCard(card1, result);

  // Show raw response
  document.getElementById('raw-response').textContent = JSON.stringify({
    request1: result.request1.raw_usage,
    request2: result.request2.raw_usage
  }, null, 2);

  // Show curl command
  document.getElementById('curl-command').textContent = result.reproducible_curl;
}

function displayComparisonResult(result) {
  const status = document.getElementById('microscope-status');
  const results = document.getElementById('microscope-results');
  const card1 = document.getElementById('result-model1');
  const card2 = document.getElementById('result-model2');
  const conclusion = document.getElementById('comparison-conclusion');

  status.classList.add('hidden');
  results.classList.remove('hidden');
  card2.classList.remove('hidden');
  conclusion.classList.remove('hidden');

  populateResultCard(card1, result.comparison.model1);
  populateResultCard(card2, result.comparison.model2);

  // Show conclusion
  const conclusionIcon = conclusion.querySelector('.conclusion-icon');
  const conclusionText = conclusion.querySelector('.conclusion-text');

  if (result.summary.model1_caching !== result.summary.model2_caching) {
    conclusionIcon.textContent = '⚠️';
    conclusionText.textContent = result.summary.conclusion;
    conclusion.style.borderColor = 'var(--status-warning)';
    conclusion.style.background = 'rgba(255, 152, 0, 0.1)';
  } else if (result.summary.model1_caching && result.summary.model2_caching) {
    conclusionIcon.textContent = '✓';
    conclusionText.textContent = 'Both models have working prompt caching';
    conclusion.style.borderColor = 'var(--status-good)';
    conclusion.style.background = 'rgba(76, 175, 80, 0.1)';
  } else {
    conclusionIcon.textContent = '✗';
    conclusionText.textContent = 'Neither model shows prompt caching';
    conclusion.style.borderColor = 'var(--status-error)';
    conclusion.style.background = 'rgba(244, 67, 54, 0.1)';
  }

  // Show raw response
  document.getElementById('raw-response').textContent = JSON.stringify({
    model1: {
      request1: result.comparison.model1.request1.raw_usage,
      request2: result.comparison.model1.request2.raw_usage
    },
    model2: {
      request1: result.comparison.model2.request1.raw_usage,
      request2: result.comparison.model2.request2.raw_usage
    }
  }, null, 2);

  // Show curl command for model 1
  document.getElementById('curl-command').textContent = result.comparison.model1.reproducible_curl;
}

function populateResultCard(card, result) {
  const modelName = allModels.find(m => m.model_id === result.model)?.model_name || result.model;

  card.querySelector('.result-model-name').textContent = modelName;

  const verdict = card.querySelector('.result-verdict');
  verdict.setAttribute('data-caching', result.cache_working);
  verdict.textContent = result.cache_working
    ? `✓ CACHING WORKS (${result.cache_hit_rate}%)`
    : '✗ CACHING NOT WORKING';

  card.querySelector('.r1-prompt').textContent = result.request1.prompt_tokens;
  card.querySelector('.r1-cached').textContent = result.request1.cached_tokens;
  card.querySelector('.r2-prompt').textContent = result.request2.prompt_tokens;
  card.querySelector('.r2-cached').textContent = result.request2.cached_tokens;
  card.querySelector('.rate-value').textContent = result.cache_hit_rate + '%';

  // Response times
  const r1Time = result.request1.response_time_ms;
  const r2Time = result.request2.response_time_ms;
  card.querySelector('.r1-time').textContent = r1Time + 'ms';
  card.querySelector('.r2-time').textContent = r2Time + 'ms';

  // Show time difference (cached should be faster)
  const timeDiffEl = card.querySelector('.time-diff');
  if (timeDiffEl && r1Time && r2Time) {
    const diff = r1Time - r2Time;
    const pctFaster = ((diff / r1Time) * 100).toFixed(0);
    if (diff > 0 && result.cache_working) {
      timeDiffEl.textContent = ` (${pctFaster}% faster)`;
      timeDiffEl.className = 'time-diff time-faster';
    } else if (diff < 0) {
      timeDiffEl.textContent = ` (${Math.abs(pctFaster)}% slower)`;
      timeDiffEl.className = 'time-diff time-slower';
    } else {
      timeDiffEl.textContent = '';
    }
  }

  // Color the cached tokens
  const r2CachedEl = card.querySelector('.r2-cached');
  if (result.request2.cached_tokens > 0) {
    r2CachedEl.style.color = 'var(--status-good)';
  } else {
    r2CachedEl.style.color = 'var(--status-error)';
  }
}

function copyCurlToClipboard() {
  const curlCommand = document.getElementById('curl-command').textContent;
  navigator.clipboard.writeText(curlCommand).then(() => {
    const btn = document.getElementById('copy-curl');
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy to Clipboard', 2000);
  }).catch(err => {
    console.error('Failed to copy:', err);
  });
}

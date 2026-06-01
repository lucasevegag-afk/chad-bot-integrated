/**
 * server/services/news/news-collector.js
 *
 * Orquestador:
 *   1. Llama a finnhub-news + twelvedata-news.
 *   2. Calcula impact (low/medium/high) + affected_assets.
 *   3. Dedup contra Supabase.
 *   4. INSERT a tabla `news_events`.
 *   5. Si HIGH → push también a `alerts` (alert_type='macro_event' o 'news').
 *
 * Schema news_events:
 *   id (uuid, default), source (text), title (text), body (text),
 *   affected_assets (text[]), impact (text), event_time (tstz),
 *   ingested_at (tstz, default now())
 */

const { createLogger } = require('../../utils/logger');
const { supabase, pushAlert } = require('../supabase.service');
const finnhub = require('./finnhub-news');
const twelvedata = require('./twelvedata-news');
const { resolveBestImage, buildFallbackImage } = require('./og-image-scraper');

const log = createLogger('news-collector');

// Memoria local de dedup por external_id (ttl ~24h)
const _seen = new Map(); // external_id → timestamp
const _SEEN_TTL_MS = 24 * 3600 * 1000;

function _cleanSeen() {
  const cutoff = Date.now() - _SEEN_TTL_MS;
  for (const [k, ts] of _seen.entries()) if (ts < cutoff) _seen.delete(k);
}

// =================================================================
// SCORING: importance + asset mapping
// =================================================================

// ===== Scoring de impacto =====
// Filosofía: priorizar precisión sobre recall. Mejor perder alguna HIGH genuina
// que spammear al usuario con falsos positivos.
//
// CRITICAL_KW: 1 sola coincidencia en el TÍTULO → HIGH.
// HIGH_KW    : 1 coincidencia en el TÍTULO → HIGH, pero requiere que NO esté
//              en NEG_KW. Términos más ambiguos que CRITICAL.
// MEDIUM_KW  : 1 coincidencia en título o body → MEDIUM.
// NEG_KW     : Si aparece, baja un escalón (HIGH→MEDIUM, MEDIUM→LOW). Sirve
//              para descartar opiniones, análisis técnicos, etc.

const CRITICAL_KW = [
  // Bancos centrales — decisiones de política monetaria
  'fomc', 'federal reserve', 'fed rate decision', 'rate decision',
  'rate hike', 'rate cut', 'emergency rate', 'emergency meeting',
  'ecb meeting', 'boj meeting', 'boe meeting', 'snb meeting',
  'jackson hole',
  // Datos macro core
  'nonfarm payrolls', 'non-farm payrolls', 'nfp report',
  'cpi report', 'inflation data', 'inflation report',
  'gdp report', 'unemployment rate', 'jobless claims',
  'ppi report',
  // Voces clave
  'powell speech', 'powell testimony', 'lagarde speech',
  // Geopolítica crítica
  'declares war', 'invasion of', 'nuclear strike', 'missile strike',
  'ceasefire agreement', 'opec+ cut', 'opec production cut',
];

const HIGH_KW = [
  // Crisis financiera
  'bank collapse', 'bank failure', 'banking crisis', 'sovereign default',
  'bond crash', 'flash crash', 'market crash',
  // Energía
  'oil embargo', 'pipeline attack', 'refinery shutdown',
  // Regulación crypto
  'bitcoin etf approved', 'etf approved', 'sec lawsuit', 'crypto ban',
];

const MEDIUM_KW = [
  'retail sales', 'manufacturing pmi', 'services pmi', 'composite pmi',
  'consumer confidence', 'housing starts', 'building permits',
  'industrial production', 'durable goods', 'trade balance',
  'earnings beat', 'earnings miss', 'guidance cut', 'guidance raised',
  'merger', 'acquisition', 'ipo',
  'fed minutes', 'ecb minutes',
];

// Si alguno aparece, NO subir a HIGH (son análisis/opinión)
const NEG_KW = [
  'analyst', 'forecast', 'prediction', 'opinion', 'op-ed',
  'how to', 'guide to', 'explained', 'tutorial',
  'price prediction', 'could reach', 'might hit', 'expected to',
];

// Compila a regex con word boundaries
function _buildRegex(words) {
  // Usamos lookarounds suaves: comienzo/fin o no-letra
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(^|[^a-z0-9])(${escaped.join('|')})($|[^a-z0-9])`, 'i');
}
const RE_CRITICAL = _buildRegex(CRITICAL_KW);
const RE_HIGH     = _buildRegex(HIGH_KW);
const RE_MEDIUM   = _buildRegex(MEDIUM_KW);
const RE_NEG      = _buildRegex(NEG_KW);

// Asset keyword → símbolo bot
const ASSET_KEYWORDS = [
  { kw: ['btc', 'bitcoin'],          asset: 'BTCUSDT' },
  { kw: ['eth', 'ethereum'],         asset: 'ETHUSDT' },
  { kw: ['gold', 'xau', 'oro'],      asset: 'XAUUSD'  },
  { kw: ['oil', 'wti', 'crude', 'opec'], asset: 'USOIL' },
  { kw: ['nasdaq', 'nas100', 'ndx'], asset: 'NAS100'  },
  { kw: ['s&p', 'sp500', 'spx'],     asset: 'SPX500'  },
  { kw: ['eur', 'euro'],             asset: 'EURUSD'  },
  { kw: ['gbp', 'pound', 'sterling'], asset: 'GBPUSD' },
  { kw: ['jpy', 'yen'],              asset: 'USDJPY'  },
];

// Country → assets afectados (calendario)
const COUNTRY_ASSETS = {
  US: ['XAUUSD', 'USOIL', 'NAS100', 'SPX500', 'EURUSD', 'BTCUSDT'],
  EU: ['EURUSD', 'XAUUSD'],
  UK: ['GBPUSD'],
  JP: ['USDJPY'],
  CN: ['USOIL', 'XAUUSD'],
};

function scoreImpact(item) {
  // 1) Si vino con impactRaw del calendario, respetarlo
  if (item.impactRaw) {
    const r = String(item.impactRaw).toLowerCase();
    if (r === 'high' || r === '3' || r === 'alta') return 'high';
    if (r === 'medium' || r === '2' || r === 'media') return 'medium';
    if (r === 'low' || r === '1' || r === 'baja') return 'low';
  }

  const title = (item.title || '').toLowerCase();
  const body  = (item.body  || '').toLowerCase();
  const full  = `${title} ${body}`;

  const negHit = RE_NEG.test(title);

  // 2) CRITICAL en título → HIGH (no se baja por neg)
  if (RE_CRITICAL.test(title)) return 'high';

  // 3) HIGH en título → HIGH salvo que sea análisis/opinión
  if (RE_HIGH.test(title)) {
    return negHit ? 'medium' : 'high';
  }

  // 4) CRITICAL en body → MEDIUM (no subir solo por body)
  if (RE_CRITICAL.test(body)) return 'medium';

  // 5) MEDIUM en título o body → MEDIUM
  if (RE_MEDIUM.test(full)) return negHit ? 'low' : 'medium';

  return 'low';
}

function detectAssets(item) {
  const set = new Set();
  const text = `${item.title || ''} ${item.body || ''} ${(item.related || []).join(' ')}`.toLowerCase();

  // 1) Keywords del texto
  for (const { kw, asset } of ASSET_KEYWORDS) {
    if (kw.some((k) => text.includes(k))) set.add(asset);
  }

  // 2) País (calendario macro)
  if (item.country) {
    const mapped = COUNTRY_ASSETS[item.country.toUpperCase()] || [];
    for (const a of mapped) set.add(a);
  }

  // 3) Categoría (Finnhub news)
  if (item.category === 'crypto') set.add('BTCUSDT');
  if (item.category === 'forex')  { set.add('EURUSD'); set.add('XAUUSD'); }

  return Array.from(set);
}

function normalize(item) {
  const impact = scoreImpact(item);
  const assets = detectAssets(item);
  const eventTime = item.event_time || item.published_at || new Date();
  return {
    external_id: item.external_id,
    articleUrl: item.url || null,
    fallbackImage: item.image || null,
    category: item.category || '',
    row: {
      source: item.source,
      title: (item.title || '').slice(0, 500),
      body: item.body ? String(item.body).slice(0, 2000) : null,
      affected_assets: assets.length ? assets : null,
      impact,
      event_time: new Date(eventTime).toISOString(),
      url: item.url ? String(item.url).slice(0, 1000) : null,
      // image_url se completa después con la mejor imagen (og:image > finnhub > random)
      image_url: null,
    },
  };
}

// =================================================================
// DEDUP + INSERT
// =================================================================

async function _existsInDb(title, eventTimeIso) {
  if (!supabase) return false;
  try {
    const { data } = await supabase
      .from('news_events')
      .select('id')
      .eq('title', title)
      .eq('event_time', eventTimeIso)
      .limit(1);
    return !!(data && data.length);
  } catch {
    return false;
  }
}

async function _insertEvent(row) {
  if (!supabase) return { ok: false, error: 'supabase not configured' };
  try {
    const { data, error } = await supabase.from('news_events').insert(row).select().single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data?.id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Anti-spam: máximo N alertas HIGH por ciclo, y máximo 1 alerta por activo por ciclo
const MAX_ALERTS_PER_CYCLE = 5;
let _alertsPushedThisCycle = 0;
const _assetsPushedThisCycle = new Set();

function _resetCycleCounters() {
  _alertsPushedThisCycle = 0;
  _assetsPushedThisCycle.clear();
}

async function _pushHighImpactAsAlert(norm) {
  if (norm.row.impact !== 'high') return;
  if (_alertsPushedThisCycle >= MAX_ALERTS_PER_CYCLE) return;

  const assets = norm.row.affected_assets || [];
  if (!assets.length) return;

  // Filtra activos que ya recibieron una alerta este ciclo
  const fresh = assets.filter((a) => !_assetsPushedThisCycle.has(a));
  if (!fresh.length) return;

  // Solo el top-1 activo, para no duplicar
  const asset = fresh[0];
  _assetsPushedThisCycle.add(asset);
  _alertsPushedThisCycle++;

  await pushAlert({
    asset,
    type: norm.category === 'calendar' ? 'macro_event' : 'news',
    level: 'high',
    title: `📰 ${norm.row.title}`,
    message: norm.row.body || 'Evento de alto impacto',
  });
}

/**
 * Procesa un batch de items (mixto news + calendar).
 */
/** Pool con cap de concurrencia para no saturar */
async function parallelLimit(items, fn, limit = 8) {
  let idx = 0;
  const workers = Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (idx < items.length) {
      const i = idx++;
      try { await fn(items[i], i); } catch { /* ignore */ }
    }
  });
  await Promise.all(workers);
}

async function processBatch(items) {
  let inserted = 0, deduped = 0, failed = 0;

  // ─── 1. Filtrar dedup en memoria y DB primero ───
  const fresh = [];
  for (const raw of items) {
    if (!raw || !raw.title) continue;
    const norm = normalize(raw);
    if (norm.external_id && _seen.has(norm.external_id)) { deduped++; continue; }
    const exists = await _existsInDb(norm.row.title, norm.row.event_time);
    if (exists) {
      if (norm.external_id) _seen.set(norm.external_id, Date.now());
      deduped++;
      continue;
    }
    fresh.push(norm);
  }

  // ─── 2. Resolver imágenes en PARALELO (cap 8) ───
  // Cascade: og:image > Finnhub fallback > random Unsplash basado en activo.
  await parallelLimit(fresh, async (norm) => {
    try {
      norm.row.image_url = await resolveBestImage({
        url: norm.articleUrl,
        fallbackImage: norm.fallbackImage,
        seed: norm.external_id || norm.row.title,
        assets: norm.row.affected_assets || [],
        category: norm.category,
      });
    } catch {
      norm.row.image_url = buildFallbackImage(
        norm.external_id || norm.row.title,
        norm.row.affected_assets || [],
        norm.category,
      );
    }
  }, 8);

  // ─── 3. Insertar secuencial (Supabase batch sería mejor pero esto es suficiente) ───
  for (const norm of fresh) {
    const res = await _insertEvent(norm.row);
    if (res.ok) {
      inserted++;
      if (norm.external_id) _seen.set(norm.external_id, Date.now());
      await _pushHighImpactAsAlert(norm).catch(() => {});
    } else {
      failed++;
      log.warn(`Insert falló: ${res.error} · ${norm.row.title.slice(0, 60)}`);
    }
  }

  _cleanSeen();
  return { inserted, deduped, failed };
}

// =================================================================
// CICLOS
// =================================================================

async function runNewsCycle() {
  if (!supabase) {
    log.warn('Supabase no configurado, ciclo de noticias omitido.');
    return;
  }
  _resetCycleCounters();
  const batches = await Promise.all([
    finnhub.fetchMarketNews('general'),
    finnhub.fetchMarketNews('forex'),
    finnhub.fetchMarketNews('crypto'),
    finnhub.fetchMarketNews('merger'),
  ]);
  const items = batches.flat();
  const stats = await processBatch(items);
  log.info(`News cycle: in=${items.length} ins=${stats.inserted} dup=${stats.deduped} fail=${stats.failed}`);
  return stats;
}

async function runCalendarCycle() {
  if (!supabase) return;
  _resetCycleCounters();
  // Twelve Data /economic_calendar requiere plan superior; Finnhub cubre todo.
  // Si en algún momento se habilita el plan, descomentar la línea de twelvedata.
  const [fh /*, td*/] = await Promise.all([
    finnhub.fetchEconomicCalendar(2),
    // twelvedata.fetchEconomicCalendar(2),
  ]);
  const items = [...fh /*, ...td*/];
  const stats = await processBatch(items);
  log.info(`Calendar cycle: in=${items.length} ins=${stats.inserted} dup=${stats.deduped} fail=${stats.failed}`);
  return stats;
}

module.exports = {
  runNewsCycle,
  runCalendarCycle,
  processBatch,
  normalize,
  scoreImpact,
  detectAssets,
};

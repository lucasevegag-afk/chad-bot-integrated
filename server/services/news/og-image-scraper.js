/**
 * server/services/news/og-image-scraper.js
 *
 * Extrae og:image (o twitter:image) del HTML de un artículo.
 * Si falla, devuelve null y el caller decide qué fallback usar.
 *
 * Uso:
 *   const img = await fetchOgImage('https://example.com/article')
 */

const { createLogger } = require('../../utils/logger');
const log = createLogger('og-scraper');

const TIMEOUT_MS = 5000;
const USER_AGENT = 'Mozilla/5.0 (compatible; BIA-NewsBot/1.0; +https://mi-chad-bot.fly.dev)';

/* Trata de extraer la URL de imagen desde el HTML usando varias tags */
function extractImageUrl(html, baseUrl) {
  if (!html || typeof html !== 'string') return null;
  // Limitamos a primeros 50KB para parsear solo el <head>
  const head = html.slice(0, 50000);

  // Patrones a probar en orden de preferencia
  const patterns = [
    // <meta property="og:image" content="..."> o name="og:image"
    /<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i,
    // twitter:image
    /<meta[^>]+(?:property|name)=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']twitter:image(?::src)?["']/i,
    // og:image:url (variante)
    /<meta[^>]+(?:property|name)=["']og:image:url["'][^>]+content=["']([^"']+)["']/i,
  ];

  for (const re of patterns) {
    const match = head.match(re);
    if (match && match[1]) {
      let img = match[1].trim();
      // Decodificar entidades HTML básicas
      img = img.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x2F;/g, '/').replace(/&#39;/g, "'");
      // Resolver URL relativa contra base
      try {
        const abs = new URL(img, baseUrl).toString();
        if (abs.startsWith('http://') || abs.startsWith('https://')) {
          return abs;
        }
      } catch { /* ignore */ }
    }
  }
  return null;
}

/**
 * Fetch + parse og:image de un artículo.
 * Devuelve URL absoluta o null.
 */
async function fetchOgImage(articleUrl) {
  if (!articleUrl || typeof articleUrl !== 'string') return null;
  if (!articleUrl.startsWith('http://') && !articleUrl.startsWith('https://')) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(articleUrl, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);

    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return null;

    const html = await res.text();
    return extractImageUrl(html, articleUrl);
  } catch (err) {
    clearTimeout(timer);
    // Errores comunes: timeout, 403, 429, DNS, etc. — no spamear logs
    if (err.name !== 'AbortError') {
      log.debug(`fetchOgImage ${articleUrl.slice(0, 60)}: ${err.message}`);
    }
    return null;
  }
}

/**
 * Pexels API: busca foto finance-themed por keywords.
 * 200 requests/hour gratis. Devuelve una URL de imagen o null.
 */
const PEXELS_API_KEY = process.env.PEXELS_API_KEY || '';

const ASSET_KEYWORDS = {
  BTCUSDT: 'bitcoin',
  ETHUSDT: 'ethereum cryptocurrency',
  XAUUSD:  'gold bullion',
  EURUSD:  'euro currency',
  USOIL:   'oil refinery',
  NAS100:  'stock market trading',
  SPX500:  'wall street',
  GBPUSD:  'london financial',
  USDJPY:  'tokyo finance',
};

function pickKeywords(assets = [], category = '') {
  for (const a of assets) {
    if (ASSET_KEYWORDS[a]) return ASSET_KEYWORDS[a];
  }
  if (category === 'crypto')   return 'cryptocurrency blockchain';
  if (category === 'forex')    return 'forex currency exchange';
  if (category === 'merger')   return 'business deal corporate';
  if (category === 'calendar') return 'economy finance chart';
  return 'finance business';
}

/* Cache simple en memoria para no quemar requests Pexels */
const _pexelsCache = new Map(); // keywords → { url, ts }
const _PEXELS_CACHE_TTL = 6 * 60 * 60 * 1000; // 6h

async function fetchPexelsImage(keywords, seed = '') {
  if (!PEXELS_API_KEY) return null;
  if (!keywords) return null;

  // Para evitar imagen idéntica entre noticias del mismo activo:
  // pedimos varias y elegimos una pseudo-aleatoria por seed.
  // Cache la lista por keyword.
  const cacheKey = keywords;
  let cached = _pexelsCache.get(cacheKey);
  const now = Date.now();
  if (!cached || now - cached.ts > _PEXELS_CACHE_TTL) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(keywords)}&per_page=15&orientation=landscape`;
      const res = await fetch(url, {
        headers: { Authorization: PEXELS_API_KEY },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        log.warn(`Pexels ${res.status} para "${keywords}"`);
        return null;
      }
      const data = await res.json();
      const photos = (data.photos || []).map(p => p?.src?.large || p?.src?.medium).filter(Boolean);
      if (photos.length === 0) return null;
      cached = { urls: photos, ts: now };
      _pexelsCache.set(cacheKey, cached);
    } catch (err) {
      log.debug(`Pexels error: ${err.message}`);
      return null;
    }
  }

  // Pseudo-random determinístico por seed
  let h = 0;
  for (let i = 0; i < (seed || '').length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0x7fffffff;
  const urls = cached.urls;
  return urls[h % urls.length];
}

/**
 * Fallback final: Picsum random (último recurso si Pexels falla).
 */
// eslint-disable-next-line no-unused-vars
function buildFallbackImage(seed, _assets = [], _category = '') {
  const safeSeed = encodeURIComponent(String(seed || 'default').slice(0, 40));
  return `https://picsum.photos/seed/${safeSeed}/800/420`;
}

/**
 * Estrategia completa: og:image > Finnhub image > fallback random.
 * Devuelve la mejor imagen disponible.
 *
 * @param {object} input
 * @param {string} input.url - URL del artículo
 * @param {string|null} input.fallbackImage - Imagen de Finnhub (puede ser logo)
 * @param {string} input.seed - ID estable
 * @param {string[]} input.assets
 * @param {string} input.category
 */
async function resolveBestImage(input) {
  const { url, fallbackImage, seed, assets = [], category = '' } = input;

  // 1. og:image del artículo (mejor opción: foto real del artículo)
  if (url) {
    const og = await fetchOgImage(url);
    if (og) return og;
  }

  // 2. Finnhub fallback (puede ser foto real o logo del publisher)
  if (fallbackImage) return fallbackImage;

  // 3. Pexels: foto finance-themed según activo o categoría (calendar events caen acá)
  const keywords = pickKeywords(assets, category);
  const pexels = await fetchPexelsImage(keywords, seed);
  if (pexels) return pexels;

  // 4. Picsum random (último recurso si Pexels falla / sin API key)
  return buildFallbackImage(seed, assets, category);
}

module.exports = {
  fetchOgImage,
  fetchPexelsImage,
  buildFallbackImage,
  resolveBestImage,
  pickKeywords,
};

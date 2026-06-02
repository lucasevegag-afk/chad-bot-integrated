/**
 * server/services/supabase.service.js
 *
 * Cliente Supabase para PUSH de alertas del bot a la tabla `alerts`
 * que consume la app chad-alerts-mobile.
 *
 * IMPORTANTE: usa SUPABASE_SERVICE_ROLE_KEY (privilegiada).
 * NUNCA exponer al frontend.
 */

const { createClient } = require('@supabase/supabase-js');
const { createLogger } = require('../utils/logger');

const log = createLogger('supabase');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const PUSH_ENABLED = (process.env.SUPABASE_PUSH_ALERTS || 'true').toLowerCase() !== 'false';

// Cliente (null si faltan credenciales)
let supabase = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  log.info(`Supabase conectado a ${SUPABASE_URL}`);
} else {
  log.warn('Supabase NO configurado. Las alertas no se enviarán a la app mobile.');
}

// Mapeo de activos del bot → símbolos que usa la app mobile
const ASSET_MAP = {
  'BTC/USD':  'BTCUSDT',
  'BTCUSDT':  'BTCUSDT',
  'XAU/USD':  'XAUUSD',
  'XAUUSD':   'XAUUSD',
  'EUR/USD':  'EURUSD',
  'EURUSD':   'EURUSD',
  'USOIL':    'USOIL',
  'WTI':      'USOIL',
  'NAS100':   'NAS100',
};

// Mapeo de tipos del bot → tipos permitidos por la constraint de Supabase
// Allowed: volatility, breakout, fakeout, news, macro_event
const ALLOWED_TYPES = new Set(['volatility', 'breakout', 'fakeout', 'news', 'macro_event']);
const TYPE_MAP = {
  // Trampas (TrapDetector) → fakeout
  LIQUIDITY_SWEEP: 'fakeout',
  FAKE_BREAKOUT:   'fakeout',
  WICK_HUNT:       'fakeout',
  STOP_RUN:        'fakeout',
  SPRING:          'fakeout',
  UPTHRUST:        'fakeout',
  NY_MANIPULATION: 'fakeout',
  SWEEP_RECLAIM:   'fakeout',
  CLUSTER_WICK:    'volatility',
  // BasicSignals → breakout (confirmaciones) / volatility (watches)
  BUY:             'breakout',
  SELL:            'breakout',
  WATCH_LONG:      'volatility',
  WATCH_SHORT:     'volatility',
  // Engines (signalManager) — setups confirmados S1/S2, divergencias D1/D2
  S1:              'breakout',
  S2:              'breakout',
  D1:              'fakeout',
  D2:              'fakeout',
  EXIT:            'volatility',
  // Test
  TEST:            'volatility',
};

// Dedup simple: evitar enviar la misma alerta varias veces
const _recentAlerts = new Map(); // key = asset|type|level → timestamp
const _DEDUP_WINDOW_MS = 60 * 1000; // 1 min

/**
 * Push de una alerta a Supabase.
 *
 * @param {Object} alert - Objeto con shape:
 *   {
 *     asset: "BTC/USD" | "XAU/USD" | ...
 *     type: "FAKE_BREAKOUT" | "BUY" | "SELL" | "WICK_HUNT" | ...
 *     level: "low" | "medium" | "high" | "critical"
 *     title: string
 *     message: string
 *     price?: number
 *     plan?: { entry, sl, tp1, tp2 }
 *     timeframe?: "M5" | "M15"
 *   }
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function pushAlert(alert) {
  if (!PUSH_ENABLED) {
    return { ok: false, error: 'push disabled' };
  }
  if (!supabase) {
    log.warn('Push omitido: Supabase no configurado.');
    return { ok: false, error: 'supabase not configured' };
  }
  if (!alert || !alert.asset || !alert.type) {
    log.warn('Push omitido: alert sin asset/type.', alert);
    return { ok: false, error: 'missing required fields' };
  }

  // Mapear asset al formato mobile
  const assetSymbol = ASSET_MAP[alert.asset] || alert.asset;

  // Mapear el tipo del bot al tipo permitido por Supabase
  const originalType = String(alert.type).toUpperCase();
  let mappedType = TYPE_MAP[originalType];
  if (!mappedType) {
    // Si no está en el mapa, ver si ya es un tipo válido directo (lowercase)
    const lower = String(alert.type).toLowerCase();
    mappedType = ALLOWED_TYPES.has(lower) ? lower : 'volatility'; // fallback
  }

  // Dedup: si la misma alerta se mandó hace <1min, omitir
  const dedupKey = `${assetSymbol}|${originalType}|${alert.level || 'info'}`;
  const lastTs = _recentAlerts.get(dedupKey) || 0;
  if (Date.now() - lastTs < _DEDUP_WINDOW_MS) {
    return { ok: false, error: 'deduped (sent recently)' };
  }

  // Construir narrative (texto que verá el usuario en mobile)
  // Incluimos el tipo original como prefijo para no perder info
  let narrative = alert.title || originalType;
  if (alert.message) {
    narrative = `${alert.title || originalType}: ${alert.message}`;
  }
  // Si el originalType es distinto del mapeado, agregar referencia
  if (originalType !== mappedType.toUpperCase()) {
    narrative = `[${originalType}] ${narrative}`;
  }
  // Si trae plan operativo, agregarlo al narrative
  if (alert.plan) {
    const dec = assetSymbol === 'BTCUSDT' ? 2 : assetSymbol === 'XAUUSD' ? 2 : 4;
    const f = (n) => Number(n).toFixed(dec);
    narrative += ` · Plan: Entry ${f(alert.plan.entry)} · SL ${f(alert.plan.sl)} · TP1 (1:2) ${f(alert.plan.tp1)} · TP2 (1:3) ${f(alert.plan.tp2)}`;
  }

  // Normalizar level — Supabase acepta solo: info, medium, high
  let level = (alert.level || 'medium').toLowerCase();
  if (level === 'low')      level = 'info';     // low → info
  if (level === 'critical') level = 'high';     // critical → high
  if (!['info', 'medium', 'high'].includes(level)) level = 'medium';

  const row = {
    asset_symbol: assetSymbol,
    alert_type: mappedType, // ⭐ usa el tipo MAPEADO (válido para la constraint)
    level,
    narrative,
    created_at: new Date().toISOString(),
  };

  try {
    const { data, error } = await supabase.from('alerts').insert(row).select().single();
    if (error) {
      log.error(`Error insertando alerta: ${error.message}`, { row, error });
      return { ok: false, error: error.message };
    }
    _recentAlerts.set(dedupKey, Date.now());
    // Limpiar dedup viejo
    if (_recentAlerts.size > 200) {
      const cutoff = Date.now() - _DEDUP_WINDOW_MS * 10;
      for (const [k, ts] of _recentAlerts.entries()) {
        if (ts < cutoff) _recentAlerts.delete(k);
      }
    }
    log.info(`Alert push → ${assetSymbol} · ${originalType}→${mappedType} · ${level}`);
    return { ok: true, id: data?.id };
  } catch (err) {
    log.error('Exception en pushAlert:', err);
    return { ok: false, error: err.message };
  }
}

/**
 * Test: insertar una alerta de prueba.
 * Útil para validar credenciales sin esperar al bot.
 */
async function pushTestAlert() {
  return pushAlert({
    asset: 'BTC/USD',
    type: 'TEST',
    level: 'info',
    title: '🧪 Test alert',
    message: 'Conexión Supabase verificada desde el bot.',
  });
}

module.exports = {
  supabase,
  pushAlert,
  pushTestAlert,
  isConfigured: () => !!supabase,
};

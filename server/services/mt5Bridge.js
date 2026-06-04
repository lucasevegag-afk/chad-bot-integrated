/**
 * server/services/mt5Bridge.js
 *
 * Bridge: signalManager → MT5 Python executor (en PC del usuario).
 *
 * Cuando el bot detecta una señal de J3 sobre XAUUSD y estamos en horario válido,
 * envía POST al servidor Python local del usuario (vía ngrok).
 *
 * Env vars necesarias:
 *   MT5_BRIDGE_URL      → https://xxxx.ngrok-free.app
 *   MT5_BRIDGE_TOKEN    → api_token de config.json
 *   MT5_BRIDGE_ENABLED  → '1' para activar
 *
 * Configurables vía env:
 *   MT5_SYMBOL          → símbolo MT5 (default XAUUSD)
 *   MT5_LOT             → lot size (default 0.01)
 *   MT5_ALLOWED_HOURS   → horas UTC permitidas (default 11,12,13,14,16)
 *   MT5_ALLOWED_STRATS  → tipos de señal permitidos (default S1)
 *   MT5_ALLOWED_ASSETS  → activos permitidos (default XAUUSD)
 */

const { signalManager } = require('../bot/signalManager');
const { createLogger } = require('../utils/logger');

const log = createLogger('mt5-bridge');

const URL          = process.env.MT5_BRIDGE_URL || '';
const TOKEN        = process.env.MT5_BRIDGE_TOKEN || '';
const ENABLED      = process.env.MT5_BRIDGE_ENABLED === '1';

const SYMBOL       = process.env.MT5_SYMBOL || 'XAUUSD';
const LOT          = Number(process.env.MT5_LOT || 0.01);
const SL_MULT      = Number(process.env.MT5_SL_MULT || 0.7);    // mismo que J3
const TP_MULT      = Number(process.env.MT5_TP_MULT || 2.5);    // mismo que J3
const ALLOWED_HOURS = new Set((process.env.MT5_ALLOWED_HOURS || '11,12,13,14,16').split(',').map(Number));
const ALLOWED_STRATS = new Set((process.env.MT5_ALLOWED_STRATS || 'S1').split(','));
const ALLOWED_ASSETS = new Set((process.env.MT5_ALLOWED_ASSETS || 'XAUUSD').split(','));

let _started = false;
let _executedCount = 0;
let _rejectedCount = 0;
let _failedCount = 0;

async function postToBridge(body) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${URL}/execute`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${TOKEN}`,
        'ngrok-skip-browser-warning': 'true',   // ⭐ skip ngrok warning si aplica
        'user-agent': 'chad-bot/1.0',
      },
      body: JSON.stringify(body),
    });
    const txt = await res.text();
    let data;
    try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  } finally {
    clearTimeout(timeout);
  }
}

function start() {
  if (_started) return;
  _started = true;

  if (!ENABLED) {
    log.info('🔌 MT5 bridge DESHABILITADO (MT5_BRIDGE_ENABLED != 1)');
    return;
  }
  if (!URL || !TOKEN) {
    log.warn('⚠️ MT5_BRIDGE_URL o MT5_BRIDGE_TOKEN no configurados, bridge no se inicia');
    return;
  }

  log.info(`🟢 MT5 bridge activo`);
  log.info(`   URL: ${URL}`);
  log.info(`   Symbol: ${SYMBOL} · Lot: ${LOT}`);
  log.info(`   Allowed hours UTC: ${[...ALLOWED_HOURS].sort((a,b)=>a-b).join(',')}`);
  log.info(`   Allowed strategies: ${[...ALLOWED_STRATS].join(',')}`);
  log.info(`   Allowed assets: ${[...ALLOWED_ASSETS].join(',')}`);

  signalManager.on('signal_detected', async (sig) => {
    // Filtros
    const hour = new Date().getUTCHours();
    if (!ALLOWED_HOURS.has(hour)) {
      _rejectedCount++;
      log.debug(`⏭️ Skip ${sig.type} ${sig.asset}: hora ${hour} no permitida`);
      return;
    }
    if (!ALLOWED_STRATS.has(sig.type)) {
      _rejectedCount++;
      log.debug(`⏭️ Skip ${sig.type}: estrategia no permitida (allowed: ${[...ALLOWED_STRATS]})`);
      return;
    }
    if (!ALLOWED_ASSETS.has(sig.asset)) {
      _rejectedCount++;
      log.debug(`⏭️ Skip ${sig.asset}: activo no permitido (allowed: ${[...ALLOWED_ASSETS]})`);
      return;
    }

    // Calcular SL/TP basado en el precio del último candle M5 + ATR
    // Como no tenemos ATR en la señal del signalManager directamente, lo pedimos al botStateStore
    // o lo calculamos con un fallback razonable.
    const { botStateStore } = require('../bot/botStateStore');
    const state = botStateStore.ensure(sig.asset);
    const price = state.price;

    if (!price) {
      log.warn(`⚠️ Sin precio para ${sig.asset}, skipping`);
      _failedCount++;
      return;
    }

    // ATR estimado: usar M5 último candle range × 14 (proxy)
    // En producción, mejor pasar ATR explícito desde la estrategia
    const atr = state.atr_m5 || (price * 0.001); // fallback 0.1% si no hay ATR
    const sl = sig.direction === 'long' ? price - SL_MULT * atr : price + SL_MULT * atr;
    const tp = sig.direction === 'long' ? price + TP_MULT * atr : price - TP_MULT * atr;

    const body = {
      symbol: SYMBOL,
      direction: sig.direction,
      lot: LOT,
      sl: Number(sl.toFixed(2)),
      tp: Number(tp.toFixed(2)),
      comment: `${sig.type}-${sig.direction}`,
      magic: 20250603,
    };

    log.info(`📤 Enviando a MT5: ${JSON.stringify(body)}`);
    const result = await postToBridge(body);
    if (result.ok) {
      _executedCount++;
      log.info(`✅ Trade ejecutado · ticket ${result.data.ticket}`);
    } else {
      _failedCount++;
      log.error(`❌ Falló envío: ${JSON.stringify(result)}`);
    }
  });

  log.info(`📊 Bridge listo. Esperando señales...`);
}

function getStats() {
  return {
    enabled: ENABLED,
    url: URL ? URL.replace(/\/\/.*@/, '//***@').slice(0, 60) : null,
    executed: _executedCount,
    rejected: _rejectedCount,
    failed: _failedCount,
  };
}

module.exports = { start, getStats };

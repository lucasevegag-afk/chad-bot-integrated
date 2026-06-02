/**
 * server/services/signalAlertBridge.js
 *
 * Bridge: signalManager (engines internos del bot) → Supabase (tabla alerts).
 *
 * Cada vez que un engine detecta una señal (S1/S2/D1/D2/EXIT) y la pasa
 * por signalManager.submit(), este bridge la replica en Supabase para que
 * aparezca en el feed de Alertas Trading del dashboard.
 *
 * Mapeos:
 *   S1/S2 → breakout (setups confirmados, dirección long/short)
 *   D1/D2 → fakeout  (divergencias / reversals)
 *   EXIT  → volatility
 *
 * Level del bot (1..5) → level Supabase (low/medium/high).
 */

const { signalManager } = require('../bot/signalManager');
const { pushAlert } = require('./supabase.service');
const { createLogger } = require('../utils/logger');

const log = createLogger('signal-bridge');

function mapLevel(botLevel) {
  const n = Number(botLevel) || 1;
  if (n >= 4) return 'high';
  if (n >= 2) return 'medium';
  return 'low';
}

function buildTitle(sig) {
  const dir = (sig.direction || '').toUpperCase();
  const tf = sig.timeframe || '';
  return `${sig.type} ${dir} · ${sig.asset} ${tf}`.trim();
}

function buildMessage(sig) {
  const parts = [];
  if (sig.notes) parts.push(sig.notes);
  if (sig.score != null) parts.push(`Score: ${sig.score}`);
  if (sig.level != null) parts.push(`Nivel: ${sig.level}/5`);
  return parts.join(' · ') || `Señal técnica detectada por el bot scanner`;
}

let _started = false;

function start() {
  if (_started) return;
  _started = true;

  signalManager.on('signal_detected', async (sig) => {
    try {
      const result = await pushAlert({
        asset: sig.asset,
        type: sig.type,            // S1/S2/D1/D2/EXIT → TYPE_MAP en supabase.service
        level: mapLevel(sig.level),
        title: buildTitle(sig),
        message: buildMessage(sig),
        timeframe: sig.timeframe,
        plan: sig.plan || null,
        // metadata extra para context column
        direction: sig.direction,
        score: sig.score,
        bot_level: sig.level,
      });

      if (result.ok) {
        log.info(`📤 Alert pushed: ${sig.asset} ${sig.type} ${sig.direction} → ${result.id}`);
      } else if ((result.error || '').includes('dedup')) {
        // dedup silencioso — es normal
      } else {
        log.warn(`Push falló para ${sig.asset} ${sig.type}: ${result.error}`);
      }
    } catch (err) {
      log.error(`Excepción en bridge: ${err.message}`);
    }
  });

  log.info('Signal → Supabase bridge activo. Las señales del scanner ahora se persisten.');
}

module.exports = { start };

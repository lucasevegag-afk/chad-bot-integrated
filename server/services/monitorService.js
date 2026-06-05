/**
 * server/services/monitorService.js
 *
 * Mantiene en memoria un ring buffer de las últimas señales y ejecuciones
 * para mostrar en la página /monitor.html.
 */

const { signalManager } = require('../bot/signalManager');
const { createLogger } = require('../utils/logger');

const log = createLogger('monitor');

const MAX_HISTORY = 50;

const _recentSignals = [];     // [{ ts, asset, direction, type, score, level, notes }]
const _recentExecutions = [];  // [{ ts, signal, results: [{stratId, ok, ticket, sl, tp}] }]

function _push(arr, item) {
  arr.unshift(item);
  if (arr.length > MAX_HISTORY) arr.length = MAX_HISTORY;
}

function start() {
  signalManager.on('signal_detected', (sig) => {
    _push(_recentSignals, {
      ts: Date.now(),
      asset: sig.asset,
      direction: sig.direction,
      type: sig.type,
      timeframe: sig.timeframe,
      score: sig.score,
      level: sig.level,
      notes: sig.notes,
    });
  });
  log.info('📊 Monitor service activo (tracking signals + executions in-memory)');
}

function recordExecution(signal, results) {
  _push(_recentExecutions, {
    ts: Date.now(),
    signal: {
      asset: signal.asset,
      direction: signal.direction,
      type: signal.type,
    },
    results: results,
  });
}

function getSignals(limit = 20) {
  return _recentSignals.slice(0, limit);
}

function getExecutions(limit = 20) {
  return _recentExecutions.slice(0, limit);
}

function getSummary() {
  const since = Date.now() - 24 * 3600 * 1000;
  const todaySignals = _recentSignals.filter(s => s.ts > since);
  const todayExecutions = _recentExecutions.filter(e => e.ts > since);
  return {
    signals_24h: todaySignals.length,
    executions_24h: todayExecutions.length,
    last_signal: _recentSignals[0] || null,
    last_execution: _recentExecutions[0] || null,
  };
}

module.exports = { start, recordExecution, getSignals, getExecutions, getSummary };

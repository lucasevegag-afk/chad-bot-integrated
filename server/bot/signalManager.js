/**
 * server/bot/signalManager.js
 *
 * Recibe señales de los engines y las orquesta: dedupe, expiración,
 * persistencia en botStateStore y emisión de eventos al WebSocket.
 *
 * Cada señal tiene la forma:
 *   {
 *     id: "uuid",
 *     asset: "BTCUSDT",
 *     timeframe: "5m",
 *     type: "S1" | "S2" | "D1" | "D2" | "EXIT" | ...,
 *     direction: "long" | "short",
 *     score: 0..100,
 *     level: 1..5,
 *     notes: "...",
 *     timestamp: 1710000000000,
 *     expiresAt: 1710000600000
 *   }
 */

const { EventEmitter } = require('events');
const { botStateStore } = require('./botStateStore');
const { createLogger } = require('../utils/logger');

const log = createLogger('signals');

class SignalManager extends EventEmitter {
  constructor() {
    super();
    this.cooldownMs = 5 * 60 * 1000; // 5 min entre señales idénticas
    this.lastEmittedKey = new Map();
  }

  _key(s) {
    return `${s.asset}|${s.timeframe}|${s.type}|${s.direction}`;
  }

  /** Punto de entrada principal — un engine encontró un setup. */
  submit(signal) {
    const key = this._key(signal);
    const now = Date.now();
    const last = this.lastEmittedKey.get(key) || 0;
    if (now - last < this.cooldownMs) return false; // dedupe

    const sig = {
      id: `${signal.asset}-${signal.type}-${now}`,
      timestamp: now,
      expiresAt: now + 15 * 60 * 1000,
      score: 0,
      level: 1,
      ...signal,
    };

    this.lastEmittedKey.set(key, now);
    botStateStore.addSignal(signal.asset, sig);
    log.info(
      `Señal ${sig.type} ${sig.direction} en ${sig.asset}/${sig.timeframe} ` +
      `(level ${sig.level}, score ${sig.score})`
    );
    this.emit('signal_detected', sig);
    return true;
  }

  /** Marca una señal como cerrada/expirada (TP/SL/timeout). */
  close(signalId, reason) {
    log.info(`Cerrando señal ${signalId} (${reason})`);
    this.emit('signal_closed', { signalId, reason });
  }
}

const signalManager = new SignalManager();

module.exports = { signalManager, SignalManager };

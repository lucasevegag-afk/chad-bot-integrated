/**
 * server/bot/botStateStore.js
 *
 * Estado en memoria del bot por activo. Es el "espejo" que consumen
 * los frontends (vía WebSocket) y la API REST.
 *
 * Estructura por activo:
 *   {
 *     asset: "BTCUSDT",
 *     lastPrice: null,
 *     timeframes: { "1m": [], "5m": [], "15m": [] },
 *     botState: { htfBias, tacticalBias, sessionState, manipulationDetected, expansionPhase, isLateralizing },
 *     activeSignals: []
 *   }
 */

const { EventEmitter } = require('events');
const { timeframeStore } = require('../candles/timeframeStore');

const DEFAULT_BOT_STATE = () => ({
  htfBias: 'NEUTRAL',       // bias en H4/H1
  tacticalBias: 'NEUTRAL',  // bias en M15/M5
  sessionState: 'IDLE',     // IDLE | ASIA | LONDON | NY_OPEN | NY_AM | NY_PM | CLOSE
  manipulationDetected: false,
  expansionPhase: false,
  isLateralizing: false,
  lastUpdate: null,
});

class BotStateStore extends EventEmitter {
  constructor() {
    super();
    this.states = new Map();  // symbol → state
  }

  ensure(symbol) {
    if (!this.states.has(symbol)) {
      this.states.set(symbol, {
        asset: symbol,
        lastPrice: null,
        timeframes: { '1m': [], '5m': [], '15m': [] },
        botState: DEFAULT_BOT_STATE(),
        activeSignals: [],
      });
    }
    return this.states.get(symbol);
  }

  setPrice(symbol, price) {
    const st = this.ensure(symbol);
    st.lastPrice = price;
  }

  /** Actualiza el estado lógico del bot (bias, sesión, etc.) */
  updateBotState(symbol, partial) {
    const st = this.ensure(symbol);
    st.botState = { ...st.botState, ...partial, lastUpdate: Date.now() };
    this.emit('bot_state_update', { asset: symbol, botState: st.botState });
  }

  addSignal(symbol, signal) {
    const st = this.ensure(symbol);
    st.activeSignals.push(signal);
    // Limita el array para que no crezca infinito.
    if (st.activeSignals.length > 50) st.activeSignals.shift();
    this.emit('signal_detected', { asset: symbol, signal });
  }

  /**
   * Snapshot serializable. Incluye solo las últimas 100 velas por timeframe
   * para no inflar el JSON.
   */
  getSnapshot(symbol) {
    const st = this.ensure(symbol);
    return {
      asset: st.asset,
      lastPrice: st.lastPrice,
      timeframes: {
        '1m':  timeframeStore.getCandles(symbol, '1m', 100),
        '5m':  timeframeStore.getCandles(symbol, '5m', 100),
        '15m': timeframeStore.getCandles(symbol, '15m', 100),
      },
      botState: st.botState,
      activeSignals: st.activeSignals.slice(-10),
    };
  }

  listSymbols() {
    return Array.from(this.states.keys());
  }
}

const botStateStore = new BotStateStore();

module.exports = { botStateStore, BotStateStore };

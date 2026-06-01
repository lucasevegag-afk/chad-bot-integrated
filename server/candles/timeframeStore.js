/**
 * server/candles/timeframeStore.js
 *
 * Almacén en memoria de las últimas N velas por (activo, timeframe).
 * Estructura: store[symbol][timeframe] = [{open,high,low,close,timestamp,isClosed}, ...]
 *
 * Diseñado para reemplazar fácilmente por Redis/PostgreSQL si la demanda crece.
 */

const DEFAULT_LIMIT = 500;

class TimeframeStore {
  constructor({ limit = DEFAULT_LIMIT } = {}) {
    this.limit = limit;
    this.store = new Map(); // symbol → Map(tf → array)
  }

  _bucket(symbol, tf) {
    if (!this.store.has(symbol)) this.store.set(symbol, new Map());
    const sym = this.store.get(symbol);
    if (!sym.has(tf)) sym.set(tf, []);
    return sym.get(tf);
  }

  /**
   * Inserta o reemplaza la vela en curso.
   * Si la última vela en el bucket tiene el mismo timestamp, se actualiza
   * en lugar de duplicar.
   */
  upsertCandle(symbol, tf, candle) {
    const arr = this._bucket(symbol, tf);
    const last = arr[arr.length - 1];
    if (last && last.timestamp === candle.timestamp) {
      arr[arr.length - 1] = candle;
    } else {
      arr.push(candle);
      if (arr.length > this.limit) arr.shift();
    }
  }

  /** Carga inicial de histórico. */
  seedHistory(symbol, tf, candles) {
    if (!Array.isArray(candles) || candles.length === 0) return;
    const arr = candles.slice(-this.limit);
    if (!this.store.has(symbol)) this.store.set(symbol, new Map());
    this.store.get(symbol).set(tf, arr);
  }

  getCandles(symbol, tf, limit) {
    const arr = this._bucket(symbol, tf);
    if (!limit || limit >= arr.length) return [...arr];
    return arr.slice(-limit);
  }

  getLast(symbol, tf) {
    const arr = this._bucket(symbol, tf);
    return arr[arr.length - 1] || null;
  }

  hasData(symbol, tf) {
    return this._bucket(symbol, tf).length > 0;
  }

  listSymbols() {
    return Array.from(this.store.keys());
  }

  listTimeframes(symbol) {
    const sym = this.store.get(symbol);
    return sym ? Array.from(sym.keys()) : [];
  }
}

const timeframeStore = new TimeframeStore();

module.exports = { timeframeStore, TimeframeStore };

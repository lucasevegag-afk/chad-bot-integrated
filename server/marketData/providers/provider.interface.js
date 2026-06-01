/**
 * server/marketData/providers/provider.interface.js
 *
 * Contrato que todo proveedor de datos de mercado debe cumplir.
 * Permite intercambiar Binance, Twelve Data, Polygon, etc. sin tocar
 * el resto del sistema.
 *
 * Eventos emitidos (EventEmitter):
 *   - 'tick'   → { symbol, price, timestamp }
 *   - 'kline'  → { symbol, timeframe, candle: {open, high, low, close, timestamp, isClosed} }
 *   - 'open'   → { symbol }
 *   - 'close'  → { symbol, reason }
 *   - 'error'  → Error
 */

const { EventEmitter } = require('events');

class MarketDataProvider extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    this.connected = false;
  }

  /** Nombre identificador del proveedor. */
  getName() { return this.name; }

  /** Está actualmente conectado al feed. */
  isConnected() { return this.connected; }

  /**
   * Inicia el stream de un símbolo.
   * @param {string} symbol  Símbolo interno (ej. 'BTCUSDT', 'XAUUSD')
   * @param {string[]} timeframes  Lista de timeframes a streamear
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async subscribe(symbol, timeframes) {
    throw new Error(`subscribe() no implementado en ${this.name}`);
  }

  /** Cierra todas las conexiones. */
  async disconnect() {
    throw new Error(`disconnect() no implementado en ${this.name}`);
  }

  /**
   * Trae velas históricas (REST).
   * @returns {Promise<Array<{open,high,low,close,timestamp}>>}
   */
  // eslint-disable-next-line no-unused-vars
  async getHistory(symbol, timeframe, limit = 300) {
    throw new Error(`getHistory() no implementado en ${this.name}`);
  }
}

module.exports = { MarketDataProvider };

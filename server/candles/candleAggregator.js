/**
 * server/candles/candleAggregator.js
 *
 * Construye y mantiene velas M1, M5, M15 (extensible a M30, H1, H4)
 * a partir de:
 *   (a) ticks de precio (alimentación continua), o
 *   (b) klines del provider (cuando el provider ya emite velas listas).
 *
 * Mantiene la vela en curso actualizada y la cierra al cruzar el límite del
 * timeframe. Persiste todo en `timeframeStore`.
 *
 * Eventos:
 *   - 'candle_update' → { symbol, timeframe, candle, isClosed }
 */

const { EventEmitter } = require('events');
const { timeframeStore } = require('./timeframeStore');
const { alignToTimeframe } = require('../utils/time');
const { createLogger } = require('../utils/logger');

const log = createLogger('candles');

const DEFAULT_TIMEFRAMES = ['1m', '5m', '15m'];

class CandleAggregator extends EventEmitter {
  constructor({ timeframes = DEFAULT_TIMEFRAMES } = {}) {
    super();
    this.timeframes = timeframes;
  }

  /**
   * Procesa un tick (precio + timestamp). Actualiza la vela abierta en cada TF.
   */
  onTick(symbol, price, ts) {
    for (const tf of this.timeframes) {
      const openTs = alignToTimeframe(ts, tf);
      const last = timeframeStore.getLast(symbol, tf);

      if (!last || last.timestamp < openTs) {
        // Cerramos la anterior (si existe) y abrimos una nueva.
        if (last && !last.isClosed) {
          last.isClosed = true;
          timeframeStore.upsertCandle(symbol, tf, last);
          this.emit('candle_update', {
            symbol, timeframe: tf, candle: last, isClosed: true,
          });
        }
        const fresh = {
          open: price, high: price, low: price, close: price,
          volume: 0, timestamp: openTs, isClosed: false,
        };
        timeframeStore.upsertCandle(symbol, tf, fresh);
        this.emit('candle_update', {
          symbol, timeframe: tf, candle: fresh, isClosed: false,
        });
      } else {
        // Actualizamos la vela en curso.
        last.high = Math.max(last.high, price);
        last.low  = Math.min(last.low,  price);
        last.close = price;
        timeframeStore.upsertCandle(symbol, tf, last);
        this.emit('candle_update', {
          symbol, timeframe: tf, candle: last, isClosed: false,
        });
      }
    }
  }

  /**
   * Procesa una kline emitida por el provider (ya construida).
   * Útil cuando el provider entrega velas directamente (caso Binance).
   */
  onKline(symbol, tf, candle) {
    if (!this.timeframes.includes(tf)) return;
    timeframeStore.upsertCandle(symbol, tf, candle);
    this.emit('candle_update', {
      symbol, timeframe: tf, candle, isClosed: !!candle.isClosed,
    });
  }

  /** Carga inicial de histórico para un símbolo + timeframe. */
  seed(symbol, tf, candles) {
    timeframeStore.seedHistory(symbol, tf, candles);
    log.info(`Seed ${symbol}/${tf}: ${candles.length} velas`);
  }
}

const candleAggregator = new CandleAggregator();

module.exports = { candleAggregator, CandleAggregator };

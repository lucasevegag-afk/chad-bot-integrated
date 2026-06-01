/**
 * server/marketData/providers/twelveData.provider.js
 *
 * Provider de Twelve Data para XAU/USD, EUR/USD, WTI, NAS100.
 *
 * El plan gratuito de Twelve Data NO incluye WebSocket en tiempo real,
 * por eso usamos polling vía REST cada N segundos. Dejamos la estructura
 * lista para reemplazar fácilmente por WS cuando se contrate plan superior.
 *
 * - Polling configurable (default 60s para no exceder cuota).
 * - REST de historial vía /time_series.
 *
 * Mapping de símbolos internos → símbolos Twelve Data:
 *   XAUUSD → "XAU/USD"
 *   EURUSD → "EUR/USD"
 *   WTI    → "WTI/USD"
 *   NAS100 → "QQQ"
 */

const https = require('https');
const { MarketDataProvider } = require('./provider.interface');
const { createLogger } = require('../../utils/logger');
const { env } = require('../../config/env');

const log = createLogger('twelvedata');

const TF_TWELVE = {
  '1m':  '1min',
  '5m':  '5min',
  '15m': '15min',
  '30m': '30min',
  '1h':  '1h',
  '4h':  '4h',
  '1d':  '1day',
};

const SYMBOL_MAP = {
  XAUUSD: 'XAU/USD',
  EURUSD: 'EUR/USD',
  WTI:    'WTI/USD',
  NAS100: 'QQQ',
};

class TwelveDataProvider extends MarketDataProvider {
  constructor({ apiKey = env.TWELVE_DATA_API_KEY, pollMs = 60000 } = {}) {
    super('twelvedata');
    this.apiKey = apiKey;
    this.pollMs = pollMs;
    this.subscriptions = new Map(); // key = `${symbol}_${tf}` → { timer, symbol, tf }
  }

  _resolve(symbol) {
    return SYMBOL_MAP[symbol] || symbol;
  }

  async subscribe(symbol, timeframes = ['1m']) {
    if (!this.apiKey) {
      log.warn(`Sin API key — no se puede suscribir a ${symbol}. Configurá TWELVE_DATA_API_KEY.`);
      return;
    }
    for (const tf of timeframes) {
      if (!TF_TWELVE[tf]) {
        log.warn(`Timeframe no soportado: ${tf}`);
        continue;
      }
      const key = `${symbol}_${tf}`;
      if (this.subscriptions.has(key)) continue;

      log.info(`Polling ${symbol} ${tf} cada ${this.pollMs / 1000}s`);

      // Tick inicial inmediato + interval recurrente.
      const tick = () => this._pollOne(symbol, tf).catch((err) => {
        log.error(`Polling ${symbol}/${tf}: ${err.message}`);
      });
      tick();
      const timer = setInterval(tick, this.pollMs);
      this.subscriptions.set(key, { timer, symbol, tf });
      this.connected = true;
      this.emit('open', { symbol });
    }
  }

  async _pollOne(symbol, tf) {
    const candles = await this.getHistory(symbol, tf, 2);
    if (!candles.length) return;
    const last = candles[candles.length - 1];
    this.emit('tick', { symbol, price: last.close, timestamp: Date.now() });
    this.emit('kline', {
      symbol,
      timeframe: tf,
      candle: { ...last, isClosed: true },
    });
  }

  async disconnect() {
    for (const [key, sub] of this.subscriptions.entries()) {
      clearInterval(sub.timer);
      this.subscriptions.delete(key);
    }
    this.connected = false;
    log.info('Polling de Twelve Data detenido');
  }

  async getHistory(symbol, timeframe, limit = 300) {
    if (!this.apiKey) throw new Error('Falta TWELVE_DATA_API_KEY');
    const tdSymbol = this._resolve(symbol);
    const interval = TF_TWELVE[timeframe];
    if (!interval) throw new Error(`Timeframe no soportado: ${timeframe}`);

    const url =
      `https://api.twelvedata.com/time_series` +
      `?symbol=${encodeURIComponent(tdSymbol)}` +
      `&interval=${interval}` +
      `&outputsize=${limit}` +
      `&apikey=${this.apiKey}`;

    const data = await this._fetchJson(url);

    if (data.status === 'error') {
      throw new Error(`Twelve Data: ${data.message || 'error'}`);
    }
    if (!Array.isArray(data.values)) return [];

    // Twelve Data devuelve más reciente primero → invertimos a orden cronológico.
    return data.values
      .map((row) => ({
        timestamp: new Date(row.datetime + 'Z').getTime(),
        open:  parseFloat(row.open),
        high:  parseFloat(row.high),
        low:   parseFloat(row.low),
        close: parseFloat(row.close),
        volume: row.volume ? parseFloat(row.volume) : 0,
        isClosed: true,
      }))
      .reverse();
  }

  _fetchJson(url) {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch (err) { reject(err); }
        });
      }).on('error', reject);
    });
  }
}

module.exports = { TwelveDataProvider };

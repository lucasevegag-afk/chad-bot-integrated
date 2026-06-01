/**
 * server/marketData/providers/binance.provider.js
 *
 * Provider real de Binance vía WebSocket público.
 * - Stream de klines (velas) por símbolo y timeframe.
 * - Reconexión automática con backoff exponencial.
 * - REST de historial vía /api/v3/klines.
 *
 * Endpoint WS: wss://stream.binance.com:9443/ws/<symbol>@kline_<interval>
 * Endpoint REST: https://api.binance.com/api/v3/klines
 */

const WebSocket = require('ws');
const https = require('https');
const { MarketDataProvider } = require('./provider.interface');
const { createLogger } = require('../../utils/logger');

const log = createLogger('binance');

// Mapping interno (1m, 5m, etc.) → string aceptado por Binance.
const TF_BINANCE = {
  '1m':  '1m',
  '5m':  '5m',
  '15m': '15m',
  '30m': '30m',
  '1h':  '1h',
  '4h':  '4h',
  '1d':  '1d',
};

class BinanceProvider extends MarketDataProvider {
  constructor() {
    super('binance');
    this.streams = new Map();   // key = `${symbol}_${tf}` → { ws, retries, alive }
    this.shuttingDown = false;
  }

  async subscribe(symbol, timeframes = ['1m']) {
    const sym = symbol.toLowerCase();
    for (const tf of timeframes) {
      const interval = TF_BINANCE[tf];
      if (!interval) {
        log.warn(`Timeframe no soportado en Binance: ${tf}`);
        continue;
      }
      const key = `${symbol}_${tf}`;
      if (this.streams.has(key)) continue;
      this._openStream(key, sym, interval, symbol, tf);
    }
  }

  _openStream(key, symLower, interval, symbolUpper, tf) {
    const url = `wss://stream.binance.com:9443/ws/${symLower}@kline_${interval}`;
    const entry = { ws: null, retries: 0, alive: true };
    this.streams.set(key, entry);

    const connect = () => {
      if (this.shuttingDown || !this.streams.has(key)) return;
      log.info(`Conectando ${symbolUpper} ${tf} → ${url}`);
      const ws = new WebSocket(url);
      entry.ws = ws;

      ws.on('open', () => {
        entry.retries = 0;
        this.connected = true;
        log.info(`✅ Stream abierto: ${symbolUpper} ${tf}`);
        this.emit('open', { symbol: symbolUpper });
      });

      ws.on('message', (raw) => {
        try {
          const data = JSON.parse(raw.toString());
          const k = data.k;
          if (!k) return;
          const candle = {
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low:  parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
            timestamp: k.t,
            isClosed: !!k.x,
          };
          // Cada update de kline es también un tick implícito.
          this.emit('tick', {
            symbol: symbolUpper,
            price: candle.close,
            timestamp: Date.now(),
          });
          this.emit('kline', {
            symbol: symbolUpper,
            timeframe: tf,
            candle,
          });
        } catch (err) {
          log.error(`Error parseando mensaje ${symbolUpper}/${tf}: ${err.message}`);
        }
      });

      ws.on('close', (code) => {
        this.emit('close', { symbol: symbolUpper, reason: `code=${code}` });
        if (this.shuttingDown || !this.streams.has(key)) return;
        entry.retries += 1;
        const delay = Math.min(30000, 1000 * Math.pow(2, entry.retries));
        log.warn(`Stream cerrado (${symbolUpper}/${tf}). Reintentando en ${delay}ms (intento ${entry.retries})`);
        setTimeout(connect, delay);
      });

      ws.on('error', (err) => {
        log.error(`WS error ${symbolUpper}/${tf}: ${err.message}`);
        this.emit('error', err);
      });
    };

    connect();
  }

  async disconnect() {
    this.shuttingDown = true;
    for (const [key, entry] of this.streams.entries()) {
      try { entry.ws && entry.ws.close(); } catch { /* noop */ }
      this.streams.delete(key);
    }
    this.connected = false;
    log.info('Todos los streams Binance cerrados');
  }

  async getHistory(symbol, timeframe, limit = 300) {
    const interval = TF_BINANCE[timeframe];
    if (!interval) throw new Error(`Timeframe no soportado: ${timeframe}`);
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const data = await this._fetchJson(url);
    if (!Array.isArray(data)) throw new Error('Respuesta inesperada de Binance');
    return data.map((row) => ({
      timestamp: row[0],
      open:  parseFloat(row[1]),
      high:  parseFloat(row[2]),
      low:   parseFloat(row[3]),
      close: parseFloat(row[4]),
      volume: parseFloat(row[5]),
      isClosed: true,
    }));
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

module.exports = { BinanceProvider };

/**
 * server/marketData/marketDataManager.js
 *
 * Orquestador de proveedores. Cada activo está mapeado a un provider.
 * Esta capa permite que el resto del sistema consuma datos sin importar
 * de dónde vienen (Binance, Twelve Data, etc.).
 *
 * Eventos re-emitidos:
 *   - 'tick'   → { symbol, price, timestamp, provider }
 *   - 'kline'  → { symbol, timeframe, candle, provider }
 */

const { EventEmitter } = require('events');
const { BinanceProvider } = require('./providers/binance.provider');
const { TwelveDataProvider } = require('./providers/twelveData.provider');
const { createLogger } = require('../utils/logger');
const { env } = require('../config/env');

const log = createLogger('marketData');

// Catálogo de activos soportados.
const ASSET_CATALOG = {
  BTCUSDT: { name: 'Bitcoin',     provider: 'binance',    pairSymbol: 'BTCUSDT',  decimals: 2 },
  XAUUSD:  { name: 'Gold',        provider: 'twelvedata', pairSymbol: 'XAU/USD',  decimals: 2 },
  EURUSD:  { name: 'EUR/USD',     provider: 'twelvedata', pairSymbol: 'EUR/USD',  decimals: 5 },
  WTI:     { name: 'Petróleo WTI',provider: 'twelvedata', pairSymbol: 'WTI/USD',  decimals: 2 },
  NAS100:  { name: 'Nasdaq',      provider: 'twelvedata', pairSymbol: 'QQQ',      decimals: 2 },
};

class MarketDataManager extends EventEmitter {
  constructor() {
    super();
    this.providers = {};
    this.activeSymbols = new Set();
  }

  init() {
    if (env.BINANCE_WS_ENABLED) {
      this.providers.binance = new BinanceProvider();
      this._wireProvider(this.providers.binance);
    } else {
      log.warn('Binance WS deshabilitado (BINANCE_WS_ENABLED=false)');
    }

    this.providers.twelvedata = new TwelveDataProvider();
    this._wireProvider(this.providers.twelvedata);

    log.info('MarketDataManager listo', {
      providers: Object.keys(this.providers),
    });
  }

  _wireProvider(p) {
    p.on('tick',  (e) => this.emit('tick',  { ...e, provider: p.getName() }));
    p.on('kline', (e) => this.emit('kline', { ...e, provider: p.getName() }));
    p.on('open',  (e) => log.info(`Provider ${p.getName()} abrió ${e.symbol}`));
    p.on('close', (e) => log.warn(`Provider ${p.getName()} cerró ${e.symbol} (${e.reason})`));
    p.on('error', (err) => log.error(`Provider ${p.getName()} error: ${err.message}`));
  }

  getAssetInfo(symbol) {
    return ASSET_CATALOG[symbol] || null;
  }

  listAssets() {
    return Object.entries(ASSET_CATALOG).map(([symbol, info]) => ({
      symbol,
      name: info.name,
      provider: info.provider === 'binance' ? 'Binance' : 'Twelve Data',
      decimals: info.decimals,
    }));
  }

  async subscribe(symbol, timeframes) {
    const info = this.getAssetInfo(symbol);
    if (!info) throw new Error(`Activo no soportado: ${symbol}`);
    const provider = this.providers[info.provider];
    if (!provider) {
      log.warn(`Provider ${info.provider} no inicializado, no se puede suscribir a ${symbol}`);
      return;
    }
    // Para Binance pasamos el par tal cual (BTCUSDT). Para Twelve Data
    // mantenemos la convención interna (XAUUSD) y el provider mappea.
    const effSymbol = info.provider === 'binance' ? info.pairSymbol : symbol;
    await provider.subscribe(effSymbol, timeframes);
    this.activeSymbols.add(symbol);
  }

  async getHistory(symbol, timeframe, limit = 300) {
    const info = this.getAssetInfo(symbol);
    if (!info) throw new Error(`Activo no soportado: ${symbol}`);
    const provider = this.providers[info.provider];
    if (!provider) throw new Error(`Provider no disponible: ${info.provider}`);
    const effSymbol = info.provider === 'binance' ? info.pairSymbol : symbol;
    return provider.getHistory(effSymbol, timeframe, limit);
  }

  async shutdown() {
    for (const p of Object.values(this.providers)) {
      try { await p.disconnect(); } catch (err) { log.error(err.message); }
    }
  }
}

// Singleton
const manager = new MarketDataManager();

module.exports = { manager, ASSET_CATALOG };

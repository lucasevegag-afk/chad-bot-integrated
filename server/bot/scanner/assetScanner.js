/**
 * server/bot/scanner/assetScanner.js
 *
 * SCANNER MULTI-ACTIVO
 *
 * Orquesta el ciclo de vida del bot por cada activo:
 *   1. Carga histórico inicial (vía marketDataManager).
 *   2. Se suscribe al stream en vivo.
 *   3. En cada vela cerrada (o cada N segundos) ejecuta los 5 engines.
 *   4. Combina los resultados, actualiza botStateStore y emite señales.
 *
 * Diseñado para que activos como BTCUSDT (Binance WS) y XAUUSD (Twelve Data
 * polling) corran en paralelo sin bloquearse.
 */

const { manager: marketData } = require('../../marketData/marketDataManager');
const { candleAggregator } = require('../../candles/candleAggregator');
const { timeframeStore } = require('../../candles/timeframeStore');
const { botStateStore } = require('../botStateStore');
const { signalManager } = require('../signalManager');
const { createLogger } = require('../../utils/logger');

// Engines individuales: el scanner solo los usa para alimentar botStateStore
// (UI muestra bias/session/lateralization). La señal real vive en s1Strategy.
const biasEngine     = require('../engines/biasEngine');
const sessionFlow    = require('../engines/sessionFlowEngine');
const nyManip        = require('../engines/nyManipulationEngine');
const lateralization = require('../engines/lateralizationEngine');
const s1Strategy     = require('../strategies/s1Strategy');

const log = createLogger('scanner');

const SCANNED_TFS = ['1m', '5m', '15m'];
const SEED_TFS    = ['5m', '15m', '1h', '4h']; // para bias HTF
const SEED_LIMIT  = 300;
const SCAN_INTERVAL_MS = 15 * 1000;

class AssetScanner {
  constructor() {
    this.running = false;
    this.assets = [];
    this.scanTimer = null;
  }

  async start(assets = []) {
    if (this.running) return;
    this.running = true;
    this.assets = assets;
    log.info(`Iniciando scanner para: ${assets.join(', ')}`);

    // Cableado: del marketData → aggregator → botState
    marketData.on('tick', ({ symbol, price, timestamp }) => {
      botStateStore.setPrice(symbol, price);
      candleAggregator.onTick(symbol, price, timestamp);
    });

    marketData.on('kline', ({ symbol, timeframe, candle }) => {
      candleAggregator.onKline(symbol, timeframe, candle);
    });

    // 1) Seed histórico + suscripción en vivo por cada activo.
    for (const symbol of assets) {
      botStateStore.ensure(symbol);
      try {
        await this._seedHistory(symbol);
        await marketData.subscribe(symbol, SCANNED_TFS);
      } catch (err) {
        log.error(`No se pudo iniciar ${symbol}: ${err.message}`);
      }
    }

    // 2) Loop de scan periódico (los engines se ejecutan cada SCAN_INTERVAL_MS).
    this.scanTimer = setInterval(() => this._scanAll(), SCAN_INTERVAL_MS);
    log.info(`Scanner running (loop cada ${SCAN_INTERVAL_MS / 1000}s)`);
  }

  async _seedHistory(symbol) {
    for (const tf of SEED_TFS) {
      try {
        const candles = await marketData.getHistory(symbol, tf, SEED_LIMIT);
        candleAggregator.seed(symbol, tf, candles);
      } catch (err) {
        log.warn(`Seed ${symbol}/${tf} falló: ${err.message}`);
      }
    }
  }

  _scanAll() {
    for (const symbol of this.assets) {
      try {
        this._scanOne(symbol);
      } catch (err) {
        log.error(`Scan ${symbol} error: ${err.message}`);
      }
    }
  }

  _scanOne(symbol) {
    const candlesByTf = {
      '1m':  timeframeStore.getCandles(symbol, '1m'),
      '5m':  timeframeStore.getCandles(symbol, '5m'),
      '15m': timeframeStore.getCandles(symbol, '15m'),
      '1h':  timeframeStore.getCandles(symbol, '1h'),
      '4h':  timeframeStore.getCandles(symbol, '4h'),
    };

    // No vale la pena scanear si todavía no hay datos.
    if ((candlesByTf['5m'] || []).length < 30) return;

    // Evaluar engines individuales para alimentar botStateStore (UI).
    // La emisión de señal vive en s1Strategy (mismo módulo que usa el backtest).
    const bias    = biasEngine.evaluate({ symbol, candlesByTf });
    const session = sessionFlow.evaluate({ symbol });
    const ny      = nyManip.evaluate({ symbol, candlesByTf });
    const lat     = lateralization.evaluate({ symbol, candlesByTf, timeframe: '5m' });

    botStateStore.updateBotState(symbol, {
      htfBias: bias.htfBias,
      tacticalBias: bias.tacticalBias,
      sessionState: session.sessionState,
      manipulationDetected: ny.manipulationDetected,
      expansionPhase: ny.reversalConfirmed === true,
      isLateralizing: lat.isLateralizing,
    });

    // ─── Estrategia S1: lógica unificada live + backtest ───
    const signal = s1Strategy.evaluate({ symbol, candlesByTf });
    if (signal) {
      signalManager.submit({
        asset: symbol,
        timeframe: signal.timeframe,
        type: signal.type,
        direction: signal.direction,
        level: signal.level,
        score: signal.score,
        notes: signal.notes,
      });
    }
  }

  async stop() {
    if (this.scanTimer) clearInterval(this.scanTimer);
    this.scanTimer = null;
    this.running = false;
    log.info('Scanner detenido');
  }

  getStatus() {
    return {
      scannerRunning: this.running,
      assets: this.assets,
      activeSignals: this.assets.flatMap((a) =>
        botStateStore.ensure(a).activeSignals.slice(-5)
      ),
    };
  }
}

const assetScanner = new AssetScanner();

module.exports = { assetScanner, AssetScanner };

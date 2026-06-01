/**
 * server/websocket/websocketServer.js
 *
 * Servidor WebSocket propio (path: /ws).
 *
 * Mensajes que el cliente puede enviar:
 *   { action: "subscribe",   asset: "BTCUSDT", timeframes: ["1m","5m"] }
 *   { action: "unsubscribe", asset: "BTCUSDT" }
 *   { action: "ping" }
 *
 * Eventos que el servidor emite:
 *   { type: "system_status",    status: "online", timestamp }
 *   { type: "price_update",     asset, price, timestamp }
 *   { type: "candle_update",    asset, timeframe, candle }
 *   { type: "bot_state_update", asset, botState, timestamp }
 *   { type: "signal_detected",  asset, signal, timestamp }
 *
 * Cada cliente lleva un Set `subs` de activos suscriptos.
 */

const WebSocket = require('ws');
const { broadcast, sendTo } = require('./broadcast');
const { manager: marketData } = require('../marketData/marketDataManager');
const { candleAggregator } = require('../candles/candleAggregator');
const { botStateStore } = require('../bot/botStateStore');
const { signalManager } = require('../bot/signalManager');
const { createLogger } = require('../utils/logger');

const log = createLogger('ws');

class ChadWebSocketServer {
  constructor() {
    this.wss = null;
    this.clients = new Set();
    this.heartbeat = null;
  }

  attach(httpServer) {
    this.wss = new WebSocket.Server({ server: httpServer, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      ws.isAlive = true;
      ws.subs = new Set(); // activos suscriptos
      this.clients.add(ws);
      const ip = req.socket.remoteAddress;
      log.info(`Cliente conectado (${this.clients.size} totales) — ${ip}`);

      sendTo(ws, {
        type: 'system_status',
        status: 'online',
        timestamp: Date.now(),
      });

      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('message', (raw) => this._onMessage(ws, raw));
      ws.on('close', () => {
        this.clients.delete(ws);
        log.info(`Cliente desconectado (${this.clients.size} totales)`);
      });
      ws.on('error', (err) => log.warn(`Cliente error: ${err.message}`));
    });

    // Ping/pong para mantener conexiones vivas y descartar zombies.
    this.heartbeat = setInterval(() => {
      for (const ws of this.clients) {
        if (!ws.isAlive) { try { ws.terminate(); } catch { /* noop */ } continue; }
        ws.isAlive = false;
        try { ws.ping(); } catch { /* noop */ }
      }
    }, 30000);

    this._wireSources();
    log.info('WebSocket server escuchando en /ws');
  }

  _onMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch {
      sendTo(ws, { type: 'error', message: 'JSON inválido' });
      return;
    }
    switch (msg.action) {
      case 'subscribe':
        if (typeof msg.asset === 'string') {
          ws.subs.add(msg.asset);
          sendTo(ws, { type: 'subscribed', asset: msg.asset });
        }
        break;
      case 'unsubscribe':
        if (typeof msg.asset === 'string') {
          ws.subs.delete(msg.asset);
          sendTo(ws, { type: 'unsubscribed', asset: msg.asset });
        }
        break;
      case 'ping':
        sendTo(ws, { type: 'pong', timestamp: Date.now() });
        break;
      default:
        sendTo(ws, { type: 'error', message: 'action desconocida' });
    }
  }

  _wireSources() {
    // Ticks → price_update
    marketData.on('tick', ({ symbol, price, timestamp }) => {
      this._broadcastForAsset(symbol, {
        type: 'price_update',
        asset: symbol,
        price,
        timestamp,
      });
    });

    // Velas → candle_update
    candleAggregator.on('candle_update', ({ symbol, timeframe, candle }) => {
      this._broadcastForAsset(symbol, {
        type: 'candle_update',
        asset: symbol,
        timeframe,
        candle,
      });
    });

    // Estado del bot → bot_state_update
    botStateStore.on('bot_state_update', ({ asset, botState }) => {
      this._broadcastForAsset(asset, {
        type: 'bot_state_update',
        asset,
        botState,
        timestamp: Date.now(),
      });
    });

    // Señales → signal_detected
    signalManager.on('signal_detected', (signal) => {
      this._broadcastForAsset(signal.asset, {
        type: 'signal_detected',
        asset: signal.asset,
        signal,
        timestamp: Date.now(),
      });
    });
  }

  _broadcastForAsset(asset, payload) {
    broadcast(this.clients, payload, (c) => c.subs.size === 0 || c.subs.has(asset));
  }

  isOnline() {
    return this.wss !== null;
  }

  shutdown() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.wss) {
      for (const c of this.clients) { try { c.close(); } catch { /* noop */ } }
      this.wss.close();
    }
  }
}

const wsServer = new ChadWebSocketServer();

module.exports = { wsServer, ChadWebSocketServer };

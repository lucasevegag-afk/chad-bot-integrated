/**
 * server/services/alertService.js
 *
 * Servicio de alertas. Por ahora solo loguea localmente y guarda en memoria.
 * Punto de extensión para integrar más adelante:
 *   - email (Resend / SendGrid)
 *   - Telegram bot
 *   - push notifications
 *   - SMS (Twilio)
 *
 * Cómo usarlo:
 *   alertService.fire({ userId, level: 'signal', message: '...', payload })
 */

const { createLogger } = require('../utils/logger');
const log = createLogger('alerts');

class AlertService {
  constructor() {
    this.history = []; // [{ ts, level, message, payload }]
    this.limit = 1000;
  }

  fire({ level = 'info', message, payload }) {
    const item = { ts: Date.now(), level, message, payload };
    this.history.push(item);
    if (this.history.length > this.limit) this.history.shift();
    log.info(`[${level.toUpperCase()}] ${message}`);
    // TODO: enviar a canales externos según level/userId.
    return item;
  }

  recent(n = 50) {
    return this.history.slice(-n);
  }
}

const alertService = new AlertService();

module.exports = { alertService };

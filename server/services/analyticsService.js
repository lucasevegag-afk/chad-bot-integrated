/**
 * server/services/analyticsService.js
 *
 * Tracking interno: visitas, eventos clave (quiz_completed, ebook_clicked,
 * payment_initiated, etc.). Por ahora en memoria — listo para enchufar
 * más adelante a PostHog, Plausible o BD propia.
 *
 * Endpoint público recomendado: POST /api/analytics/event
 */

const { createLogger } = require('../utils/logger');
const log = createLogger('analytics');

class AnalyticsService {
  constructor() {
    this.events = [];          // {ts, event, props, ip, ua}
    this.counters = new Map(); // event → count
    this.limit = 5000;
  }

  track({ event, props = {}, ip, ua }) {
    if (!event || typeof event !== 'string') return null;
    const item = { ts: Date.now(), event, props, ip, ua };
    this.events.push(item);
    if (this.events.length > this.limit) this.events.shift();
    this.counters.set(event, (this.counters.get(event) || 0) + 1);
    log.debug(`event=${event}`, props);
    return item;
  }

  summary() {
    return {
      totalEvents: this.events.length,
      counters: Object.fromEntries(this.counters),
    };
  }

  recent(n = 100) {
    return this.events.slice(-n);
  }
}

const analyticsService = new AnalyticsService();

module.exports = { analyticsService };

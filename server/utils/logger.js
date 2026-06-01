/**
 * server/utils/logger.js
 *
 * Logger minimalista con niveles, timestamps ISO y colores ANSI en terminal.
 * No depende de librerías externas para mantener el bundle liviano.
 */

const { env } = require('../config/env');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const ACTIVE = LEVELS[env.LOG_LEVEL] || LEVELS.info;

const COLORS = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  reset: '\x1b[0m',
  gold: '\x1b[33m',
};

function format(level, scope, msg, extra) {
  const ts = new Date().toISOString();
  const color = COLORS[level] || '';
  const tag = `${color}[${level.toUpperCase()}]${COLORS.reset}`;
  const scopeTag = scope ? `${COLORS.gold}[${scope}]${COLORS.reset}` : '';
  const extraStr = extra !== undefined ? ` ${typeof extra === 'string' ? extra : JSON.stringify(extra)}` : '';
  return `${ts} ${tag} ${scopeTag} ${msg}${extraStr}`;
}

function log(level, scope, msg, extra) {
  if (LEVELS[level] < ACTIVE) return;
  const line = format(level, scope, msg, extra);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function createLogger(scope) {
  return {
    debug: (msg, extra) => log('debug', scope, msg, extra),
    info:  (msg, extra) => log('info',  scope, msg, extra),
    warn:  (msg, extra) => log('warn',  scope, msg, extra),
    error: (msg, extra) => log('error', scope, msg, extra),
  };
}

module.exports = { createLogger };

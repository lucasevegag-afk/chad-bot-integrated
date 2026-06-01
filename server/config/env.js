/**
 * server/config/env.js
 *
 * Centraliza la carga y validación de variables de entorno.
 * Todas las claves sensibles (API keys, secrets) se leen de aquí — nunca
 * se exponen al frontend ni se hardcodean en HTML.
 */

require('dotenv').config();

const env = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN || '*',

  // Proveedores de datos de mercado
  TWELVE_DATA_API_KEY: process.env.TWELVE_DATA_API_KEY || '',
  BINANCE_WS_ENABLED: (process.env.BINANCE_WS_ENABLED || 'true').toLowerCase() === 'true',

  // Scanner
  SCANNER_ASSETS: (process.env.SCANNER_ASSETS || 'BTCUSDT,XAUUSD')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Logger
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
};

function summarize() {
  return {
    PORT: env.PORT,
    NODE_ENV: env.NODE_ENV,
    BINANCE_WS_ENABLED: env.BINANCE_WS_ENABLED,
    TWELVE_DATA_API_KEY: env.TWELVE_DATA_API_KEY ? '***configurada***' : '(vacía)',
    SCANNER_ASSETS: env.SCANNER_ASSETS,
    LOG_LEVEL: env.LOG_LEVEL,
  };
}

module.exports = { env, summarize };

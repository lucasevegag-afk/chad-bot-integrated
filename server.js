/**
 * server.js — Punto de entrada de Chad Inversor Platform.
 *
 * Bootstrap:
 *   1. Express + middleware (CORS, JSON, static files con compat de paths legacy).
 *   2. Rutas API.
 *   3. Servidor HTTP + WebSocket en el mismo puerto.
 *   4. Inicializa marketDataManager + assetScanner para BTCUSDT y XAUUSD.
 */

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');

const { env, summarize } = require('./server/config/env');
const { createLogger } = require('./server/utils/logger');

const healthRoutes    = require('./server/routes/health.routes');
const pagesRoutes     = require('./server/routes/pages.routes');
const botRoutes       = require('./server/routes/bot.routes');
const marketRoutes    = require('./server/routes/market.routes');
const analyticsRoutes = require('./server/routes/analytics.routes');
const alertsRoutes    = require('./server/routes/alerts.routes');
const photoRoutes     = require('./server/routes/photoRoutes');
const usersRoutes     = require('./server/routes/users.routes');

const { manager: marketData } = require('./server/marketData/marketDataManager');
const { assetScanner } = require('./server/bot/scanner/assetScanner');
const { wsServer } = require('./server/websocket/websocketServer');
const newsFetcher = require('./server/services/news/news-fetcher');
const signalAlertBridge = require('./server/services/signalAlertBridge');

const log = createLogger('boot');
const app = express();

// ============= Middleware =============
app.use(cors({
  origin: env.FRONTEND_ORIGIN === '*' ? true : env.FRONTEND_ORIGIN,
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ============= Compat de paths estáticos =============
// El sitio actual usa prefijos como `img/`, `botimg/`, `psychoimgypdf/`, `pdf/`
// que en Vercel se rewrite-aban a la raíz. Replico ese comportamiento mapeando
// todos esos prefijos a la carpeta real /public/img.
const PUBLIC_DIR = path.join(__dirname, 'public');
const IMG_DIR    = path.join(PUBLIC_DIR, 'img');

app.use('/img',           express.static(IMG_DIR));
app.use('/botimg',        express.static(IMG_DIR));   // alias usado por bot.html
app.use('/psychoimgypdf', express.static(IMG_DIR));   // alias usado por psychology.html
app.use('/pdf',           express.static(IMG_DIR));   // alias usado por academy.html
app.use('/assets',        express.static(path.join(PUBLIC_DIR, 'assets')));
app.use('/css',           express.static(path.join(PUBLIC_DIR, 'css')));
app.use('/js',            express.static(path.join(PUBLIC_DIR, 'js')));

// ============= Rutas API =============
app.use('/api', healthRoutes);
app.use('/api/bot', botRoutes);
app.use('/api', marketRoutes);
app.use('/api', analyticsRoutes);
app.use('/api', usersRoutes);
app.use('/api', alertsRoutes); // ⭐ Push de alertas a Supabase / chad-alerts-mobile
app.use('/api', photoRoutes);  // 📸 Proxy a Pexels para imágenes finanzas

// ============= Rutas limpias de páginas =============
app.use('/', pagesRoutes);

// ============= Static fallback =============
// Permite que index.html, academy.html, etc. SIGAN siendo accesibles por su
// nombre original. Así no rompemos ningún link interno existente.
app.use(express.static(PUBLIC_DIR));

// 404 handler para todo lo que cae fuera de /api y archivos estáticos.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint no encontrado' });
  }
  res.status(404).sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ============= Bootstrap servidor =============
const httpServer = http.createServer(app);

function attachShutdown() {
  const stop = async (sig) => {
    log.info(`Recibido ${sig}, cerrando...`);
    wsServer.shutdown();
    newsFetcher.stop();
    await assetScanner.stop().catch(() => {});
    await marketData.shutdown().catch(() => {});
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT',  () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

async function main() {
  log.info('Iniciando Chad Inversor Platform...');
  log.info('Config:', summarize());

  // 1) Adjunta WebSocket al mismo servidor HTTP (puerto único, ideal para Render).
  wsServer.attach(httpServer);

  // 2) Inicializa providers de market data.
  marketData.init();

  // 3) Arranca el scanner con los activos definidos por env.
  await assetScanner.start(env.SCANNER_ASSETS);

  // 3.1) Bridge: replica señales internas del bot a Supabase (tabla alerts)
  //      para que aparezcan en el feed de Alertas Trading del dashboard.
  signalAlertBridge.start();

  // 3.5) Arranca el fetcher de noticias + calendario macro.
  newsFetcher.start();

  // 4) Levanta el servidor HTTP.
  httpServer.listen(env.PORT, () => {
    log.info(`🚀 Servidor escuchando en http://localhost:${env.PORT}`);
    log.info(`   • Web:        http://localhost:${env.PORT}/`);
    log.info(`   • Quiz:       http://localhost:${env.PORT}/quiz`);
    log.info(`   • Academy:    http://localhost:${env.PORT}/academy`);
    log.info(`   • Bot:        http://localhost:${env.PORT}/bot`);
    log.info(`   • Health:     http://localhost:${env.PORT}/api/health`);
    log.info(`   • WebSocket:  ws://localhost:${env.PORT}/ws`);
  });

  attachShutdown();
}

main().catch((err) => {
  log.error(`Fallo en startup: ${err.stack || err.message}`);
  process.exit(1);
});

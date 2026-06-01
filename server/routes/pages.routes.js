/**
 * server/routes/pages.routes.js
 *
 * Rutas limpias para servir las páginas HTML estáticas.
 * Mapping:
 *   GET /             → index.html
 *   GET /quiz         → index.html (la home ES el quiz)
 *   GET /chadwhat     → index.html (compat)
 *   GET /academy      → academy.html
 *   GET /bot          → indexbot_3.html  ← versión completa del bot
 *   GET /chadbot      → indexbot_3.html  (alias)
 *   GET /news         → noticias.html
 *   GET /noticias     → noticias.html
 *   GET /psicologia   → psychology.html
 *   GET /sesiones     → sesiones.html
 *   GET /pagos        → pagos.html
 *   GET /login        → login.html
 *   GET /activar      → activar.html
 *
 * Los enlaces a .html existentes en el HTML actual SIGUEN funcionando porque
 * Express los sirve directamente desde /public.
 */

const path = require('path');
const { Router } = require('express');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

function serve(file) {
  return (_req, res) => res.sendFile(path.join(PUBLIC_DIR, file));
}

const router = Router();

router.get('/',          serve('index.html'));
router.get('/quiz',      serve('index.html'));
router.get('/chadwhat',  serve('index.html'));

router.get('/academy',   serve('academy.html'));

// El bot "super" es indexbot_3.html (versión completa con todos los engines).
// La versión simple histórica sigue accesible como /bot-classic.
router.get('/bot',         serve('indexbot_3.html'));
router.get('/chadbot',     serve('indexbot_3.html'));
router.get('/bot-classic', serve('bot.html'));
router.get('/bot-v9',      serve('chad_bot_V9.html'));

router.get('/news',       serve('noticias.html'));
router.get('/noticias',   serve('noticias.html'));
router.get('/psicologia', serve('psychology.html'));
router.get('/psychology', serve('psychology.html'));
router.get('/sesiones',   serve('sesiones.html'));
router.get('/pagos',      serve('pagos.html'));
router.get('/login',      serve('login.html'));
router.get('/activar',    serve('activar.html'));

module.exports = router;

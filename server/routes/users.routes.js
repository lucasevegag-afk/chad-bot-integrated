/**
 * server/routes/users.routes.js
 *
 * Esqueleto. Listo para crecer cuando se incorpore auth real / pagos.
 *
 * POST /api/users/register   → registra un usuario (placeholder)
 * GET  /api/users/me         → datos del usuario autenticado (requiere token)
 */

const { Router } = require('express');
const { authService } = require('../services/authService');

const router = Router();

router.post('/users/register', (req, res) => {
  const { email, planLevel } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Falta email' });
  const user = authService.register({ email, planLevel });
  const token = authService.issueToken(user.id);
  res.json({ user, token });
});

router.get('/users/me', authService.middleware(), (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'No autenticado' });
  res.json({ user: req.user });
});

module.exports = router;

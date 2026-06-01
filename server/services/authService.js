/**
 * server/services/authService.js
 *
 * Capa de autenticación. Esqueleto preparado para evolucionar a:
 *   - JWT (jsonwebtoken)
 *   - sesiones con cookies httpOnly
 *   - integración con Supabase / Auth0 / Firebase Auth
 *   - magic links por email
 *
 * Por ahora ofrece una API mínima que el resto del proyecto puede importar
 * sin acoplarse a una implementación concreta.
 */

const crypto = require('crypto');
const { createLogger } = require('../utils/logger');
const log = createLogger('auth');

const users = new Map();    // userId → { id, email, planLevel, createdAt }
const tokens = new Map();   // token → userId (in-memory, NO usar en prod tal cual)

function _randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}

const authService = {
  /** Registra un usuario. En prod: hashear password, validar email, etc. */
  register({ email, planLevel = 0 }) {
    const id = _randomToken(8);
    const user = { id, email, planLevel, createdAt: Date.now() };
    users.set(id, user);
    log.info(`Usuario registrado ${email} (id=${id})`);
    return user;
  },

  /** Crea un token (en prod usar JWT firmado). */
  issueToken(userId) {
    const t = _randomToken();
    tokens.set(t, userId);
    return t;
  },

  /** Valida un token y devuelve el user o null. */
  verifyToken(token) {
    const userId = tokens.get(token);
    return userId ? users.get(userId) : null;
  },

  /** Middleware Express opcional. */
  middleware() {
    return (req, res, next) => {
      const auth = req.headers.authorization || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
      req.user = token ? this.verifyToken(token) : null;
      next();
    };
  },

  /** Solo dev: lista usuarios actuales. */
  _debugUsers() {
    return Array.from(users.values());
  },
};

module.exports = { authService };

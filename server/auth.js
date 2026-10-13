import crypto from 'node:crypto';
import { IS_PRODUCTION } from './env.js';
import { q, now } from './db.js';
import { AppError, sha256 } from './util.js';

const SESSION_DAYS = 7;
export const COOKIE = 'arbol_sid';

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  await q('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, expires);
  await q('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), userId);
  return { token, expires };
}

export async function destroySession(token) {
  if (token) await q('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Carga el usuario de la sesión (si existe) con sus ámbitos de cabeza. */
export async function loadUser(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  req.sessionToken = token;
  req.user = null;
  if (token) {
    const row = await q(`SELECT u.id, u.username, u.display_name, u.role, u.person_id, u.status
                     FROM sessions s JOIN users u ON u.id = s.user_id
                    WHERE s.token_hash = ? AND s.expires_at > ?`).get(sha256(token), now());
    if (row && row.status === 'active') {
      const heads = (await q('SELECT head_id FROM user_head_scopes WHERE user_id = ?').all(row.id)).map((r) => r.head_id);
      let person = null;
      if (row.person_id) {
        person = await q('SELECT id, head_id, path, is_leader, status FROM people WHERE id = ?').get(row.person_id);
      }
      req.user = { ...row, headIds: heads, person };
    }
  }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new AppError(401, 'UNAUTHENTICATED', 'Debe iniciar sesión.'));
  next();
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new AppError(401, 'UNAUTHENTICATED', 'Debe iniciar sesión.'));
    if (!roles.includes(req.user.role)) return next(new AppError(403, 'FORBIDDEN', 'No tiene permisos para esta sección.'));
    next();
  };
}

export function setSessionCookie(res, token, expires) {
  const secure = IS_PRODUCTION && process.env.INSECURE_COOKIES !== '1' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expires).toUTCString()}${secure}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** Limitador de peticiones en memoria por clave (IP + ruta). */
export function rateLimit({ windowMs, max, key = (req) => req.ip }) {
  const hits = new Map();
  return (req, _res, next) => {
    if (process.env.DISABLE_RATE_LIMIT === '1') return next();
    const k = key(req);
    const t = Date.now();
    let e = hits.get(k);
    if (!e || e.reset < t) { e = { count: 0, reset: t + windowMs }; hits.set(k, e); }
    e.count++;
    if (hits.size > 10000) for (const [kk, v] of hits) if (v.reset < t) hits.delete(kk);
    if (e.count > max) return next(new AppError(429, 'RATE_LIMITED', 'Demasiados intentos. Espere unos minutos e inténtelo de nuevo.'));
    next();
  };
}

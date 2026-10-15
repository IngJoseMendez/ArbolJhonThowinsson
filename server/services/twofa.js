// Verificación en dos pasos de las cuentas: activación, desactivación, códigos de recuperación y el segundo paso
// del inicio de sesión.
import crypto from 'node:crypto';
import { q, now } from '../db.js';
import { AppError, badRequest, sha256 } from '../util.js';
import { verifyPassword } from '../auth.js';
import { audit } from './audit.js';
import {
  ISSUER, newSecret, otpauthUri, verifyTotp, sealSecret, openSecret, newRecoveryCodes, normalizeRecovery, recoveryHash, RECOVERY_LENGTH,
} from '../totp.js';

const CHALLENGE_MINUTES = 5;
const CHALLENGE_TRIES = 5;
// Tope por cuenta (sin importar desde cuántas conexiones se intente): 10 códigos errados cada 15 minutos.
const USER_FAILS = 10;
const USER_WINDOW_MS = 15 * 60e3;

const userRow = (id) => q('SELECT * FROM users WHERE id = ?').get(id);
const recoveryLeft = (u) => (u.totp_recovery ? JSON.parse(u.totp_recovery).length : 0);

export async function twofaStatus(userId) {
  const u = await userRow(userId);
  return { enabled: !!u?.totp_enabled_at, since: u?.totp_enabled_at || null, recovery_left: u ? recoveryLeft(u) : 0 };
}

/**
 * Comprueba el segundo paso: un código de la app (6 dígitos) o un código de recuperación (16 caracteres, se gasta).
 * La marca del último código usado y el consumo del código de recuperación son atómicos: dos peticiones simultáneas
 * con el mismo código no pueden aprovecharlo ambas.
 */
export async function checkSecondFactor(u, raw) {
  const code = String(raw ?? '').trim();
  const digits = code.replace(/\s/g, '');
  if (/^\d{6}$/.test(digits)) {
    const secret = openSecret(u.totp_secret);
    const step = secret ? verifyTotp(secret, digits, { lastStep: u.totp_last_step }) : null;
    if (step == null) return null;
    const r = await q('UPDATE users SET totp_last_step = ? WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)').run(step, u.id, step);
    return r.changes ? { method: 'totp' } : null;
  }
  if (normalizeRecovery(code).length !== RECOVERY_LENGTH || !u.totp_recovery) return null;
  const hashes = JSON.parse(u.totp_recovery);
  const h = recoveryHash(u.id, code);
  if (!hashes.includes(h)) return null;
  const left = hashes.filter((x) => x !== h);
  const r = await q('UPDATE users SET totp_recovery = ? WHERE id = ? AND totp_recovery = ?').run(JSON.stringify(left), u.id, u.totp_recovery);
  return r.changes ? { method: 'recovery', remaining: left.length } : null;
}

// --- Intentos por cuenta (en la tabla de límites: vale con varias instancias del servidor) ---------------------
// Cada intento se aparta ANTES de comprobar el código, en una sola operación: ni con peticiones simultáneas se pasa
// del tope. Un código correcto devuelve su intento (sólo cuentan los errados).
const tooManyFails = () => new AppError(429, 'RATE_LIMITED', 'Demasiados códigos incorrectos. Espere 15 minutos e inténtelo de nuevo.');
async function reserveAttempt(userId) {
  const t = Date.now();
  const row = await q(`INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.count + 1 END,
        reset_at = CASE WHEN rate_limits.reset_at <= ? THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END
      RETURNING count`).get(`2fa-fail:${userId}`, t + USER_WINDOW_MS, t, t);
  if (row.count > USER_FAILS) throw tooManyFails();
}
const releaseAttempt = (userId) => q('UPDATE rate_limits SET count = GREATEST(count - 1, 0) WHERE key = ?').run(`2fa-fail:${userId}`);

// --- Inicio de sesión en dos pasos ----------------------------------------------------------------------------
/** Contraseña correcta y verificación activa: se entrega un comprobante de 5 minutos para el segundo paso. */
export async function startLoginChallenge(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await q('DELETE FROM login_challenges WHERE expires_at < ?').run(now());
  await q('INSERT INTO login_challenges (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), userId, new Date(Date.now() + CHALLENGE_MINUTES * 60e3).toISOString());
  return token;
}

const expired = (msg = 'La verificación caducó. Ingrese de nuevo su usuario y contraseña.') => new AppError(401, 'CHALLENGE_EXPIRED', msg);

/** Segundo paso: devuelve el usuario y cómo se verificó, o lanza el error para mostrar. */
export async function finishLoginChallenge(token, code, ip) {
  if (!token) throw expired();
  const hash = sha256(String(token));
  const drop = () => q('DELETE FROM login_challenges WHERE token_hash = ?').run(hash);
  // El intento se aparta antes de comprobar el código: ni con peticiones simultáneas pasan más de 5 por comprobante.
  const ch = await q(`UPDATE login_challenges SET fails = fails + 1
      WHERE token_hash = ? AND expires_at >= ? AND fails < ? RETURNING user_id, fails`).get(hash, now(), CHALLENGE_TRIES);
  if (!ch) throw expired();
  const u = await userRow(ch.user_id);
  if (!u || u.status !== 'active' || !u.totp_enabled_at) { await drop(); throw expired(); }
  await reserveAttempt(u.id);
  const result = await checkSecondFactor(u, code);
  if (!result) {
    await audit(null, 'auth.2fa_failed', 'user', u.id, { username: u.username }, ip);
    if (ch.fails >= CHALLENGE_TRIES) {
      await drop();
      throw expired('Demasiados códigos incorrectos. Ingrese de nuevo su usuario y contraseña.');
    }
    throw new AppError(401, 'BAD_CODE', 'El código no es correcto. Escriba el que muestra la app en este momento.');
  }
  await releaseAttempt(u.id);
  await drop();
  return { user: u, ...result };
}

// --- Activación y desactivación desde «Mi cuenta» ----------------------------------------------------------------
export async function setupTwofa(userId, password) {
  const u = await userRow(userId);
  if (u.totp_enabled_at) throw badRequest('TWOFA_ON', 'La verificación en dos pasos ya está activa.');
  if (!verifyPassword(String(password ?? ''), u.password_hash)) throw badRequest('BAD_PASSWORD', 'La contraseña no es correcta.', { field: 'password' });
  const secret = newSecret();
  await q('UPDATE users SET totp_secret = ?, totp_last_step = NULL, totp_recovery = NULL WHERE id = ?').run(sealSecret(secret), u.id);
  return { secret, uri: otpauthUri(secret, u.username), issuer: ISSUER, account: u.username };
}

export async function enableTwofa(userId, code) {
  const u = await userRow(userId);
  if (u.totp_enabled_at) throw badRequest('TWOFA_ON', 'La verificación en dos pasos ya está activa.');
  const secret = openSecret(u.totp_secret);
  if (!secret) throw badRequest('TWOFA_SETUP', 'Empiece de nuevo la activación.');
  const step = verifyTotp(secret, code);
  if (step == null) throw badRequest('BAD_CODE', 'El código no es correcto. Escriba el de 6 dígitos que muestra la app en este momento.', { field: 'code' });
  const codes = newRecoveryCodes();
  await q('UPDATE users SET totp_enabled_at = ?, totp_last_step = ?, totp_recovery = ? WHERE id = ?')
    .run(now(), step, JSON.stringify(codes.map((c) => recoveryHash(u.id, c))), u.id);
  return codes;
}

/** Desactivar o renovar los códigos exige un código vigente (de la app o de recuperación). */
async function requireCode(u, code) {
  if (!u.totp_enabled_at) throw badRequest('TWOFA_OFF', 'La verificación en dos pasos no está activa.');
  await reserveAttempt(u.id);
  if (!(await checkSecondFactor(u, code))) throw badRequest('BAD_CODE', 'El código no es correcto.', { field: 'code' });
  await releaseAttempt(u.id);
}

export async function disableTwofa(userId, password, code) {
  const u = await userRow(userId);
  if (!verifyPassword(String(password ?? ''), u.password_hash)) throw badRequest('BAD_PASSWORD', 'La contraseña no es correcta.', { field: 'password' });
  await requireCode(u, code);
  await clearTwofa(u.id);
}

export async function renewRecoveryCodes(userId, code) {
  const u = await userRow(userId);
  await requireCode(u, code);
  const codes = newRecoveryCodes();
  await q('UPDATE users SET totp_recovery = ? WHERE id = ?').run(JSON.stringify(codes.map((c) => recoveryHash(u.id, c))), u.id);
  return codes;
}

export async function clearTwofa(userId) {
  await q('UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL, totp_recovery = NULL WHERE id = ?').run(userId);
  await q('DELETE FROM login_challenges WHERE user_id = ?').run(userId);
}

// Verificación en dos pasos con una app de autenticación (Google Authenticator, Microsoft Authenticator, Authy,
// 1Password…): códigos TOTP de 6 dígitos que cambian cada 30 segundos (RFC 6238, HMAC-SHA1).
import crypto from 'node:crypto';
import { randomCode } from './util.js';

export const ISSUER = 'Thowinsson';
const STEP_SECONDS = 30;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('BASE32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  return Buffer.from(out);
}

/** Código de un contador (RFC 4226). */
export function hotp(key, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/**
 * Paso de 30 s en que el código es válido, o null. Acepta un paso antes y uno después (relojes desfasados) y nunca
 * uno igual o anterior a `lastStep`: un código ya usado no vale dos veces.
 */
export function verifyTotp(secret, code, { lastStep = null, now = Date.now(), window = 1 } = {}) {
  const c = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  let key;
  try { key = base32Decode(secret); } catch { return null; }
  const cur = currentStep(now);
  for (let d = -window; d <= window; d++) {
    const step = cur + d;
    if (lastStep != null && step <= Number(lastStep)) continue;
    if (crypto.timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(c))) return step;
  }
  return null;
}

/** Clave nueva de 160 bits en base32 (lo que se escribe a mano o va dentro del código QR). */
export const newSecret = () => base32Encode(crypto.randomBytes(20));

/** Enlace que abre la app de autenticación (también es el contenido del código QR). */
export function otpauthUri(secret, account) {
  const label = `${encodeURIComponent(ISSUER)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

// --- Códigos de recuperación: de un solo uso, para entrar si se pierde el celular -----------------------------
// 16 caracteres (80 bits) con una huella distinta por cuenta: ni con una copia de la base de datos se pueden averiguar
// probando combinaciones. No dependen de TOTP_KEY: si esa clave cambia o se pierde, siguen sirviendo para entrar.
export const RECOVERY_LENGTH = 16;
export const normalizeRecovery = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const recoveryHash = (userId, code) =>
  crypto.createHmac('sha256', 'thowinsson-recovery').update(`${userId}:${normalizeRecovery(code)}`).digest('hex');
export function newRecoveryCodes(n = 8) {
  return Array.from({ length: n }, () => randomCode(RECOVERY_LENGTH).match(/.{4}/g).join('-'));
}

// --- La clave guardada: cifrada si el servidor tiene TOTP_KEY ---------------------------------------------------
// Con TOTP_KEY definida, una copia filtrada de la base de datos no basta para generar códigos.
const sealKey = () => (process.env.TOTP_KEY ? crypto.createHash('sha256').update(process.env.TOTP_KEY).digest() : null);

export function sealSecret(secret) {
  const key = sealKey();
  if (!key) return `p:${secret}`;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
  return `g:${iv.toString('base64url')}:${c.getAuthTag().toString('base64url')}:${ct.toString('base64url')}`;
}

export function openSecret(stored) {
  if (!stored) return null;
  if (stored.startsWith('p:')) return stored.slice(2);
  const key = sealKey();
  if (!stored.startsWith('g:') || !key) return null;
  const [, iv, tag, ct] = stored.split(':');
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

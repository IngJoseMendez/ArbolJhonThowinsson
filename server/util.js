import crypto from 'node:crypto';
import dns from 'node:dns';

export class AppError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
export const badRequest = (code, msg, extra) => new AppError(400, code, msg, extra);
export const forbidden = (msg = 'No tiene permisos para realizar esta acción.') => new AppError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'Recurso no encontrado.') => new AppError(404, 'NOT_FOUND', msg);
export const conflict = (code, msg, extra) => new AppError(409, code, msg, extra);

/** Quita tildes, pasa a minúsculas y colapsa espacios. */
export function normalizeText(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** "Juan Pérez" -> "JUAN-PEREZ" */
export function slugUpper(s, maxParts = 3) {
  const parts = normalizeText(s).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(Boolean).slice(0, maxParts);
  return parts.join('-').toUpperCase() || 'SIN-NOMBRE';
}

export function slugLower(s) {
  return normalizeText(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cabeza';
}

/** Teléfono: sólo dígitos; se exige entre 7 y 15 (E.164). */
// Prefijo de país configurable: "+57 300 123 4567" y "3001234567" son el mismo número.
const COUNTRY = process.env.PHONE_COUNTRY_CODE ?? '57';
const NATIONAL_LEN = Number(process.env.PHONE_NATIONAL_LENGTH || 10);
export function normalizePhone(p) {
  let digits = String(p ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (COUNTRY && digits.length === COUNTRY.length + NATIONAL_LEN && digits.startsWith(COUNTRY)) {
    digits = digits.slice(COUNTRY.length);
  }
  return digits;
}

export function normalizeDocument(d) {
  const v = String(d ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  return v || null;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin caracteres ambiguos
export function randomCode(len = 5) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** Validación de datos de entrada sencilla y explícita. */
export function str(v, { field, key, min = 0, max = 200, required = false } = {}) {
  const s = v == null ? '' : String(v).trim();
  const extra = { field: key || field };
  if (required && !s) throw badRequest('VALIDATION', `El campo "${field}" es obligatorio.`, extra);
  if (s && s.length < min) throw badRequest('VALIDATION', `El campo "${field}" es demasiado corto.`, extra);
  if (s.length > max) throw badRequest('VALIDATION', `El campo "${field}" es demasiado largo (máx. ${max}).`, extra);
  return s;
}

export function intOrNull(v, field) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest('VALIDATION', `El campo "${field}" no es válido.`, { field });
  return n;
}

export function validatePhone(raw) {
  const phone = normalizePhone(raw);
  if (phone.length < 7 || phone.length > 15) {
    throw badRequest('VALIDATION', 'El teléfono debe tener entre 7 y 15 dígitos.', { field: 'phone' });
  }
  return phone;
}

// --- Celular colombiano -------------------------------------------------------------
// 10 dígitos con prefijo móvil asignado (300–305, 310–324, 333, 350–351). Por la portabilidad numérica
// el prefijo no indica el operador, pero sí que el número pertenece a un rango móvil real.
// Configurable con PHONE_MOBILE_PREFIXES="300-305,310-324,333,350-351".
function parsePrefixes(spec) {
  const set = new Set();
  for (const part of spec.split(',').map((x) => x.trim()).filter(Boolean)) {
    const [a, b] = part.split('-').map(Number);
    for (let n = a; n <= (b || a); n++) set.add(String(n));
  }
  return set;
}
const MOBILE_PREFIXES = parsePrefixes(process.env.PHONE_MOBILE_PREFIXES || '300-305,310-324,333,350-351');

/** Detecta números de relleno: todos los dígitos iguales o una secuencia (1234567…). */
export function looksFake(d) {
  if (/^(\d)\1+$/.test(d)) return true;
  const seq = '01234567890123456789';
  const rev = '98765432109876543210';
  return d.length >= 6 && (seq.includes(d) || rev.includes(d));
}

export function validateMobile(raw) {
  const phone = normalizePhone(raw);
  if (!phone) throw badRequest('VALIDATION', 'El celular / WhatsApp es obligatorio.', { field: 'phone' });
  if (!/^3\d{9}$/.test(phone)) {
    throw badRequest('VALIDATION', 'El celular debe tener 10 dígitos y empezar por 3 (por ejemplo 300 555 0123).', { field: 'phone' });
  }
  if (!MOBILE_PREFIXES.has(phone.slice(0, 3))) {
    throw badRequest('VALIDATION', `El prefijo ${phone.slice(0, 3)} no corresponde a un celular colombiano.`, { field: 'phone' });
  }
  if (looksFake(phone.slice(3))) throw badRequest('VALIDATION', 'El número de celular no parece real.', { field: 'phone' });
  return phone;
}

// --- Cédula de ciudadanía -------------------------------------------------------------
// Cédulas antiguas: hasta 8 dígitos (cupos 1 a 99.999.999). NUIP (Resolución 3571 de 2003):
// 10 dígitos desde 1.000.000.000. No hay dígito de verificación público.
export function validateCedula(raw, { required = true } = {}) {
  const raw2 = String(raw ?? '').trim();
  if (!raw2) {
    if (required) throw badRequest('VALIDATION', 'La cédula es obligatoria.', { field: 'document_id' });
    return null;
  }
  const v = raw2.replace(/[.\s,-]/g, '');
  if (!/^\d+$/.test(v)) throw badRequest('VALIDATION', 'La cédula sólo puede contener números.', { field: 'document_id' });
  const ok = /^[1-9]\d{3,7}$/.test(v) || /^1\d{9}$/.test(v);
  if (!ok) {
    throw badRequest('VALIDATION', 'La cédula debe tener entre 4 y 8 dígitos (cédulas antiguas) o 10 dígitos empezando por 1.', { field: 'document_id' });
  }
  if (looksFake(v)) throw badRequest('VALIDATION', 'El número de cédula no parece real.', { field: 'document_id' });
  return v;
}

// --- Correo electrónico ---------------------------------------------------------------
export const COMMON_EMAIL_DOMAINS = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'yahoo.es', 'hotmail.es',
  'outlook.es', 'live.com', 'icloud.com', 'msn.com', 'protonmail.com'];

// Dominios reales que se parecen a los comunes y no deben "corregirse".
const LEGIT_DOMAINS = new Set([...COMMON_EMAIL_DOMAINS, 'ymail.com', 'rocketmail.com', 'aol.com', 'gmx.com', 'mail.com', 'zoho.com',
  'me.com', 'mac.com', 'yandex.com', 'live.com.co', 'hotmail.com.co', 'outlook.com.co', 'yahoo.com.co', 'une.net.co', 'proton.me']);

function levenshtein(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Sugiere el dominio común más parecido si el escrito parece un error (gmial.com -> gmail.com). */
export function suggestEmailDomain(domain) {
  if (!domain || LEGIT_DOMAINS.has(domain)) return null;
  let best = null;
  for (const d of COMMON_EMAIL_DOMAINS) {
    const dist = levenshtein(domain, d);
    if (dist <= 2 && (!best || dist < best.dist)) best = { d, dist };
  }
  if (!best && /^(gmail|hotmail|outlook|yahoo)\.(co|con|cm|om|comm|cmo)$/.test(domain)) best = { d: domain.replace(/\.[a-z]+$/, '.com') };
  return best ? best.d : null;
}

export function validateEmail(raw) {
  const e = String(raw ?? '').trim().toLowerCase();
  if (!e) return null;
  const m = /^([a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?)@((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})$/.exec(e);
  if (e.length > 160 || !m || m[1].includes('..')) throw badRequest('VALIDATION', 'El correo electrónico no es válido.', { field: 'email' });
  const sug = suggestEmailDomain(m[2]);
  if (sug) throw badRequest('VALIDATION', `¿Quiso decir ${m[1]}@${sug}? Revise el dominio del correo.`, { field: 'email', suggestion: `${m[1]}@${sug}` });
  return e;
}

/**
 * Comprueba que el dominio del correo exista y acepte correo (MX, o A/AAAA como respaldo).
 * Activo en producción (EMAIL_DNS_CHECK=0 lo desactiva). Ante errores de red no bloquea el registro.
 */
export async function assertEmailDomain(email, { enabled } = {}) {
  if (!email || !enabled) return;
  const domain = email.split('@')[1];
  if (LEGIT_DOMAINS.has(domain)) return;
  const withTimeout = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), 2500))]);
  const missing = (e) => e && (e.code === 'ENOTFOUND' || e.code === 'ENODATA' || e.code === 'NXDOMAIN');
  try {
    const mx = await withTimeout(dns.promises.resolveMx(domain));
    if (mx.length) return;
  } catch (e) {
    if (!missing(e)) return; // fallo de red: no se bloquea
  }
  try {
    const a = await withTimeout(dns.promises.resolve(domain));
    if (a.length) return;
  } catch (e) {
    if (!missing(e)) return;
  }
  // Sólo se rechaza si el DNS funciona (un dominio conocido resuelve); si no, no se puede concluir nada.
  if (!(await dnsWorks(withTimeout))) return;
  throw badRequest('VALIDATION', `El dominio "${domain}" no existe o no recibe correo.`, { field: 'email' });
}

let dnsCheck = { at: 0, ok: false };
async function dnsWorks(withTimeout) {
  if (Date.now() - dnsCheck.at < 10 * 60e3) return dnsCheck.ok;
  let ok;
  try { ok = (await withTimeout(dns.promises.resolveMx('gmail.com'))).length > 0; } catch { ok = false; }
  dnsCheck = { at: Date.now(), ok };
  return ok;
}

export function maskPhone(p) {
  if (!p) return p;
  return p.length <= 4 ? '****' : '*'.repeat(p.length - 4) + p.slice(-4);
}

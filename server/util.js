import crypto from 'node:crypto';

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
export function str(v, { field, min = 0, max = 200, required = false } = {}) {
  const s = v == null ? '' : String(v).trim();
  if (required && !s) throw badRequest('VALIDATION', `El campo "${field}" es obligatorio.`, { field });
  if (s && s.length < min) throw badRequest('VALIDATION', `El campo "${field}" es demasiado corto.`, { field });
  if (s.length > max) throw badRequest('VALIDATION', `El campo "${field}" es demasiado largo (máx. ${max}).`, { field });
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

export function validateEmail(raw) {
  const e = String(raw ?? '').trim().toLowerCase();
  if (!e) return null;
  if (e.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    throw badRequest('VALIDATION', 'El correo electrónico no es válido.', { field: 'email' });
  }
  return e;
}

export function maskPhone(p) {
  if (!p) return p;
  return p.length <= 4 ? '****' : '*'.repeat(p.length - 4) + p.slice(-4);
}

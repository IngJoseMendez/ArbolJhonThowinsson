// Reglas de formato colombianas (idénticas a las del servidor, server/util.js).

// Prefijos móviles asignados en Colombia (por portabilidad no indican operador).
const MOBILE_PREFIXES = new Set([300, 301, 302, 303, 304, 305, ...Array.from({ length: 15 }, (_, i) => 310 + i), 333, 350, 351].map(String));

export const onlyDigits = (s) => String(s ?? '').replace(/\D/g, '');

export function looksFake(d) {
  if (/^(\d)\1+$/.test(d)) return true;
  return d.length >= 6 && ('01234567890123456789'.includes(d) || '98765432109876543210'.includes(d));
}

/** Celular: quita +57/0057, deja 10 dígitos. */
export function normalizeMobile(raw) {
  let d = onlyDigits(raw);
  if (d.startsWith('0057')) d = d.slice(4);
  else if (d.length > 10 && d.startsWith('57')) d = d.slice(2);
  return d.slice(0, 10);
}
/** "3005550123" -> "300 555 0123" (parcial mientras se escribe). */
export function formatMobile(raw) {
  const d = normalizeMobile(raw);
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6, 10)].filter(Boolean).join(' ');
}
export function mobileError(raw) {
  const d = normalizeMobile(raw);
  if (!d) return 'El celular es obligatorio.';
  if (d.length < 10) return `Faltan ${10 - d.length} dígito${10 - d.length === 1 ? '' : 's'} (son 10).`;
  if (d[0] !== '3') return 'Los celulares en Colombia empiezan por 3.';
  if (!MOBILE_PREFIXES.has(d.slice(0, 3))) return `El prefijo ${d.slice(0, 3)} no corresponde a un celular colombiano.`;
  if (looksFake(d.slice(3))) return 'El número no parece real.';
  return null;
}

/** Cédula: sólo dígitos, máx. 10. Cédulas antiguas hasta 8 dígitos; NUIP 10 dígitos desde 1.000.000.000. */
export const normalizeCedula = (raw) => onlyDigits(raw).slice(0, 10);
export const formatCedula = (raw) => normalizeCedula(raw).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export function cedulaError(raw) {
  const d = normalizeCedula(raw);
  if (!d) return 'La cédula es obligatoria.';
  if (d[0] === '0') return 'La cédula no empieza por 0.';
  if (!(/^\d{4,8}$/.test(d) || /^1\d{9}$/.test(d))) {
    return d.length === 9 || (d.length === 10 && d[0] !== '1')
      ? 'Las cédulas de 10 dígitos empiezan por 1; las antiguas tienen hasta 8 dígitos.'
      : 'Debe tener entre 4 y 8 dígitos, o 10 dígitos empezando por 1.';
  }
  if (looksFake(d)) return 'El número no parece real.';
  return null;
}

export const COMMON_EMAIL_DOMAINS = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'yahoo.es', 'hotmail.es', 'outlook.es', 'live.com', 'icloud.com', 'msn.com', 'protonmail.com'];
const LEGIT = new Set([...COMMON_EMAIL_DOMAINS, 'ymail.com', 'rocketmail.com', 'aol.com', 'gmx.com', 'mail.com', 'zoho.com', 'me.com', 'mac.com', 'yandex.com', 'live.com.co', 'hotmail.com.co', 'outlook.com.co', 'yahoo.com.co', 'une.net.co', 'proton.me']);

function lev(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = dp[j]; dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return dp[b.length];
}
export const normalizeEmail = (raw) => String(raw ?? '').replace(/\s+/g, '').toLowerCase();
/** Devuelve el correo corregido si el dominio parece un error de escritura (ana@gmial.com -> ana@gmail.com). */
export function emailSuggestion(raw) {
  const e = normalizeEmail(raw);
  const [user, domain] = e.split('@');
  if (!user || !domain || LEGIT.has(domain)) return null;
  let best = null;
  for (const d of COMMON_EMAIL_DOMAINS) { const x = lev(domain, d); if (x <= 2 && (!best || x < best.x)) best = { d, x }; }
  if (!best && /^(gmail|hotmail|outlook|yahoo)\.(co|con|cm|om|comm|cmo)$/.test(domain)) best = { d: domain.replace(/\.[a-z]+$/, '.com') };
  if (!best && /^(gmail|hotmail|outlook|yahoo)$/.test(domain)) best = { d: `${domain}.com` };
  return best ? `${user}@${best.d}` : null;
}
export function emailError(raw) {
  const e = normalizeEmail(raw);
  if (!e) return null;
  const m = /^([a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?)@((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})$/.exec(e);
  if (!m || m[1].includes('..')) return 'Correo no válido (ejemplo: nombre@gmail.com).';
  if (emailSuggestion(e)) return 'Revise el dominio del correo.';
  return null;
}

/** "juan  pérez de la hoz" -> "Juan Pérez de la Hoz" (al salir del campo). */
export function formatName(raw) {
  const small = new Set(['de', 'del', 'la', 'las', 'los', 'y']);
  return String(raw ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
    .split(' ').map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}

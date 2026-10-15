// Cabeceras de seguridad. Express las envía en Railway y en local; en Vercel las páginas las sirve la CDN y
// vercel.json repite exactamente estos valores (tests/security.test.js comprueba que coincidan).

/**
 * Política de contenido: sólo se ejecuta, se carga y se conecta lo publicado en el propio dominio.
 * Un script inyectado (por ejemplo, en un nombre registrado) no puede ejecutarse ni enviar datos a otro sitio.
 * Los estilos en línea que pone React se aplican por CSSOM y no necesitan 'unsafe-inline'.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  // Las fotos de las personas de confianza se sirven desde Cloudinary.
  "img-src 'self' data: https://res.cloudinary.com",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** HTTPS obligatorio durante un año (sin subdominios: no afecta otros servicios del dominio). */
export const HSTS = 'max-age=31536000';

/** Cabeceras para todas las respuestas (las de Vercel incluyen además HSTS, que allí siempre es HTTPS). */
export const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  // Las ventanas que abre la app (WhatsApp) no pueden manipular esta pestaña ni leerla.
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
};

export function securityHeaders(req, res, next) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  if (req.secure) res.setHeader('Strict-Transport-Security', HSTS);
  next();
}

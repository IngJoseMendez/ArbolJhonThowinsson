import express from 'express';
import compression from 'compression';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadUser } from './auth.js';
import { ensureDb } from './db.js';
import { ensureBootstrapAdmin } from './bootstrap.js';
import { ON_VERCEL, ON_RAILWAY } from './env.js';
import { q } from './db.js';
import { api } from './api.js';
import { AppError } from './util.js';
import { resolveInvite, headPerson } from './services/people.js';
import { securityHeaders } from './security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Título de la vista previa de un enlace de registro: quién invita y a qué («María Gómez te invita…»).
 * Sólo lee el enlace (no lo consume) y, ante cualquier problema, se usa la vista previa general.
 */
async function withInviteMeta(html, token) {
  await ensureDb();
  const { owner, head, role, valid } = await resolveInvite(token);
  if (!valid) return html;
  const cabeza = head ? await headPerson(head.id) : null;
  const host = owner?.full_name || (role === 'leader' && cabeza?.status === 'active' ? cabeza.full_name : null);
  const title = role === 'head' ? 'Te invitamos a ser cabeza del equipo de John Thowinsson'
    : host ? `${host} te invita a ${role === 'leader' ? 'ser líder en el' : 'sumarte al'} equipo de John Thowinsson`
      : 'Súmate al equipo de John Thowinsson';
  const t = esc(title);
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${t}</title>`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${t}$2`);
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
  else if (ON_VERCEL || ON_RAILWAY) app.set('trust proxy', true); // detrás del proxy del proveedor

  app.use(securityHeaders);
  // Respuestas comprimidas (gzip/brotli). En Vercel lo hace su CDN.
  if (!ON_VERCEL) app.use(compression());

  // Protección CSRF básica: las peticiones que modifican datos deben ser JSON y del mismo origen.
  app.use('/api', (req, res, next) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
      if (!req.is('application/json')) return next(new AppError(415, 'UNSUPPORTED', 'Se esperaba JSON.'));
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return next(new AppError(403, 'BAD_ORIGIN', 'Origen no permitido.'));
    }
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  // En Vercel, los "helpers" de Node pueden haber leído ya el cuerpo y exponerlo como req.body
  // (propiedad perezosa). Si existe se reutiliza y express.json no vuelve a leer el flujo.
  app.use((req, _res, next) => {
    const d = Object.getOwnPropertyDescriptor(req, 'body');
    if (!d) return next();
    if (Number(req.headers['content-length'] || 0) > 50 * 1024) return next(new AppError(413, 'TOO_LARGE', 'Petición demasiado grande.'));
    try {
      const b = req.body;
      req.body = b && typeof b === 'object' && !Buffer.isBuffer(b) ? b : {};
      req._body = true;
    } catch {
      return next(new AppError(400, 'BAD_JSON', 'JSON no válido.'));
    }
    next();
  });
  app.use(express.json({ limit: '50kb' }));
  // Inicialización perezosa (una vez por proceso): conexión, esquema y administrador inicial.
  let ready = null;
  app.use('/api', async (_req, _res, next) => {
    ready ??= ensureDb().then(() => ensureBootstrapAdmin()).catch((e) => { ready = null; throw e; });
    await ready;
    next();
  });
  // Comprobación de salud para el balanceador de Railway (no expone datos).
  app.get('/api/health', async (_req, res) => { await q('SELECT 1').get(); res.json({ ok: true }); });
  app.use('/api', loadUser);
  app.use('/api', api);
  app.use('/api', (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Ruta no encontrada.')));

  const dist = [path.resolve(__dirname, '..', 'dist'), path.resolve(__dirname, '..', 'client', 'dist')].find((d) => fs.existsSync(d)) || '';
  if (dist) {
    app.use(express.static(dist, {
      index: false,
      maxAge: '1h',
      setHeaders: (res, file) => {
        if (file.endsWith(`${path.sep}sw.js`)) res.setHeader('Cache-Control', 'no-cache');
        else if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else if (file.includes(`${path.sep}brand${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      },
    }));
    let indexHtml = null;
    app.get('/{*splat}', async (req, res) => {
      indexHtml ??= fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
      // Las vistas previas de WhatsApp y Facebook necesitan URL absolutas (PUBLIC_URL fija el dominio si se define).
      const origin = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
      let html = indexHtml.replaceAll('__PUBLIC_ORIGIN__', esc(origin));
      const m = /^\/registro\/([A-Za-z0-9-]{4,80})$/.exec(req.path);
      if (m) html = await withInviteMeta(html, m[1]).catch(() => html);
      // Panel: el manifiesto de la app instalable apunta al propio panel desde el primer momento (al instalarlo, el ícono
      // abre «Mi panel»). Los enlaces de registro y de panel son privados: no se indexan en buscadores.
      const panel = /^\/panel\/([A-Za-z0-9_-]{20,60})$/.exec(req.path);
      if (panel) {
        html = html.replace('href="/manifest.webmanifest"', `href="/api/public/manifest?start=${encodeURIComponent(`/panel/${panel[1]}`)}"`)
          .replace('name="apple-mobile-web-app-title" content="Thowinsson"', 'name="apple-mobile-web-app-title" content="Mi panel"');
      }
      if (m || panel) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.setHeader('Cache-Control', 'no-cache');
      res.type('html').send(html);
    });
  }

  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') err = new AppError(400, 'BAD_JSON', 'JSON no válido.');
    if (err.type === 'entity.too.large') err = new AppError(413, 'TOO_LARGE', 'Petición demasiado grande.');
    if (!(err instanceof AppError)) {
      const m = String(err.message || '');
      if (m.includes('INVITER_OTHER_HEAD')) err = new AppError(400, 'INVITER_OTHER_HEAD', 'Relación inconsistente: invitador de otra cabeza.');
      else if (m.includes('CYCLE')) err = new AppError(400, 'CYCLE', 'Relación circular no permitida.');
      else if (m.includes('LEADER_INVALID')) err = new AppError(400, 'LEADER_INVALID', 'Líder responsable no válido.');
      else if (m.includes('ux_people_phone')) err = new AppError(409, 'DUPLICATE', 'Ya existe una persona con ese teléfono.');
      else if (m.includes('ux_people_doc')) err = new AppError(409, 'DUPLICATE', 'Ya existe una persona con ese documento.');
      else if (err.code === '23505') err = new AppError(409, 'DUPLICATE', 'El registro ya existe.');
      else {
        console.error(err);
        err = new AppError(500, 'INTERNAL', 'Error interno del servidor.');
      }
    }
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.extra || {}) } });
  });
  return app;
}

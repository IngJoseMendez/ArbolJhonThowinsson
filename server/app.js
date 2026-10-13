import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadUser } from './auth.js';
import { api } from './api.js';
import { AppError } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

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
  app.use(express.json({ limit: '50kb' }));
  app.use(loadUser);
  app.use('/api', api);
  app.use('/api', (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Ruta no encontrada.')));

  const dist = path.resolve(__dirname, '..', 'client', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') err = new AppError(400, 'BAD_JSON', 'JSON no válido.');
    if (err.type === 'entity.too.large') err = new AppError(413, 'TOO_LARGE', 'Petición demasiado grande.');
    if (!(err instanceof AppError)) {
      const m = String(err.message || '');
      if (m.includes('INVITER_OTHER_HEAD')) err = new AppError(400, 'INVITER_OTHER_HEAD', 'Relación inconsistente: invitador de otra cabeza.');
      else if (m.includes('CYCLE')) err = new AppError(400, 'CYCLE', 'Relación circular no permitida.');
      else if (m.includes('LEADER_INVALID')) err = new AppError(400, 'LEADER_INVALID', 'Líder responsable no válido.');
      else if (m.includes('UNIQUE constraint failed: people.phone') || m.includes('ux_people_phone')) err = new AppError(409, 'DUPLICATE', 'Ya existe una persona con ese teléfono.');
      else {
        console.error(err);
        err = new AppError(500, 'INTERNAL', 'Error interno del servidor.');
      }
    }
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.extra || {}) } });
  });
  return app;
}

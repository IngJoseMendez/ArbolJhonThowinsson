import { createApp } from './app.js';
import { closeDb } from './db.js';

const port = Number(process.env.PORT) || 3000;
const server = createApp().listen(port, '0.0.0.0', () => {
  console.log(`Plataforma de estructuras escuchando en el puerto ${port}`);
});

// Cierre ordenado en redespliegues (Railway envía SIGTERM): termina peticiones en curso y cierra el pool.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, () => {
    server.close(async () => { await closeDb().catch(() => {}); process.exit(0); });
    setTimeout(() => process.exit(0), 10000).unref();
  });
}

import { openDb } from './db.js';
import { createApp } from './app.js';
import { ensureBootstrapAdmin } from './bootstrap.js';

openDb();
ensureBootstrapAdmin();
const port = Number(process.env.PORT) || 3000;
createApp().listen(port, () => {
  console.log(`Plataforma de estructuras escuchando en http://localhost:${port}`);
});

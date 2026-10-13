// Genera una estructura grande para pruebas de rendimiento.
// Uso: N=20000 npm run seed:large
import { openDb, q, closeDb } from '../server/db.js';
import { generateLarge } from './large.js';

await openDb();
const n = Number(process.env.N || 20000);
const t = Date.now();
const r = await generateLarge(n, process.env.HEAD_NAME || `Cabeza Masiva ${new Date().toISOString().slice(0, 16)}`);
console.log(`Generadas ${r.count} personas en "${r.headName}" en ${((Date.now() - t) / 1000).toFixed(1)} s.`);
console.log(`Total en BD: ${(await q('SELECT COUNT(*) n FROM people').get()).n}`);
await closeDb();

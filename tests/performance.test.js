// Criterio 12: el árbol sigue siendo utilizable con estructuras grandes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client } from './helpers.js';

const N = Number(process.env.PERF_N || 20000);
let srv; let admin; let headId;

before(async () => {
  srv = await startServer();
  const { generateLarge } = await import('../scripts/large.js');
  const t = Date.now();
  headId = generateLarge(N, 'Cabeza Masiva').headId;
  console.log(`# generadas ${N} personas en ${Date.now() - t} ms`);
  admin = await new Client(srv.base).login('admin', 'Admin1234!');
});
after(() => srv.close());

async function timed(label, url, maxMs) {
  const t = performance.now();
  const r = await admin.get(url);
  const ms = performance.now() - t;
  console.log(`# ${label}: ${ms.toFixed(1)} ms`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(ms < maxMs, `${label} tardó ${ms.toFixed(0)} ms (máx ${maxMs})`);
  return r.data;
}

test(`12. Respuestas rápidas con ${N} personas`, async () => {
  const root = await timed('raíz de la cabeza', `/api/tree/${headId}/children`, 1500);
  assert.equal(root.total, 10);
  assert.equal(root.nodes.reduce((a, n) => a + n.descendant_count + 1, 0), N, 'los contadores suman el total');
  const big = root.nodes.sort((a, b) => b.child_count - a.child_count)[0];
  const kids = await timed('hijos de un nodo grande (página 1)', `/api/tree/${headId}/children?parent=${big.id}&limit=100`, 1500);
  assert.ok(kids.nodes.length <= 100);
  const found = await timed('búsqueda por nombre', '/api/search?q=persona 1999', 1000);
  assert.ok(found.length > 0);
  const deep = (await admin.get(`/api/people?head_id=${headId}&sort=created_at&dir=desc&pageSize=5`)).data.rows[0];
  const path = await timed('camino hasta una hoja', `/api/tree/path/${deep.id}`, 500);
  assert.equal(path.chain.at(-1).id, deep.id);
  await timed('ficha de líder raíz', `/api/people/${big.id}`, 1500);
  await timed('directorio paginado', `/api/people?head_id=${headId}&page=50&pageSize=50`, 1500);
  await timed('dashboard', '/api/stats/dashboard?days=365', 2500);
  await timed('integridad', '/api/admin/integrity', 5000);
});

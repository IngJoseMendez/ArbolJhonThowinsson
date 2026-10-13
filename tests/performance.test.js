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
  headId = (await generateLarge(N, 'Cabeza Masiva')).headId;
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
  const root = await timed('raíz de la cabeza', `/api/tree/${headId}/children`, 400);
  assert.equal(root.total, 10);
  assert.equal(root.nodes.reduce((a, n) => a + n.descendant_count + 1, 0), N, 'los contadores suman el total');
  const big = root.nodes.sort((a, b) => b.child_count - a.child_count)[0];
  const kids = await timed('hijos de un nodo grande (página 1)', `/api/tree/${headId}/children?parent=${big.id}&limit=100`, 400);
  assert.ok(kids.nodes.length <= 100);
  const found = await timed('búsqueda por nombre', '/api/search?q=persona 1999', 400);
  assert.ok(found.length > 0);
  const deep = (await admin.get(`/api/people?head_id=${headId}&sort=created_at&dir=desc&pageSize=5`)).data.rows[0];
  const path = await timed('camino hasta una hoja', `/api/tree/path/${deep.id}`, 300);
  assert.equal(path.chain.at(-1).id, deep.id);
  await timed('ficha de líder raíz', `/api/people/${big.id}`, 500);
  await timed('directorio paginado', `/api/people?head_id=${headId}&page=50&pageSize=50`, 500);
  await timed('dashboard', '/api/stats/dashboard?days=365', 1000);
  // «Expandir todo» sobre la cabeza completa: bloques de 2000 por ruta
  const t0 = performance.now();
  let after = null; let loaded = 0; let pages = 0;
  do {
    const r = (await admin.get(`/api/tree/${headId}/subtree?limit=2000${after ? `&after=${encodeURIComponent(after)}` : ''}`)).data;
    loaded += r.nodes.length; after = r.next; pages++;
  } while (after);
  const ms = performance.now() - t0;
  console.log(`# expandir todo (${loaded} personas en ${pages} bloques): ${ms.toFixed(0)} ms`);
  assert.equal(loaded, N, 'la rama completa incluye a todas las personas');
  assert.ok(ms < 8000, `expandir todo tardó ${ms.toFixed(0)} ms`);
  // Filtros geográficos y conteos por ubicación
  const loc = (await admin.get('/api/geo/areas?level=localidad')).data[1];
  const filtered = await timed('directorio filtrado por localidad', `/api/people?head_id=${headId}&localidad_id=${loc.id}&pageSize=50`, 600);
  assert.ok(filtered.total > 0 && filtered.rows.every((r) => r.geo_localidad_id === loc.id));
  const stats = await timed('conteos por ubicación', `/api/geo/stats?head_id=${headId}`, 1500);
  // Toda persona tiene localidad de catálogo o escrita a mano: la suma por localidad + las escritas a mano = total.
  const byLoc = stats.areas.filter((a) => a.level === 'localidad').reduce((x, a) => x + a.people, 0);
  assert.equal(stats.totals.total, N);
  assert.equal(byLoc, N, 'la carga de prueba asigna siempre una localidad del catálogo');
  await timed('búsqueda por barrio escrito a mano', '/api/people?q=villa betel&pageSize=10', 800);
  const integ = await timed('integridad (incluye recálculo de contadores)', '/api/admin/integrity', 5000);
  assert.equal(integ.ok, true, `contadores/estructura inconsistentes: ${JSON.stringify(integ.issues.slice(0, 5))}`);
});

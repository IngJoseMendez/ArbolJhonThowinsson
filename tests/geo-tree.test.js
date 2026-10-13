// Formulario (cédula, dirección, celular, ubicación), catálogo geográfico, ubicaciones manuales,
// filtros por localidad/comuna/barrio y carga de ramas completas para "Expandir todo".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, nextPhone, nextDoc } from './helpers.js';

let srv; let admin; let anon;
const g = {}; // catálogo
const ids = {};

before(async () => {
  srv = await startServer();
  admin = await new Client(srv.base).login('admin', 'Admin1234!');
  anon = new Client(srv.base);
});
after(() => srv.close());

const areas = async (level, parent) => (await anon.get(`/api/geo/areas?level=${level}${parent ? `&parent_id=${parent}` : ''}`)).data;
const byName = (list, name) => list.find((a) => a.name === name);
const person = (extra = {}) => ({
  full_name: 'Persona Prueba', document_id: nextDoc(), address: 'Carrera 5 # 10-20', phone: nextPhone(),
  location: { localidad_id: g.L2.id, comuna_id: g.C3.id, barrio_id: g.pescaito.id }, supports: 'yes', ...extra,
});

test('Catálogo geográfico cargado desde la base de datos con relaciones verificadas', async () => {
  const locs = await areas('localidad');
  assert.deepEqual(locs.map((l) => l.name), ['Localidad 1', 'Localidad 2', 'Localidad 3']);
  g.L1 = locs[0]; g.L2 = locs[1]; g.L3 = locs[2];
  assert.equal(g.L2.alias, 'Histórica – Rodrigo de Bastidas');
  const c2 = await areas('comuna', g.L2.id);
  assert.deepEqual(c2.map((c) => `${c.name}:${c.kind}`), ['Comuna 2:comuna', 'Comuna 3:comuna', 'Comuna 4:comuna', 'Comuna 5:comuna', 'Taganga:corregimiento']);
  g.C3 = byName(c2, 'Comuna 3'); g.C2 = byName(c2, 'Comuna 2'); g.taganga = byName(c2, 'Taganga');
  const c1 = await areas('comuna', g.L1.id);
  assert.deepEqual(c1.filter((c) => c.kind === 'comuna').map((c) => c.name), ['Comuna 1', 'Comuna 6', 'Comuna 9']);
  g.C1 = byName(c1, 'Comuna 1');
  const b3 = await areas('barrio', g.C3.id);
  g.pescaito = byName(b3, 'Pescaíto'); g.olaya = byName(b3, 'Olaya Herrera');
  assert.ok(g.pescaito && g.olaya);
  assert.ok(b3.every((b) => b.parent_id === g.C3.id));
  g.bavaria = byName(await areas('barrio', g.C2.id), 'Bavaria');
  // Búsqueda por texto dentro del nivel
  const s = (await anon.get(`/api/geo/areas?level=barrio&parent_id=${g.C3.id}&q=herrera`)).data;
  assert.deepEqual(s.map((b) => b.name), ['Olaya Herrera']);
  // Sin nivel superior no se listan comunas/barrios de forma anónima
  assert.equal((await anon.get('/api/geo/areas?level=barrio')).status, 400);

  const h = await admin.post('/api/heads', { name: 'Cabeza Geo' });
  ids.head = h.data.id;
  const l = await admin.post('/api/people', { ...person({ full_name: 'Líder Geo' }), head_id: ids.head, is_leader: true });
  assert.equal(l.status, 201, JSON.stringify(l.data));
  ids.leader = l.data.id;
});

test('1-2. Formulario: obligatorios, formatos y cédula duplicada', async () => {
  const post = (body) => admin.post('/api/people', { head_id: ids.head, inviter_id: ids.leader, ...body });
  const fieldOf = async (body) => (await post(body)).data.error?.field;
  assert.equal((await post(person({ full_name: '' }))).status, 400);
  assert.equal(await fieldOf(person({ document_id: '' })), 'document_id');
  assert.equal(await fieldOf(person({ document_id: '12AB45' })), 'document_id');
  assert.equal(await fieldOf(person({ address: '' })), 'address');
  assert.equal(await fieldOf(person({ phone: '6055551234' })), 'phone', 'un fijo no es celular');
  assert.equal(await fieldOf(person({ phone: '30012' })), 'phone');
  assert.equal(await fieldOf(person({ email: 'no-es-correo' })), 'email');
  assert.equal(await fieldOf(person({ location: {} })), 'localidad');
  // Válido: cédula con puntos, celular con prefijo +57 y correo opcional vacío
  const ok = await post(person({ full_name: 'Ana Válida', document_id: '1.082.345.678', phone: '+57 315 000 1111', email: '' }));
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(ok.data.document_id, '1082345678');
  assert.equal(ok.data.phone, '3150001111');
  assert.equal(ok.data.address, 'Carrera 5 # 10-20');
  ids.ana = ok.data.id;
  const dup = await post(person({ full_name: 'Otra Ana', document_id: '1082345678' }));
  assert.equal(dup.status, 409);
  assert.equal(dup.data.error.field, 'document_id');
  // Mismos campos en el registro por enlace
  const link = (await admin.get(`/api/people/${ids.leader}`)).data.links[0].token;
  const pub = await anon.post(`/api/public/register/${link}`, { ...person({ full_name: 'Registro Enlace' }), consent: true });
  assert.equal(pub.status, 201, JSON.stringify(pub.data));
  assert.equal((await anon.post(`/api/public/register/${link}`, { ...person({ full_name: 'Sin Dirección', address: '' }), consent: true })).data.error.field, 'address');
  assert.equal((await anon.post(`/api/public/register/${link}`, { ...person({ full_name: 'Cédula Pública', document_id: '1082345678' }), consent: true })).status, 409);
});

test('3-4. Selección dependiente validada en el servidor', async () => {
  const post = (location) => admin.post('/api/people', { ...person({ location }), head_id: ids.head, inviter_id: ids.leader });
  const mis1 = await post({ localidad_id: g.L1.id, comuna_id: g.C3.id });
  assert.equal(mis1.data.error.code, 'GEO_MISMATCH', 'comuna de otra localidad');
  const mis2 = await post({ localidad_id: g.L2.id, comuna_id: g.C3.id, barrio_id: g.bavaria.id });
  assert.equal(mis2.data.error.code, 'GEO_MISMATCH', 'barrio de otra comuna');
  // Formulario sin comuna: la comuna se deduce del barrio, y un barrio de otra localidad se rechaza.
  const inf = await post({ localidad_id: g.L2.id, barrio_id: g.pescaito.id });
  assert.equal(inf.status, 201, JSON.stringify(inf.data));
  assert.equal(inf.data.geo_comuna_id, g.C3.id, 'comuna deducida del barrio');
  assert.equal(inf.data.geo_status, 'verified');
  assert.equal((await post({ localidad_id: g.L1.id, barrio_id: g.pescaito.id })).data.error.code, 'GEO_MISMATCH', 'barrio de otra localidad');
  assert.equal((await post({ localidad_id: g.C3.id })).status, 400, 'una comuna no es una localidad');
  const ok = await post({ localidad_id: g.L2.id, comuna_id: g.taganga.id });
  assert.equal(ok.status, 201, 'corregimiento como segundo nivel, sin barrio/vereda');
  const d = (await admin.get(`/api/people/${ok.data.id}`)).data.location;
  assert.equal(d.status, 'verified');
  assert.equal(d.comuna.kind, 'corregimiento');
});

test('5-6. Ubicación escrita a mano: pendiente, separada del catálogo y revisable', async () => {
  const post = (name, location) => admin.post('/api/people', { ...person({ full_name: name, location }), head_id: ids.head, inviter_id: ids.leader });
  const b1 = await post('Barrio Nuevo Uno', { localidad_id: g.L2.id, comuna_id: g.C3.id, barrio_text: 'Villa Esperanza Nueva' });
  const b2 = await post('Barrio Nuevo Dos', { localidad_id: g.L2.id, comuna_id: g.C3.id, barrio_text: 'Villa Esperanza Nueva' });
  const lx = await post('Localidad Manual', { localidad_text: 'Rural Sierra', comuna_text: 'Vereda X' });
  assert.equal(b1.status, 201); assert.equal(lx.status, 201);
  assert.equal(b1.data.geo_status, 'pending');
  assert.equal(b1.data.geo_barrio_id, null);
  assert.equal(b1.data.geo_barrio_text, 'Villa Esperanza Nueva');
  // Un nivel inferior no puede ser de catálogo si el superior fue escrito a mano
  assert.equal((await post('Mezcla', { localidad_text: 'Algo', comuna_id: g.C3.id })).status, 400);
  // No se crea nada en el catálogo
  assert.equal((await areas('barrio', g.C3.id)).some((b) => b.name === 'Villa Esperanza Nueva'), false);
  // Búsqueda de texto y filtro de pendientes
  const found = (await admin.get('/api/people?q=esperanza nueva')).data;
  assert.equal(found.total, 2);
  const pend = (await admin.get(`/api/people?geo_status=pending&head_id=${ids.head}`)).data;
  assert.equal(pend.total, 3);
  // Revisión: grupos
  const groups = (await admin.get('/api/geo/pending')).data;
  const grp = groups.find((x) => x.geo_barrio_text === 'Villa Esperanza Nueva');
  assert.equal(grp.people, 2);
  assert.equal(grp.level, 'barrio');
  // Un administrador de cabeza no puede ampliar el catálogo
  await admin.post('/api/users', { username: 'adm.geo', password: 'Clave1234!', role: 'head_admin', head_ids: [ids.head] });
  const headAdmin = await new Client(srv.base).login('adm.geo', 'Clave1234!');
  assert.equal((await headAdmin.post('/api/geo/areas', { level: 'barrio', name: 'X', parent_id: g.C3.id })).status, 403);
  // Agregar al catálogo (super admin) y reasignar el grupo completo
  const created = await admin.post('/api/geo/areas', { level: 'barrio', name: 'Villa Esperanza Nueva', parent_id: g.C3.id });
  assert.equal(created.status, 201);
  assert.equal((await admin.post('/api/geo/areas', { level: 'barrio', name: 'villa esperanza nueva', parent_id: g.C3.id })).status, 400, 'sin duplicados');
  const resolved = await headAdmin.post('/api/geo/pending/resolve', {
    group: grp, target: { localidad_id: g.L2.id, comuna_id: g.C3.id, barrio_id: created.data.id },
  });
  assert.equal(resolved.status, 200, JSON.stringify(resolved.data));
  assert.equal(resolved.data.updated, 2);
  const after1 = (await admin.get(`/api/people/${b1.data.id}`)).data;
  assert.equal(after1.location.status, 'verified');
  assert.equal(after1.location.barrio.name, 'Villa Esperanza Nueva');
  assert.ok(after1.history.some((h) => h.change_type === 'location_verified'));
  // Corregir el registro manual de localidad asignando una ubicación existente
  const fix = await admin.post(`/api/people/${lx.data.id}/location`, { location: { localidad_id: g.L1.id, comuna_id: g.C1.id }, reason: 'Verificado por teléfono' });
  assert.equal(fix.status, 200);
  assert.equal(fix.data.location.status, 'verified');
  assert.equal((await admin.get(`/api/people?geo_status=pending&head_id=${ids.head}`)).data.total, 0);
});

test('7. Filtros geográficos combinables y conteos por ubicación', async () => {
  const q = async (params) => (await admin.get(`/api/people?head_id=${ids.head}&pageSize=200&${params}`)).data;
  const all = await q('');
  const inL2 = await q(`localidad_id=${g.L2.id}`);
  const inC3 = await q(`localidad_id=${g.L2.id}&comuna_id=${g.C3.id}`);
  const inPesc = await q(`localidad_id=${g.L2.id}&comuna_id=${g.C3.id}&barrio_id=${g.pescaito.id}`);
  assert.ok(inL2.rows.every((r) => r.geo_localidad_id === g.L2.id));
  assert.ok(inC3.rows.every((r) => r.geo_comuna_id === g.C3.id));
  assert.ok(inPesc.rows.every((r) => r.geo_barrio_id === g.pescaito.id && r.barrio_name === 'Pescaíto'));
  assert.ok(inPesc.total > 0 && inPesc.total < inC3.total && inC3.total < all.total);
  assert.equal(all.rows.filter((r) => r.geo_comuna_id === g.C3.id).length, inC3.total);
  // Combinación con líder
  assert.equal((await q(`comuna_id=${g.C3.id}&leader_id=${ids.leader}`)).total, inC3.rows.filter((r) => r.leader_id === ids.leader).length);
  // Conteos
  const st = (await admin.get(`/api/geo/stats?head_id=${ids.head}`)).data;
  const cnt = (id) => st.areas.find((a) => a.id === id).people;
  assert.equal(cnt(g.L2.id), inL2.total);
  assert.equal(cnt(g.C3.id), inC3.total);
  assert.equal(cnt(g.pescaito.id), inPesc.total);
  assert.equal(st.totals.total, all.total);
});

test('8-10. Rama completa por bloques ("Expandir todo") con distintas profundidades', async () => {
  // Estructura del enunciado: Juan > María > Pedro > Carlos > Andrea ; Juan > Laura > José > Camilo
  const mk = async (name, inviter, leader = false) => (await admin.post('/api/people', {
    ...person({ full_name: name }), head_id: ids.head, inviter_id: inviter, is_leader: leader,
  })).data.id;
  const juan = await mk('Juan Árbol', null, true);
  const maria = await mk('María Árbol', juan); const pedro = await mk('Pedro Árbol', maria);
  const carlos = await mk('Carlos Árbol', pedro); await mk('Andrea Árbol', carlos);
  const laura = await mk('Laura Árbol', juan); const jose = await mk('José Árbol', laura); await mk('Camilo Árbol', jose);
  // Rama profunda (30 niveles) y ancha
  let last = juan;
  for (let i = 0; i < 30; i++) last = await mk(`Profundo ${i}`, last);
  for (let i = 0; i < 25; i++) await mk(`Ancho ${i}`, laura);
  // Descarga completa en bloques pequeños para forzar la paginación
  const loadAll = async (root) => {
    const out = []; let after = null; let pages = 0;
    do {
      const r = (await admin.get(`/api/tree/${ids.head}/subtree?${root ? `root=${root}&` : ''}limit=7${after ? `&after=${encodeURIComponent(after)}` : ''}`)).data;
      out.push(...r.nodes); after = r.next; pages++;
    } while (after);
    return { out, pages };
  };
  const { out, pages } = await loadAll(juan);
  const juanNode = (await admin.get(`/api/tree/path/${juan}`)).data.chain.at(-1);
  assert.equal(out.length, juanNode.descendant_count, 'todos los descendientes, no sólo los visibles');
  assert.ok(pages > 5);
  assert.equal(new Set(out.map((n) => n.id)).size, out.length, 'sin duplicados entre bloques');
  const names = new Set(out.map((n) => n.full_name));
  for (const n of ['Andrea Árbol', 'Camilo Árbol', 'Profundo 29', 'Ancho 24']) assert.ok(names.has(n), n);
  // Cada nodo cuelga de un nodo ya recibido (o de la raíz): se puede reconstruir el árbol completo
  const seen = new Set([juan]);
  for (const n of out) { assert.ok(seen.has(n.inviter_id), `padre de ${n.full_name} recibido antes`); seen.add(n.id); }
  // Cabeza completa
  const whole = await loadAll(null);
  const head = (await admin.get(`/api/stats/dashboard?head_id=${ids.head}`)).data.totals.people;
  assert.equal(whole.out.length, head);
  // Restauración de ramas expandidas en una sola petición
  const batch = (await admin.post(`/api/tree/${ids.head}/children-batch`, { parents: [juan, laura, pedro] })).data;
  assert.equal(batch.nodes.filter((n) => n.inviter_id === laura).length, 26);
  // Alcance: un líder sólo recibe su rama
  await admin.post('/api/users', { username: 'lider.arbol', password: 'Clave1234!', role: 'leader', person_id: juan });
  const lc = await new Client(srv.base).login('lider.arbol', 'Clave1234!');
  const mine = (await lc.get(`/api/tree/${ids.head}/subtree?limit=5000`)).data.nodes;
  assert.ok(mine.every((n) => n.id === juan || seen.has(n.id)));
  assert.equal((await lc.get(`/api/tree/${ids.head}/subtree?root=${ids.leader}`)).status, 404);
  assert.deepEqual((await lc.post(`/api/tree/${ids.head}/children-batch`, { parents: [ids.leader] })).data.nodes, []);
});

test('11. Catálogo editable e importación sin duplicados; integridad intacta', async () => {
  const imp = await admin.post('/api/geo/import', { rows: [
    { localidad: 'Localidad 2', comuna: 'Comuna 3', barrio: 'Pescaíto' },
    { localidad: 'Localidad 2', comuna: 'Comuna 3', barrio: 'Barrio Importado' },
    { localidad: 'localidad 2', comuna: 'COMUNA 3', barrio: 'barrio importado' },
    { localidad: 'Localidad 1', comuna: 'Bonda', barrio: 'Vereda Prueba', tipo: 'vereda' },
    { comuna: 'Sin localidad' },
  ] });
  assert.equal(imp.status, 200);
  assert.equal(imp.data.created, 2);
  assert.equal(imp.data.errors.length, 1);
  const bonda = byName(await areas('comuna', g.L1.id), 'Bonda');
  assert.equal(byName(await areas('barrio', bonda.id), 'Vereda Prueba').kind, 'vereda');
  // Renombrar y desactivar
  const imported = byName(await areas('barrio', g.C3.id), 'Barrio Importado');
  assert.equal((await admin.patch(`/api/geo/areas/${imported.id}`, { name: 'Barrio Importado Corregido' })).status, 200);
  assert.equal((await admin.patch(`/api/geo/areas/${imported.id}`, { active: false })).status, 200);
  assert.equal((await areas('barrio', g.C3.id)).some((b) => b.id === imported.id), false, 'inactivo no aparece en el selector');
  // Mover un barrio con personas: las personas siguen siendo coherentes
  const mov = await admin.patch(`/api/geo/areas/${g.olaya.id}`, { parent_id: g.C2.id });
  assert.equal(mov.status, 200);
  await admin.patch(`/api/geo/areas/${g.olaya.id}`, { parent_id: g.C3.id });
  const integ = (await admin.get('/api/admin/integrity')).data;
  assert.equal(integ.ok, true, JSON.stringify(integ.issues.slice(0, 5)));
  const audit = (await admin.get('/api/audit?action=geo.&pageSize=50')).data.rows.map((r) => r.action);
  for (const a of ['geo.create', 'geo.update', 'geo.import', 'geo.resolve_pending']) assert.ok(audit.includes(a), a);
});

test('Formulario actual: nombres y apellidos, sin comuna y «¿Contamos contigo?»', async () => {
  const link = (await admin.get(`/api/people/${ids.leader}`)).data.links[0].token;
  const reg = (body) => anon.post(`/api/public/register/${link}`, { ...body, consent: true });
  const base = () => {
    const { full_name, ...rest } = person();
    return { ...rest, first_names: 'María José', last_names: 'Pérez Gómez', location: { localidad_id: g.L2.id, barrio_id: g.olaya.id } };
  };
  // Barrios de toda la localidad, con su comuna (lista del formulario)
  const all = (await anon.get(`/api/geo/areas?level=barrio&localidad_id=${g.L2.id}`)).data;
  const olaya = all.find((b) => b.id === g.olaya.id);
  assert.equal(olaya.parent_name, 'Comuna 3');
  assert.ok(all.every((b) => b.level === 'barrio') && all.some((b) => b.parent_kind === 'comuna'));
  // Obligatorios: nombres, apellidos y la respuesta Sí/No
  assert.equal((await reg({ ...base(), first_names: '' })).data.error.field, 'first_names');
  assert.equal((await reg({ ...base(), last_names: '3' })).data.error.field, 'last_names');
  assert.equal((await reg({ ...base(), supports: undefined })).data.error.field, 'supports');
  assert.equal((await reg({ ...base(), supports: 'tal vez' })).data.error.field, 'supports');
  const ok = await reg(base());
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  const p = (await admin.get(`/api/people?q=perez gomez`)).data.rows.find((r) => r.full_name === 'María José Pérez Gómez');
  assert.ok(p, 'nombre completo compuesto de nombres y apellidos');
  const d = (await admin.get(`/api/people/${p.id}`)).data;
  assert.equal(d.person.first_names, 'María José');
  assert.equal(d.person.last_names, 'Pérez Gómez');
  assert.equal(d.person.supports, 'yes');
  assert.equal(d.location.comuna.name, 'Comuna 3', 'comuna deducida');
  assert.equal(d.location.status, 'verified');
  // Barrio escrito a mano sin comuna: pendiente
  const man = await reg({ ...base(), first_names: 'Pedro', last_names: 'Manual Ruiz', supports: 'no',
    location: { localidad_id: g.L2.id, barrio_text: 'Brisas del Nuevo Sol' } });
  assert.equal(man.status, 201, JSON.stringify(man.data));
  const pend = (await admin.get('/api/geo/pending')).data.find((x) => x.geo_barrio_text === 'Brisas del Nuevo Sol');
  assert.equal(pend.level, 'barrio');
  assert.equal(pend.geo_comuna_id, null);
  // Filtro por respuesta
  const no = (await admin.get('/api/people?supports=no&q=manual ruiz')).data;
  assert.equal(no.total, 1);
  assert.equal(no.rows[0].supports, 'no');
  // Edición por partes
  const e = await admin.patch(`/api/people/${p.id}`, { first_names: 'María', last_names: 'Pérez', supports: 'no' });
  assert.equal(e.status, 200, JSON.stringify(e.data));
  assert.equal(e.data.full_name, 'María Pérez');
  assert.equal(e.data.supports, 'no');
  assert.equal((await admin.get('/api/admin/integrity')).data.ok, true);
});

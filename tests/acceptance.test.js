// Criterios de aceptación 1-14 verificados contra la API HTTP real.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, nextPhone, personFields } from './helpers.js';

let srv; let admin; let anon;
const ids = {};

before(async () => {
  srv = await startServer();
  admin = await new Client(srv.base).login('admin', 'Admin1234!');
  anon = new Client(srv.base);
  LOC = { localidad_id: (await anon.get('/api/geo/areas?level=localidad')).data[0].id };
});
after(() => srv.close());

const createHead = async (name) => {
  const r = await admin.post('/api/heads', { name, color: '#123456' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.id;
};
let LOC; // ubicación por defecto: primera localidad del catálogo
const manual = async (body, client = admin) => client.post('/api/people', { phone: nextPhone(), ...personFields(LOC), ...body });
const linkOf = async (personId, client = admin) => {
  const r = await client.get(`/api/people/${personId}`);
  return r.data.links.find((l) => l.status === 'active')?.token;
};
const register = (token, name, extra = {}) => anon.post(`/api/public/register/${token}`, { full_name: name, phone: nextPhone(), ...personFields(LOC), consent: true, ...extra });

test('1. Se pueden crear varias cabezas y cada una tiene su propio árbol', async () => {
  ids.norte = await createHead('Cabeza Norte');
  ids.sur = await createHead('Cabeza Sur');
  const dup = await admin.post('/api/heads', { name: 'cabeza norte' });
  assert.equal(dup.status, 400);
  const list = await admin.get('/api/heads');
  assert.equal(list.data.length, 2);
  const tN = await admin.get(`/api/tree/${ids.norte}/children`);
  const tS = await admin.get(`/api/tree/${ids.sur}/children`);
  assert.deepEqual([tN.data.total, tS.data.total], [0, 0]);
});

test('2. Se puede registrar un líder dentro de una cabeza (identificador y enlace únicos)', async () => {
  const r = await manual({ full_name: 'Juan Pérez', head_id: ids.norte, is_leader: true });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.leader_code, 'LID-JUAN-PEREZ');
  assert.equal(r.data.registration_method, 'manual');
  ids.juan = r.data.id;
  // Homónimo: identificador distinto
  const r2 = await manual({ full_name: 'Juan Perez', head_id: ids.sur, is_leader: true });
  assert.equal(r2.data.leader_code, 'LID-JUAN-PEREZ-2');
  ids.juanSur = r2.data.id;
  const inv = await anon.get('/api/public/invite/lid-juan-perez');
  assert.equal(inv.status, 200);
  assert.equal(inv.data.valid, true);
  assert.equal(inv.data.head.name, 'Cabeza Norte');
  const t = await admin.get(`/api/tree/${ids.norte}/children`);
  assert.equal(t.data.nodes[0].id, ids.juan);
  assert.equal(t.data.nodes[0].is_leader, true);
});

test('3. Registro manual asignado a su rama, conservando quién lo registró', async () => {
  const r = await manual({ full_name: 'Ana Morales', head_id: ids.norte, is_leader: true });
  ids.ana = r.data.id;
  const c = await manual({ full_name: 'Camilo Vargas', head_id: ids.norte, inviter_id: ids.ana });
  assert.equal(c.status, 201);
  ids.camilo = c.data.id;
  const d = await admin.get(`/api/people/${ids.camilo}`);
  assert.equal(d.data.inviter.id, ids.ana);
  assert.equal(d.data.leader.id, ids.ana);
  assert.equal(d.data.head.id, ids.norte);
  assert.equal(d.data.person.registration_method, 'manual');
  assert.equal(d.data.registered_by.display_name, 'Administrador general');
  assert.equal(d.data.history[0].change_type, 'registered');
  // Sin invitador sólo se admite a un líder
  const bad = await manual({ full_name: 'Sin Invitador', head_id: ids.norte });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error.code, 'INVITER_REQUIRED');
});

test('4-6. Cadena de invitaciones: personas normales invitan sin ser líderes, cada registro en su lugar', async () => {
  const juanToken = await linkOf(ids.juan);
  assert.equal(juanToken, 'LID-JUAN-PEREZ');
  const m = await register(juanToken, 'María Gómez');
  assert.equal(m.status, 201, JSON.stringify(m.data));
  assert.ok(m.data.invite_token.startsWith('INV-MARIA-GOMEZ-'));
  const maria = (await admin.get(`/api/search?q=maria gomez`)).data[0];
  ids.maria = maria.id;
  const p = await register(m.data.invite_token, 'Pedro Ramírez');
  ids.pedro = (await admin.get('/api/search?q=pedro')).data[0].id;
  const carlos = await register(p.data.invite_token, 'Carlos Rodríguez');
  await register(p.data.invite_token, 'Andrea López');
  await register(m.data.invite_token, 'Laura Martínez');
  assert.equal(carlos.status, 201);

  const md = (await admin.get(`/api/people/${ids.maria}`)).data;
  assert.equal(md.person.is_leader, false, 'María no se vuelve líder por invitar');
  assert.equal(md.invitees.length, 2);
  assert.deepEqual(md.invitees.map((x) => x.full_name).sort(), ['Laura Martínez', 'Pedro Ramírez']);
  assert.equal(md.stats.total, 4, 'Rama de María: Pedro, Carlos, Andrea, Laura');

  const pd = (await admin.get(`/api/people/${ids.pedro}`)).data;
  assert.equal(pd.inviter.id, ids.maria, 'Pedro invitado directamente por María');
  assert.equal(pd.person.is_leader, false);
  assert.deepEqual(pd.chain.map((c) => c.full_name), ['Juan Pérez', 'María Gómez', 'Pedro Ramírez']);
  assert.equal(pd.person.registration_method, 'invitation');
  assert.equal(pd.via_link.owner_person_id, ids.maria);

  // Árbol: hijos de Pedro
  const kids = (await admin.get(`/api/tree/${ids.norte}/children?parent=${ids.pedro}`)).data;
  assert.deepEqual(kids.nodes.map((n) => n.full_name).sort(), ['Andrea López', 'Carlos Rodríguez']);
  assert.ok(kids.nodes.every((n) => n.inviter_id === ids.pedro && n.inviter_name === 'Pedro Ramírez'));
  const root = (await admin.get(`/api/tree/${ids.norte}/children`)).data.nodes.find((n) => n.id === ids.juan);
  assert.equal(root.descendant_count, 5);
});

test('7. Se distingue líder responsable de invitador directo', async () => {
  const jose = await manual({ full_name: 'José Hernández', head_id: ids.norte, is_leader: true, inviter_id: ids.juan });
  ids.jose = jose.data.id;
  assert.equal(jose.data.leader_id, ids.juan, 'José (líder) responde ante Juan');
  const ric = await register('LID-JOSE-HERNANDEZ', 'Ricardo Torres');
  ids.ricardo = (await admin.get('/api/search?q=ricardo')).data[0].id;
  const sofia = await register(ric.data.invite_token, 'Sofía Castro');
  assert.equal(sofia.status, 201);
  ids.sofia = (await admin.get('/api/search?q=sofia')).data[0].id;
  const s = (await admin.get(`/api/people/${ids.sofia}`)).data;
  assert.equal(s.inviter.id, ids.ricardo, 'Invitador directo: Ricardo');
  assert.equal(s.leader.id, ids.jose, 'Líder responsable: José');
  const carlos = (await admin.get('/api/search?q=carlos')).data[0];
  assert.equal(carlos.leader_name, 'Juan Pérez');
  assert.equal(carlos.inviter_name, 'Pedro Ramírez');

  // Designar formalmente a Pedro como líder reasigna automáticamente su rama, sin tocar el invitador.
  const pr = await admin.post(`/api/people/${ids.pedro}/promote`, { reason: 'Designación' });
  assert.equal(pr.status, 200);
  assert.equal(pr.data.affected, 2);
  const c2 = (await admin.get(`/api/people/${carlos.id}`)).data;
  assert.equal(c2.leader.id, ids.pedro);
  assert.equal(c2.inviter.id, ids.pedro);
  assert.ok(c2.history.some((h) => h.change_type === 'leader_changed'));
  // Asignación manual de responsable a un líder fuera de su cadena
  const set = await admin.post(`/api/people/${carlos.id}/leader`, { leader_id: ids.ana, reason: 'Reparto territorial' });
  assert.equal(set.status, 200);
  assert.equal(set.data.leader_id, ids.ana);
  assert.equal(set.data.leader_mode, 'manual');
  assert.equal(set.data.inviter_id, ids.pedro, 'el invitador no cambia');
  // Un no líder no puede ser responsable
  const bad = await admin.post(`/api/people/${carlos.id}/leader`, { leader_id: ids.maria });
  assert.equal(bad.status, 400);
  // Retirar liderazgo devuelve la rama al líder superior
  const dm = await admin.post(`/api/people/${ids.pedro}/demote`, { reason: 'Fin de designación' });
  assert.equal(dm.status, 200);
  const andrea = (await admin.get('/api/search?q=andrea')).data[0];
  assert.equal(andrea.leader_name, 'Juan Pérez');
});

test('8. Los enlaces no permiten cambiar la estructura manipulando URL o cuerpo', async () => {
  const r = await anon.post('/api/public/register/LID-JUAN-PEREZ?head_id=' + ids.sur + '&inviter_id=' + ids.juanSur, {
    full_name: 'Intruso Manipulador', phone: nextPhone(), ...personFields(LOC), consent: true,
    head_id: ids.sur, inviter_id: ids.juanSur, leader_id: ids.juanSur, is_leader: true, status: 'active', registration_method: 'manual',
  });
  assert.equal(r.status, 201);
  const p = (await admin.get('/api/search?q=intruso')).data[0];
  const d = (await admin.get(`/api/people/${p.id}`)).data;
  assert.equal(d.head.id, ids.norte);
  assert.equal(d.inviter.id, ids.juan);
  assert.equal(d.person.is_leader, false);
  assert.equal(d.person.registration_method, 'invitation');
  // Token inexistente o mal formado
  assert.equal((await anon.get('/api/public/invite/LID-NO-EXISTE')).status, 404);
  assert.equal((await anon.get('/api/public/invite/..%2F..%2Fetc')).status, 404);
  // Enlace desactivado
  const links = (await admin.get(`/api/links?q=ANA-MORALES`)).data.rows;
  const anaLink = links.find((l) => l.kind === 'leader');
  assert.equal((await admin.post(`/api/links/${anaLink.id}/disable`, { reason: 'Comprometido' })).status, 200);
  const blocked = await register(anaLink.token, 'Tras Desactivar');
  assert.equal(blocked.status, 400);
  assert.equal(blocked.data.error.code, 'LINK_INVALID');
  assert.equal((await admin.post(`/api/links/${anaLink.id}/enable`, {})).status, 200);
  // Sin consentimiento o con honeypot
  assert.equal((await register('LID-JUAN-PEREZ', 'Sin Consentimiento', { consent: false })).status, 400);
  assert.equal((await register('LID-JUAN-PEREZ', 'Robot Spam', { website: 'x' })).status, 400);
  // Límite de usos
  await admin.patch(`/api/links/${anaLink.id}`, { max_uses: 1 });
  assert.equal((await register(anaLink.token, 'Dentro Del Limite')).status, 201);
  const over = await register(anaLink.token, 'Excede Limite');
  assert.equal(over.status, 400);
  await admin.patch(`/api/links/${anaLink.id}`, { max_uses: null });
});

test('9. No se generan duplicados ni relaciones circulares', async () => {
  const p = (await admin.get(`/api/people/${ids.maria}`)).data.person;
  const dup = await anon.post('/api/public/register/LID-JUAN-PEREZ', { full_name: 'Otra María', phone: p.phone, ...personFields(LOC), consent: true });
  assert.equal(dup.status, 409);
  // Cédula duplicada (con puntos, como suele escribirse) en registro público y manual de otra cabeza
  const ced = p.document_id.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const dupDoc = await anon.post('/api/public/register/LID-JUAN-PEREZ', { full_name: 'Otra Cédula', phone: nextPhone(), ...personFields(LOC), document_id: ced, consent: true });
  assert.equal(dupDoc.status, 409);
  assert.equal(dupDoc.data.error.field, 'document_id');
  const dupDoc2 = await manual({ full_name: 'Cédula Repetida', head_id: ids.sur, inviter_id: ids.juanSur, document_id: p.document_id });
  assert.equal(dupDoc2.status, 409);
  assert.match(dupDoc2.data.error.message, /cédula/);
  assert.equal(dup.data.existing, undefined, 'el formulario público no revela el registro existente');
  const dup2 = await manual({ full_name: 'Duplicada en Sur', head_id: ids.sur, inviter_id: ids.juanSur, phone: '+57 ' + p.phone });
  assert.equal(dup2.status, 409, 'el teléfono es único entre cabezas (no puede estar en dos cabezas)');
  // Ciclo: mover a María debajo de Carlos (que está en su propia rama)
  const carlos = (await admin.get('/api/search?q=carlos')).data[0];
  const cyc = await admin.post(`/api/people/${ids.maria}/move`, { inviter_id: carlos.id, reason: 'Prueba de ciclo' });
  assert.equal(cyc.status, 400);
  assert.equal(cyc.data.error.code, 'CYCLE');
  const self = await admin.post(`/api/people/${ids.maria}/move`, { inviter_id: ids.maria, reason: 'Prueba de ciclo' });
  assert.equal(self.data.error.code, 'CYCLE');
  // Invitador de otra cabeza
  const cross = await manual({ full_name: 'Cruzado Cabezas', head_id: ids.norte, inviter_id: ids.juanSur });
  assert.equal(cross.data.error.code, 'INVITER_OTHER_HEAD');
  const integ = (await admin.get('/api/admin/integrity')).data;
  assert.equal(integ.ok, true, JSON.stringify(integ.issues));
});

test('10. La búsqueda encuentra a una persona y localiza su rama', async () => {
  const byName = (await admin.get('/api/search?q=sofia castro')).data;
  assert.equal(byName.length, 1);
  const byCode = (await admin.get(`/api/search?q=${byName[0].code}`)).data;
  assert.equal(byCode[0].id, ids.sofia);
  const d = (await admin.get(`/api/people/${ids.sofia}`)).data;
  const byPhone = (await admin.get(`/api/search?q=${d.person.phone.slice(-6)}`)).data;
  assert.ok(byPhone.some((x) => x.id === ids.sofia));
  const path = (await admin.get(`/api/tree/path/${ids.sofia}`)).data;
  assert.deepEqual(path.chain.map((n) => n.full_name), ['Juan Pérez', 'José Hernández', 'Ricardo Torres', 'Sofía Castro']);
  const dir = (await admin.get('/api/people?q=sofia')).data;
  assert.equal(dir.total, 1);
  assert.equal(dir.rows[0].inviter_name, 'Ricardo Torres');
  assert.equal(dir.rows[0].leader_name, 'José Hernández');
});

test('11. Los permisos impiden consultar o modificar fuera del alcance', async () => {
  // Cuentas
  const mk = (b) => admin.post('/api/users', { password: 'Clave1234!', ...b });
  assert.equal((await mk({ username: 'adm.sur', role: 'head_admin', head_ids: [ids.sur] })).status, 201);
  assert.equal((await mk({ username: 'jose', role: 'leader', person_id: ids.jose })).status, 201);
  assert.equal((await mk({ username: 'ricardo', role: 'member', person_id: ids.ricardo })).status, 201);
  // No se concede cuenta de líder a quien solo invita
  const fake = await mk({ username: 'ricardo2', role: 'leader', person_id: ids.ricardo });
  assert.equal(fake.data.error.code, 'NOT_LEADER');

  const sur = await new Client(srv.base).login('adm.sur', 'Clave1234!');
  assert.equal((await sur.get(`/api/people/${ids.maria}`)).status, 404);
  assert.equal((await sur.get(`/api/tree/${ids.norte}/children`)).status, 404);
  assert.equal((await sur.patch(`/api/people/${ids.maria}`, { full_name: 'Hackeada' })).status, 404);
  assert.equal((await sur.post('/api/people', { full_name: 'Otro', phone: nextPhone(), head_id: ids.norte, inviter_id: ids.juan })).status, 403);
  assert.equal((await sur.post('/api/heads', { name: 'Nueva' })).status, 403);
  assert.ok((await sur.get('/api/people')).data.rows.every((r) => r.head_id === ids.sur));
  assert.equal((await sur.get('/api/heads')).data.length, 1);
  assert.equal((await sur.get('/api/audit')).status, 403);
  // Mover a su cabeza a alguien de otra cabeza: prohibido
  assert.equal((await sur.post(`/api/people/${ids.camilo}/move`, { inviter_id: ids.juanSur, reason: 'robo de rama' })).status, 404);

  const jose = await new Client(srv.base).login('jose', 'Clave1234!');
  const jdir = (await jose.get('/api/people?pageSize=100')).data;
  assert.deepEqual(jdir.rows.map((r) => r.full_name).sort(), ['José Hernández', 'Ricardo Torres', 'Sofía Castro']);
  assert.equal((await jose.get(`/api/people/${ids.maria}`)).status, 404);
  assert.equal((await jose.patch(`/api/people/${ids.sofia}`, { full_name: 'X Y Z' })).status, 403);
  assert.equal((await jose.post('/api/people', { full_name: 'Otro', phone: nextPhone(), head_id: ids.norte, inviter_id: ids.jose })).status, 403);
  const jroot = (await jose.get(`/api/tree/${ids.norte}/children`)).data;
  assert.deepEqual(jroot.nodes.map((n) => n.id), [ids.jose]);
  assert.equal((await jose.get(`/api/tree/${ids.norte}/children?parent=${ids.juan}`)).status, 404);
  const jpath = (await jose.get(`/api/tree/path/${ids.sofia}`)).data;
  assert.equal(jpath.chain[0].id, ids.jose, 'no ve ancestros fuera de su alcance');

  const ric = await new Client(srv.base).login('ricardo', 'Clave1234!');
  const rd = (await ric.get(`/api/people/${ids.sofia}`)).data;
  assert.ok(rd.person.phone.includes('*'), 'una persona no ve el teléfono completo de sus invitados');
  assert.equal((await ric.get(`/api/people/${ids.jose}`)).status, 404);
  assert.equal((await ric.post(`/api/people/${ids.sofia}/promote`, {})).status, 403);
  assert.equal((await ric.get('/api/pending')).status, 403);
  // Puede generar su propia invitación, pero no la de otros
  assert.equal((await ric.post(`/api/people/${ids.ricardo}/link`, {})).status, 200);
  assert.equal((await ric.post(`/api/people/${ids.sofia}/link`, {})).status, 403);
  // Dashboard y estadísticas limitados al alcance de cada rol
  const sd = await sur.get('/api/stats/dashboard');
  assert.equal(sd.status, 200, JSON.stringify(sd.data));
  assert.deepEqual(sd.data.perHead.map((h) => h.id), [ids.sur]);
  assert.equal(sd.data.totals.heads, 1);
  const jd = await jose.get('/api/stats/dashboard');
  assert.equal(jd.status, 200, JSON.stringify(jd.data));
  assert.equal(jd.data.totals.people, 3, 'el líder sólo cuenta su estructura');
  const rdash = await ric.get('/api/stats/dashboard');
  assert.equal(rdash.status, 200);
  assert.equal(rdash.data.totals.people, 2);
  assert.equal((await sur.get(`/api/stats/dashboard?head_id=${ids.norte}`)).status, 404);
  assert.equal((await jose.get(`/api/heads/${ids.norte}`)).status, 200);
  assert.equal((await jose.get(`/api/heads/${ids.sur}`)).status, 404);
  assert.deepEqual((await jose.get('/api/leaders')).data.map((l) => l.id), [ids.jose]);
  assert.ok((await jose.get('/api/links')).data.rows.every((l) => [ids.jose, ids.ricardo, ids.sofia].includes(l.owner_person_id)));
  // Sin sesión
  assert.equal((await anon.get('/api/people')).status, 401);
});

test('Flujo de aprobación y movimiento entre cabezas con historial', async () => {
  await admin.patch(`/api/heads/${ids.sur}`, { requires_approval: true });
  const r = await register('LID-JUAN-PEREZ-2', 'Pendiente Sur');
  assert.equal(r.data.status, 'pending');
  assert.equal(r.data.invite_token, null, 'pendiente: aún no puede invitar');
  const pend = (await admin.get('/api/pending')).data;
  assert.equal(pend.length, 1);
  const ap = await admin.post(`/api/people/${pend[0].id}/status`, { status: 'active' });
  assert.equal(ap.status, 200);
  assert.equal((await admin.get(`/api/people/${pend[0].id}`)).data.links.length, 1);

  // Mover la rama de José (líder) de Norte a Sur debajo de Juan Perez (Sur)
  const mv = await admin.post(`/api/people/${ids.jose}/move`, { inviter_id: ids.juanSur, reason: 'Reorganización territorial' });
  assert.equal(mv.status, 200, JSON.stringify(mv.data));
  assert.equal(mv.data.branchSize, 3);
  const s = (await admin.get(`/api/people/${ids.sofia}`)).data;
  assert.equal(s.head.id, ids.sur);
  assert.equal(s.inviter.id, ids.ricardo, 'el invitador directo se conserva');
  assert.ok(s.history.some((h) => h.change_type === 'moved_head'));
  const j = (await admin.get(`/api/people/${ids.jose}`)).data;
  assert.equal(j.leader.id, ids.juanSur);
  assert.equal(j.history.find((h) => h.change_type === 'moved_head').reason, 'Reorganización territorial');
  const noReason = await admin.post(`/api/people/${ids.jose}/move`, { inviter_id: ids.juan });
  assert.equal(noReason.data.error.code, 'REASON_REQUIRED');
  assert.equal((await admin.get('/api/admin/integrity')).data.ok, true);
});

test('13. Contadores y estadísticas coinciden con los registros reales', async () => {
  const dash = (await admin.get('/api/stats/dashboard')).data;
  const all = (await admin.get('/api/people?pageSize=200')).data;
  assert.equal(dash.totals.people, all.total);
  assert.equal(dash.totals.leaders, all.rows.filter((r) => r.is_leader).length);
  assert.equal(dash.totals.heads, 2);
  const sumHeads = dash.perHead.reduce((a, h) => a + h.people, 0);
  assert.equal(sumHeads, all.total);
  for (const h of dash.perHead) assert.equal(h.people, all.rows.filter((r) => r.head_id === h.id).length);
  const last = dash.growth.series.at(-1).values;
  for (const h of dash.perHead) assert.equal(last[h.id], h.people);
  for (const l of dash.perLeader) assert.equal(l.assigned, all.rows.filter((r) => r.leader_id === l.id).length);
  // Conteo de nodos del árbol = tamaño real de la rama
  const juan = (await admin.get(`/api/tree/${ids.norte}/children`)).data.nodes.find((n) => n.id === ids.juan);
  const juanStats = (await admin.get(`/api/people/${ids.juan}`)).data.stats;
  assert.equal(juan.descendant_count, juanStats.total);
  // Usos de enlaces
  const links = (await admin.get('/api/links?pageSize=200')).data.rows;
  const viaInvitation = all.rows.filter((r) => r.registration_method === 'invitation').length;
  assert.equal(links.reduce((a, l) => a + l.uses, 0), viaInvitation);
});

test('14. Se conserva el historial y la auditoría de cambios importantes', async () => {
  const p = await admin.patch(`/api/people/${ids.camilo}`, { full_name: 'Camilo A. Vargas', reason: 'Corrección' });
  assert.equal(p.status, 200);
  const d = (await admin.get(`/api/people/${ids.camilo}`)).data;
  const h = d.history.find((x) => x.change_type === 'data_updated');
  assert.deepEqual(h.details.fields.full_name, { from: 'Camilo Vargas', to: 'Camilo A. Vargas' });
  const inact = await admin.post(`/api/people/${ids.camilo}/status`, { status: 'inactive', reason: 'Baja voluntaria' });
  assert.equal(inact.status, 200);
  const audit = (await admin.get('/api/audit?pageSize=200')).data.rows.map((r) => r.action);
  for (const a of ['person.create_manual', 'person.register_invite', 'person.promote_leader', 'person.demote_leader',
    'person.move_head', 'person.update', 'person.deactivated', 'link.disable', 'user.create', 'auth.login']) {
    assert.ok(audit.includes(a), `falta auditoría ${a}`);
  }
  const bad = await admin.post(`/api/people/${ids.camilo}/status`, { status: 'inactive' });
  assert.equal(bad.status, 400);
});

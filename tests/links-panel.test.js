// Tipos de registro con color, enlaces de registro tipados (persona, líder, cabeza) y panel privado del líder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, nextPhone, nextDoc } from './helpers.js';

let srv; let admin; let anon;
const ids = {};
let loc;

before(async () => {
  srv = await startServer();
  admin = await new Client(srv.base).login('admin', 'Admin1234!');
  anon = new Client(srv.base);
  loc = { localidad_id: (await anon.get('/api/geo/areas?level=localidad')).data[0].id };
});
after(() => srv.close());

const form = (first, last, extra = {}) => ({
  first_names: first, last_names: last, document_id: nextDoc(), address: 'Calle 1 # 2-3', phone: nextPhone(),
  location: loc, supports: 'yes', consent: true, ...extra,
});

test('Tipos base y tipos personalizados con color', async () => {
  const types = (await admin.get('/api/reg-types')).data;
  const base = Object.fromEntries(types.filter((t) => t.builtin).map((t) => [t.role, t]));
  assert.deepEqual(Object.keys(base).sort(), ['head', 'leader', 'person']);
  ids.types = base;
  // Color editable; los tipos base no se desactivan
  assert.equal((await admin.patch(`/api/reg-types/${base.leader.id}`, { color: '#FF0000' })).data.color, '#ff0000');
  assert.equal((await admin.patch(`/api/reg-types/${base.leader.id}`, { active: false })).status, 400);
  // Nuevos tipos: siempre pertenecen a cabeza, líder o persona
  const voto = await admin.post('/api/reg-types', { name: 'Voto seguro', role: 'person', color: '#16a34a' });
  assert.equal(voto.status, 201, JSON.stringify(voto.data));
  const aspirante = await admin.post('/api/reg-types', { name: 'Líder aspirante', role: 'leader', color: '#0ea5e9' });
  const concejal = await admin.post('/api/reg-types', { name: 'Concejal', role: 'head', color: '#be123c' });
  assert.equal((await admin.post('/api/reg-types', { name: 'Otro', role: 'jefe', color: '#000000' })).data.error.field, 'role');
  assert.equal((await admin.post('/api/reg-types', { name: 'voto SEGURO', role: 'person', color: '#000000' })).status, 400, 'nombre duplicado');
  assert.equal((await admin.post('/api/reg-types', { name: 'Sin color', role: 'person', color: 'rojo' })).data.error.field, 'color');
  Object.assign(ids, { voto: voto.data, aspirante: aspirante.data, concejal: concejal.data });

  const h = await admin.post('/api/heads', { name: 'Cabeza Enlaces' });
  ids.head = h.data.id;
  const l = await admin.post('/api/people', { full_name: 'Líder Base', document_id: nextDoc(), address: 'Calle 9 # 9-9', phone: nextPhone(),
    location: loc, head_id: ids.head, is_leader: true });
  assert.equal(l.status, 201, JSON.stringify(l.data));
  ids.leader = l.data;
  assert.equal(l.data.reg_type_id, base.leader.id, 'líder manual con el tipo base Líder');
});

test('Enlace de registro de líder: quien se registra queda como líder, con su enlace y su panel', async () => {
  const link = await admin.post('/api/links', { reg_type_id: ids.aspirante.id, head_id: ids.head, label: 'Aspirantes zona norte' });
  assert.equal(link.status, 201, JSON.stringify(link.data));
  assert.match(link.data.token, /^REG-[A-Z0-9]{8}$/, 'sin el nombre del tipo');
  const inv = (await anon.get(`/api/public/invite/${link.data.token}`)).data;
  assert.equal(inv.valid, true);
  assert.equal(inv.role, 'leader');
  assert.deepEqual(inv.type, { name: 'Líder aspirante', color: '#0ea5e9', role: 'leader' });
  assert.equal(inv.inviter, null);

  const r = await anon.post(`/api/public/register/${link.data.token}`, form('Ana María', 'Ruiz Díaz'));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.is_leader, true);
  assert.equal(r.data.leader_code, 'ANA-MARIA-RUIZ');
  assert.equal(r.data.invite_token, 'ANA-MARIA-RUIZ');
  assert.ok(r.data.panel_token && r.data.panel_token.length >= 30);
  ids.ana = { token: r.data.panel_token, invite: r.data.invite_token };
  const found = (await admin.get('/api/people?q=ana maria ruiz')).data.rows[0];
  assert.equal(found.is_leader, true);
  assert.equal(found.reg_type_id, ids.aspirante.id);
  assert.equal(found.inviter_id, null, 'sin padrino: cuelga de la cabeza');
  const d = (await admin.get(`/api/people/${found.id}`)).data.person;
  assert.equal(d.panel_active, true);
  assert.equal(d.panel_token_hash, undefined, 'la huella del panel nunca se expone');
  ids.anaId = found.id;

  // Con padrino: el líder registrado cuelga de quien se indicó
  const l2 = await admin.post('/api/links', { reg_type_id: ids.types.leader.id, head_id: ids.head, owner_person_id: ids.leader.id });
  const r2 = await anon.post(`/api/public/register/${l2.data.token}`, form('Pedro', 'Sub Líder'));
  assert.equal(r2.status, 201, JSON.stringify(r2.data));
  const p2 = (await admin.get('/api/people?q=pedro sub')).data.rows[0];
  assert.equal(p2.inviter_id, ids.leader.id);
  assert.equal(p2.is_leader, true);
});

test('Enlace de tipo persona («Voto seguro»): persona invitada, sin panel', async () => {
  assert.equal((await admin.post('/api/links', { reg_type_id: ids.voto.id, head_id: ids.head })).data.error.field, 'owner_person_id',
    'una persona siempre necesita de quién colgar');
  const link = await admin.post('/api/links', { reg_type_id: ids.voto.id, head_id: ids.head, owner_person_id: ids.anaId });
  assert.equal(link.status, 201, JSON.stringify(link.data));
  const inv = (await anon.get(`/api/public/invite/${link.data.token}`)).data;
  assert.equal(inv.type.color, '#16a34a');
  assert.equal(inv.inviter.name, 'Ana María Ruiz Díaz');
  const r = await anon.post(`/api/public/register/${link.data.token}`, form('Luis', 'Votante Uno'));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.is_leader, false);
  assert.equal(r.data.panel_token, null);
  const p = (await admin.get('/api/people?q=luis votante')).data.rows[0];
  assert.equal(p.reg_type_id, ids.voto.id);
  assert.equal(p.inviter_id, ids.anaId);
  // Filtro del directorio por tipo
  const byType = (await admin.get(`/api/people?reg_type_id=${ids.voto.id}`)).data;
  assert.equal(byType.total, 1);
  // Invitados por el enlace de líder de Ana: tipo Persona
  const r2 = await anon.post(`/api/public/register/${ids.ana.invite}`, form('Marta', 'Invitada Ana'));
  assert.equal(r2.status, 201, JSON.stringify(r2.data));
  assert.equal((await admin.get('/api/people?q=marta invitada')).data.rows[0].reg_type_id, ids.types.person.id);
  // Un tipo de persona no sirve para un líder
  const bad = await admin.patch(`/api/people/${ids.anaId}`, { reg_type_id: ids.voto.id });
  assert.equal(bad.data.error.field, 'reg_type_id');
});

test('Enlace de tipo cabeza («Concejal»): crea la cabeza y su primer líder; un solo uso por defecto', async () => {
  const headAdmin = await admin.post('/api/users', { username: 'adm.enl', password: 'AdmEnl1234!', role: 'head_admin', head_ids: [ids.head] });
  assert.equal(headAdmin.status, 201, JSON.stringify(headAdmin.data));
  const ha = await new Client(srv.base).login('adm.enl', 'AdmEnl1234!');
  assert.equal((await ha.post('/api/links', { reg_type_id: ids.concejal.id })).status, 403, 'sólo el administrador general');
  const link = await admin.post('/api/links', { reg_type_id: ids.concejal.id });
  assert.equal(link.status, 201, JSON.stringify(link.data));
  assert.equal(link.data.max_uses, 1);
  assert.equal(link.data.head_id, null);
  const inv = (await anon.get(`/api/public/invite/${link.data.token}`)).data;
  assert.equal(inv.role, 'head');
  assert.equal(inv.head, null);
  const r = await anon.post(`/api/public/register/${link.data.token}`, form('Carlos', 'Mendoza'));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.head, 'Concejal Carlos Mendoza');
  assert.equal(r.data.is_leader, true);
  assert.ok(r.data.panel_token);
  const heads = (await admin.get('/api/heads')).data;
  const h = heads.find((x) => x.name === 'Concejal Carlos Mendoza');
  assert.equal(h.color, '#be123c', 'la cabeza toma el color del tipo');
  // Segundo uso: rechazado
  assert.equal((await anon.post(`/api/public/register/${link.data.token}`, form('Otro', 'Concejal'))).data.error.code, 'LINK_INVALID');
  // Un registro fallido no deja cabezas huérfanas
  const l2 = await admin.post('/api/links', { reg_type_id: ids.concejal.id });
  const dup = await anon.post(`/api/public/register/${l2.data.token}`, form('Carlos', 'Duplicado', { document_id: '1082111222' }));
  assert.equal(dup.status, 201);
  const l3 = await admin.post('/api/links', { reg_type_id: ids.concejal.id });
  const before = (await admin.get('/api/heads')).data.length;
  assert.equal((await anon.post(`/api/public/register/${l3.data.token}`, form('Repite', 'Cedula', { document_id: '1082111222' }))).status, 409);
  assert.equal((await admin.get('/api/heads')).data.length, before);
  // Listado de enlaces: los de registro aparecen con su tipo y color; el administrador de cabeza sólo ve los de su cabeza
  const all = (await admin.get('/api/links?kind=register')).data.rows;
  assert.ok(all.some((l) => l.type_name === 'Concejal' && l.type_color === '#be123c' && l.head_id === null));
  const mine = (await ha.get('/api/links?kind=register')).data.rows;
  assert.ok(mine.length > 0 && mine.every((l) => l.head_id === ids.head));
  assert.equal((await admin.get('/api/admin/integrity')).data.ok, true);
});

test('Panel del líder: enlace secreto + PIN, sólo lectura, contactos enmascarados y revocable', async () => {
  const open = (body, token = ids.ana.token) => anon.post(`/api/public/panel/${token}`, body);
  assert.equal((await open({})).data.error.code, 'PIN_REQUIRED');
  assert.equal((await open({ pin: '0000' })).data.error.code, 'PIN_INVALID');
  assert.equal((await open({ pin: '1234' }, 'x'.repeat(32))).status, 404);
  const ana = (await admin.get(`/api/people/${ids.anaId}`)).data.person;
  const pin = ana.document_id.slice(-4);
  const r = await open({ pin });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.person.full_name, 'Ana María Ruiz Díaz');
  assert.equal(r.data.type.name, 'Líder aspirante');
  assert.equal(r.data.invite_token, 'ANA-MARIA-RUIZ');
  assert.equal(r.data.stats.total, 2);
  assert.equal(r.data.stats.direct, 2);
  const luis = r.data.people.rows.find((x) => x.full_name === 'Luis Votante Uno');
  assert.match(luis.phone, /^\*{6}\d{4}$/, 'celular enmascarado');
  assert.equal(luis.type_name, 'Voto seguro');
  assert.equal(r.data.people.rows.some((x) => x.full_name === 'Líder Base'), false, 'sólo su rama');
  assert.equal((await open({ pin, q: 'marta' })).data.people.total, 1);
  // Bloqueo tras varios PIN incorrectos
  for (let i = 0; i < 8; i++) await open({ pin: '9999' });
  assert.equal((await open({ pin })).data.error.code, 'PIN_LOCKED');
  // Regenerar invalida el anterior; revocar lo apaga
  const re = await admin.post(`/api/people/${ids.anaId}/panel`);
  assert.equal(re.status, 200);
  assert.equal((await open({ pin }, ids.ana.token)).status, 404);
  assert.equal((await open({ pin }, re.data.token)).status, 200);
  assert.equal((await admin.post(`/api/people/${ids.anaId}/panel/revoke`)).status, 200);
  assert.equal((await open({ pin }, re.data.token)).status, 404);
  // Sólo para líderes
  const luisId = (await admin.get('/api/people?q=luis votante')).data.rows[0].id;
  assert.equal((await admin.post(`/api/people/${luisId}/panel`)).data.error.code, 'NOT_LEADER');
});

test('«¿Es voto seguro?» la valora quien registra; el registro público no puede fijarla', async () => {
  const base = { first_names: 'Rosa', last_names: 'Valorada', document_id: nextDoc(), address: 'Calle 3 # 4-5', phone: nextPhone(), location: loc };
  const m = await admin.post('/api/people', { ...base, head_id: ids.head, inviter_id: ids.anaId, secure_vote: 'yes' });
  assert.equal(m.status, 201, JSON.stringify(m.data));
  assert.equal(m.data.secure_vote, 'yes');
  assert.equal(m.data.supports, null, 'la respuesta propia queda sin responder');
  assert.equal((await admin.post('/api/people', { ...base, document_id: nextDoc(), phone: nextPhone(), head_id: ids.head, inviter_id: ids.anaId, secure_vote: 'tal vez' })).data.error.field, 'secure_vote');
  // Por enlace: se ignora aunque se envíe
  const pub = await anon.post(`/api/public/register/${ids.ana.invite}`, form('Tomás', 'Publico', { secure_vote: 'yes' }));
  assert.equal(pub.status, 201, JSON.stringify(pub.data));
  const t = (await admin.get('/api/people?q=tomas publico')).data.rows[0];
  assert.equal(t.secure_vote, null);
  assert.equal(t.supports, 'yes');
  // Se valora después desde la ficha y se filtra
  assert.equal((await admin.patch(`/api/people/${t.id}`, { secure_vote: 'no' })).data.secure_vote, 'no');
  assert.equal((await admin.get('/api/people?secure_vote=yes&q=rosa valorada')).data.total, 1);
  assert.equal((await admin.get('/api/people?secure_vote=no&q=tomas publico')).data.total, 1);
});

test('Enlaces generales: sólo para tipos de persona (uno por cabeza y líder, reutilizable)', async () => {
  // Cabezas y líderes no tienen enlace general: se registran con enlaces de un solo uso
  assert.equal((await admin.post('/api/links/general', { reg_type_id: ids.concejal.id })).data.error.code, 'ONE_TIME_ONLY');
  assert.equal((await admin.post('/api/links/general', { reg_type_id: ids.types.leader.id, head_id: ids.head })).data.error.code, 'ONE_TIME_ONLY');
  assert.equal((await admin.post('/api/links/general', { reg_type_id: ids.voto.id, head_id: ids.head })).data.error.field, 'owner_person_id');
  const gp = await admin.post('/api/links/general', { reg_type_id: ids.voto.id, head_id: ids.head, owner_person_id: ids.leader.id });
  assert.equal(gp.status, 200, JSON.stringify(gp.data));
  assert.equal(gp.data.max_uses, null);
  assert.equal((await admin.post('/api/links/general', { reg_type_id: ids.voto.id, head_id: ids.head, owner_person_id: ids.leader.id })).data.token, gp.data.token);
  for (const n of ['Uno', 'Dos']) {
    assert.equal((await anon.post(`/api/public/register/${gp.data.token}`, form('Votante', `General ${n}`))).status, 201);
  }
});

test('Enlaces de un solo uso para cabezas y líderes: uno por envío, atómicos, no reutilizables y con caducidad', async () => {
  const gen = (body) => admin.post('/api/links/one-time', body);
  const a = await gen({ reg_type_id: ids.concejal.id });
  const b = await gen({ reg_type_id: ids.concejal.id });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  assert.notEqual(a.data.token, b.data.token, 'cada envío es un enlace distinto');
  assert.match(a.data.token, /^REG-[A-Z2-9]{12}$/, 'código largo, no adivinable');
  assert.equal(a.data.max_uses, 1);
  assert.equal(a.data.one_time, 1);
  const days = (Date.parse(a.data.expires_at) - Date.now()) / 864e5;
  assert.ok(days > 6.9 && days < 7.1, 'caduca a los 7 días');
  assert.equal((await gen({ reg_type_id: ids.voto.id })).status, 400, 'las personas usan el enlace general');
  // Primer uso: crea la cabeza. Segundo uso (reenviado): rechazado.
  assert.equal((await anon.post(`/api/public/register/${a.data.token}`, form('Primera', 'Concejal'))).status, 201);
  const reuse = await anon.post(`/api/public/register/${a.data.token}`, form('Reenvio', 'Concejal'));
  assert.equal(reuse.data.error.code, 'LINK_INVALID');
  assert.match(reuse.data.error.message, /ya fue usado/);
  assert.equal((await anon.get(`/api/public/invite/${a.data.token}`)).data.valid, false);
  // Dos registros simultáneos con el mismo enlace: sólo uno pasa
  const race = await Promise.all([1, 2, 3].map((i) => anon.post(`/api/public/register/${b.data.token}`, form('Carrera', `Concejal ${['Uno', 'Dos', 'Tres'][i - 1]}`))));
  assert.deepEqual(race.map((r) => r.status).sort(), [201, 400, 400]);
  // Rechazar el registro no reabre el enlace
  const winner = (await admin.get('/api/people?q=carrera concejal')).data.rows[0];
  await admin.post(`/api/people/${winner.id}/status`, { status: 'rejected', reason: 'Prueba de rechazo' });
  assert.equal((await anon.post(`/api/public/register/${b.data.token}`, form('Tras', 'Rechazo'))).data.error.code, 'LINK_INVALID');
  // Un enlace usado no se puede reactivar ni ampliar
  assert.equal((await admin.post(`/api/links/${a.data.id}/enable`, {})).data.error.code, 'ONE_TIME');
  assert.equal((await admin.patch(`/api/links/${a.data.id}`, { max_uses: 50 })).data.error.code, 'ONE_TIME');
  // Líderes: uno por envío, de la cabeza indicada; un administrador de otra cabeza no puede generarlos
  const l = await gen({ reg_type_id: ids.aspirante.id, head_id: ids.head });
  assert.equal(l.status, 201, JSON.stringify(l.data));
  assert.equal((await anon.post(`/api/public/register/${l.data.token}`, form('Lider', 'Un Uso'))).data.is_leader, true);
  assert.equal((await anon.post(`/api/public/register/${l.data.token}`, form('Lider', 'Reenviado'))).status, 400);
  const other = await admin.post('/api/heads', { name: 'Otra Cabeza Enlaces' });
  await admin.post('/api/users', { username: 'adm.otra', password: 'AdmOtra1234!', role: 'head_admin', head_ids: [other.data.id] });
  const ha = await new Client(srv.base).login('adm.otra', 'AdmOtra1234!');
  assert.equal((await ha.post('/api/links/one-time', { reg_type_id: ids.aspirante.id, head_id: ids.head })).status, 403);
  assert.equal((await ha.post('/api/links/one-time', { reg_type_id: ids.concejal.id })).status, 403, 'cabezas: sólo el administrador general');
  // Resumen y anulación de los no usados
  const c = await gen({ reg_type_id: ids.concejal.id });
  let st = (await admin.get(`/api/links/one-time/stats?reg_type_id=${ids.concejal.id}`)).data;
  assert.deepEqual([st.sent, st.used, st.open], [3, 2, 1]);
  assert.equal((await admin.post('/api/links/one-time/revoke-open', { reg_type_id: ids.concejal.id })).data.revoked, 1);
  assert.equal((await anon.post(`/api/public/register/${c.data.token}`, form('Anulado', 'Concejal'))).data.error.code, 'LINK_INVALID');
  st = (await admin.get(`/api/links/one-time/stats?reg_type_id=${ids.concejal.id}`)).data;
  assert.equal(st.open, 0);
  assert.equal((await admin.get('/api/admin/integrity')).data.ok, true);
});

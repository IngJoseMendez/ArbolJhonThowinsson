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
  assert.match(link.data.token, /^REG-LIDER-ASPIRANTE-[A-Z0-9]{6}$/);
  const inv = (await anon.get(`/api/public/invite/${link.data.token}`)).data;
  assert.equal(inv.valid, true);
  assert.equal(inv.role, 'leader');
  assert.deepEqual(inv.type, { name: 'Líder aspirante', color: '#0ea5e9', role: 'leader' });
  assert.equal(inv.inviter, null);

  const r = await anon.post(`/api/public/register/${link.data.token}`, form('Ana María', 'Ruiz Díaz'));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.is_leader, true);
  assert.equal(r.data.leader_code, 'LID-ANA-MARIA-RUIZ');
  assert.equal(r.data.invite_token, 'LID-ANA-MARIA-RUIZ');
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
  assert.equal(r.data.invite_token, 'LID-ANA-MARIA-RUIZ');
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

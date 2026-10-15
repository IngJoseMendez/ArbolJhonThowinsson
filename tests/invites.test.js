// Invitaciones preparadas (el botón de WhatsApp es un enlace real: un toque), entregadas, anuladas y su listado
// por estado; número de registros por aprobar y ritmo de cada líder en la ficha de la cabeza.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, nextPhone, nextDoc } from './helpers.js';

let srv; let admin; let anon; let loc;
const ids = {};
const DEVICE = 'telefono-de-prueba-01';

before(async () => {
  srv = await startServer();
  admin = await new Client(srv.base).login('admin', 'Admin1234!');
  anon = new Client(srv.base);
  loc = { localidad_id: (await anon.get('/api/geo/areas?level=localidad')).data[0].id };
  const types = (await admin.get('/api/reg-types')).data;
  ids.types = Object.fromEntries(types.filter((t) => t.builtin).map((t) => [t.role, t]));
});
after(() => srv.close());

const form = (first, last, extra = {}) => ({
  first_names: first, last_names: last, document_id: nextDoc(), address: 'Calle 1 # 2-3', phone: nextPhone(),
  location: loc, supports: 'yes', consent: true, ...extra,
});
const prepare = (client, body) => client.post('/api/links/one-time', { prepare: true, device: DEVICE, ...body });
const stats = async (q) => (await admin.get(`/api/links/one-time/stats?${q}`)).data;

test('Preparar: la misma invitación por dispositivo hasta entregarla; otro dispositivo, otra', async () => {
  const head = ids.types.head.id;
  const a = await prepare(admin, { reg_type_id: head });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(a.data.prepared, true);
  assert.match(a.data.token, /^REG-[A-Z0-9]{12}$/);
  assert.equal((await prepare(admin, { reg_type_id: head })).data.id, a.data.id, 'se reutiliza');
  const other = await admin.post('/api/links/one-time', { prepare: true, device: 'otro-telefono-02', reg_type_id: head });
  assert.notEqual(other.data.id, a.data.id);
  assert.equal((await admin.post('/api/links/one-time', { prepare: true, device: 'x', reg_type_id: head })).status, 400, 'dispositivo no válido');

  // Mientras no se entrega no cuenta ni aparece en los listados.
  const s0 = await stats(`reg_type_id=${head}`);
  assert.equal(s0.sent, 0);
  assert.equal((await admin.get('/api/links?one_time=1')).data.rows.some((l) => l.id === a.data.id), false);
  ids.prepared = a.data;
});

test('Entregar: cuenta como enviada, vence en 7 días y guarda para quién; repetir no cambia nada', async () => {
  const sent = await admin.post(`/api/links/${ids.prepared.id}/sent`, { label: 'María Pérez' });
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  assert.equal(sent.data.already_sent, false);
  assert.equal(sent.data.stats.sent, 1);
  assert.equal(sent.data.stats.open, 1);
  assert.equal(sent.data.label, 'María Pérez');
  const days = (Date.parse(sent.data.expires_at) - Date.now()) / 864e5;
  assert.ok(days > 6.9 && days <= 7, `vence en ${days} días`);
  const again = await admin.post(`/api/links/${ids.prepared.id}/sent`, {});
  assert.equal(again.data.stats.sent, 1, 'idempotente');
  assert.equal(again.data.already_sent, true, 'avisa que ya se había entregado');
  // Después de entregarla, el dispositivo recibe una nueva.
  const next = await prepare(admin, { reg_type_id: ids.types.head.id });
  assert.notEqual(next.data.id, ids.prepared.id);
  ids.nextPrepared = next.data;
  // Aparece entre las sin usar, con su nombre.
  const open = (await admin.get('/api/links?one_time=1&state=open')).data.rows;
  const row = open.find((l) => l.id === ids.prepared.id);
  assert.equal(row.label, 'María Pérez');
  assert.equal(row.created_by_name, 'Administrador general');
});

test('Sólo quien la preparó la entrega; una anulada responde «ya no servía»', async () => {
  const h = await admin.post('/api/heads', { name: 'Estructura de invitaciones' });
  ids.head = h.data.id;
  const coord = await admin.post('/api/users', { username: 'coord.inv', password: 'Coord1234!', role: 'head_admin', head_ids: [ids.head], display_name: 'Coordinación' });
  assert.equal(coord.status, 201, JSON.stringify(coord.data));
  const c = await new Client(srv.base).login('coord.inv', 'Coord1234!');
  ids.coord = c;
  const first = await prepare(c, { reg_type_id: ids.types.leader.id, head_id: ids.head });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal((await admin.post(`/api/links/${first.data.id}/sent`, {})).status, 403, 'otro administrador');
  assert.equal((await c.post(`/api/links/${first.data.id}/sent`, {})).status, 200);
  const mine = await prepare(c, { reg_type_id: ids.types.leader.id, head_id: ids.head });
  assert.notEqual(mine.data.id, first.data.id);
  assert.equal((await c.post('/api/links/one-time', { prepare: true, device: DEVICE, reg_type_id: ids.types.head.id })).status, 403, 'cabezas: sólo el general');
  // Anular las sin usar: cuenta la enviada y también apaga la preparada (por si se entregó sin quedar marcada).
  const r = await c.post('/api/links/one-time/revoke-open', { reg_type_id: ids.types.leader.id, head_id: ids.head });
  assert.equal(r.data.revoked, 1);
  const closed = await c.post(`/api/links/${mine.data.id}/sent`, {});
  assert.equal(closed.status, 409);
  assert.equal(closed.data.error.code, 'LINK_CLOSED');
  const fresh = await prepare(c, { reg_type_id: ids.types.leader.id, head_id: ids.head });
  assert.notEqual(fresh.data.id, mine.data.id, 'se prepara una nueva');
  ids.coordPrepared = fresh.data;
});

test('Quien se registra con una invitación preparada (sin marcar entregada) la deja enviada y usada', async () => {
  const r = await anon.post(`/api/public/register/${ids.nextPrepared.token}`, form('Carmen', 'Rojas Díaz'));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.is_head, true);
  const s = await stats(`reg_type_id=${ids.types.head.id}`);
  assert.equal(s.sent, 2);
  assert.equal(s.used, 1);
  const used = (await admin.get('/api/links?one_time=1&state=used')).data.rows;
  const row = used.find((l) => l.id === ids.nextPrepared.id);
  assert.ok(row, 'aparece entre las usadas');
  assert.equal(row.used_by_name, 'Carmen Rojas Díaz');
  assert.ok(row.used_by_id);
  assert.equal((await admin.post(`/api/links/${ids.nextPrepared.id}/sent`, {})).status, 409);
});

test('Listado por estado: sin usar (las que vencen antes primero), usadas, anuladas, generales', async () => {
  const open = (await admin.get('/api/links?one_time=1&state=open')).data.rows;
  assert.ok(open.length >= 1);
  for (let i = 1; i < open.length; i++) assert.ok(open[i - 1].expires_at <= open[i].expires_at, 'ordenadas por vencimiento');
  assert.ok(open.every((l) => l.status === 'active' && !l.used_at));
  const voided = (await admin.get('/api/links?state=void')).data.rows;
  assert.ok(voided.some((l) => l.disabled_reason === 'Anulado: enlaces sin usar'));
  assert.ok(voided.every((l) => l.status === 'disabled' && !l.used_at));
  const leader = await admin.post('/api/people', { full_name: 'Líder Invitaciones', document_id: nextDoc(), address: 'Calle 9 # 9-9', phone: nextPhone(),
    location: loc, head_id: ids.head, is_leader: true });
  assert.equal(leader.status, 201, JSON.stringify(leader.data));
  const g = await admin.post('/api/links/general', { reg_type_id: ids.types.person.id, head_id: ids.head, owner_person_id: leader.data.id });
  const general = (await admin.get('/api/links?general=1')).data.rows;
  assert.ok(general.some((l) => l.id === g.data.id));
  assert.ok(general.every((l) => l.is_general));
  ids.leader = leader.data;
});

test('Por aprobar: sólo el número; ritmo de cada líder en la ficha de la cabeza', async () => {
  await admin.patch(`/api/heads/${ids.head}`, { requires_approval: true });
  const link = (await admin.get(`/api/people/${ids.leader.id}`)).data.links.find((l) => l.status === 'active');
  const r = await anon.post(`/api/public/register/${link.token}`, form('Pendiente', 'De Aprobar'));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const count = await admin.get('/api/pending?count=1');
  assert.deepEqual(count.data, { count: 1 });
  assert.equal((await admin.get('/api/pending')).data.length, 1, 'sin count, la lista completa');
  const detail = (await admin.get(`/api/heads/${ids.head}`)).data;
  const l = detail.leaders.find((x) => x.id === ids.leader.id);
  assert.equal(l.last7, 1, 'personas nuevas de su red en 7 días');
  assert.equal(typeof l.inviter_is_head, 'boolean');
  const dash = (await admin.get(`/api/stats/dashboard?head_id=${ids.head}`)).data;
  assert.ok(dash.recent.every((x) => x.head_id === ids.head), 'los registros recientes traen su estructura');
});

test('La siguiente invitación nunca es la recién entregada: aviso y preparación a la vez, o aviso perdido', async () => {
  const body = { reg_type_id: ids.types.head.id, prepare: true, device: 'telefono-carrera-03' };
  for (let i = 0; i < 12; i++) {
    const cur = (await admin.post('/api/links/one-time', body)).data;
    // El aviso de envío y la preparación de la siguiente llegan a la vez; la preparación nombra la entregada.
    const [sent, next] = await Promise.all([
      admin.post(`/api/links/${cur.id}/sent`, {}),
      admin.post('/api/links/one-time', { ...body, delivered: [cur.id] }),
    ]);
    assert.equal(sent.status, 200, JSON.stringify(sent.data));
    assert.notEqual(next.data.id, cur.id, `vuelta ${i}`);
  }
  // Aviso perdido (sin conexión): la preparación siguiente la deja enviada, una sola vez.
  const lost = (await admin.post('/api/links/one-time', body)).data;
  const next = (await admin.post('/api/links/one-time', { ...body, delivered: [lost.id, ids.coordPrepared.id] })).data;
  assert.notEqual(next.id, lost.id);
  assert.equal((await admin.post(`/api/links/${lost.id}/sent`, {})).data.already_sent, true);
  assert.equal((await admin.get(`/api/audit?action=link.sent&entity_id=${lost.id}`)).data.total, 1);
  // Recién entregada en otra pestaña del mismo dispositivo (su aviso aún no llega): no se ofrece, y no se marca aquí.
  const tabA = (await admin.post('/api/links/one-time', body)).data;
  const tabB = (await admin.post('/api/links/one-time', { ...body, exclude: [tabA.id] })).data;
  assert.notEqual(tabB.id, tabA.id);
  assert.equal((await admin.post(`/api/links/${tabA.id}/sent`, {})).data.already_sent, false);
  // La de otra persona no se toca: sigue preparada en su dispositivo.
  assert.equal((await prepare(ids.coord, { reg_type_id: ids.types.leader.id, head_id: ids.head })).data.id, ids.coordPrepared.id);
});

test('En las invitaciones usadas, quien se registró sólo se nombra si quien mira puede ver a esa persona', async () => {
  const r = await anon.post(`/api/public/register/${ids.coordPrepared.token}`, form('Rosa', 'Mendoza Ríos'));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const row = async () => (await ids.coord.get('/api/links?one_time=1&state=used')).data.rows.find((l) => l.id === ids.coordPrepared.id);
  assert.equal((await row()).used_by_name, 'Rosa Mendoza Ríos');
  // La persona pasa a otra estructura que esta coordinación no administra.
  const other = await admin.post('/api/heads', { name: 'Otra estructura' });
  const pid = (await row()).used_by_id;
  const moved = await admin.post(`/api/people/${pid}/move`, { head_id: other.data.id, reason: 'Cambio de estructura' });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  const after = await row();
  assert.ok(after, 'la invitación sigue en su listado');
  assert.equal(after.used_by_name, null);
  assert.equal(after.used_by_id, null);
  assert.equal((await admin.get('/api/links?one_time=1&state=used')).data.rows.find((l) => l.id === ids.coordPrepared.id).used_by_name, 'Rosa Mendoza Ríos');
});

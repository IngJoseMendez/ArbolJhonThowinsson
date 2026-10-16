// La cabeza es una persona: el líder raíz de su estructura. De ella cuelgan sus líderes (que invita desde su
// panel con enlaces de un solo uso) y sus personas. Públicamente se nombra por la persona, sin prefijos internos.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, nextPhone, nextDoc } from './helpers.js';

let srv; let admin; let anon;
let loc;
const ids = {};

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
const find = async (q) => (await admin.get(`/api/people?q=${encodeURIComponent(q)}`)).data.rows[0];
const pinOf = async (id) => (await admin.get(`/api/people/${id}`)).data.person.document_id.slice(-4);

test('Enlace de cabeza: quien se registra queda como cabeza de su estructura, no como un líder más', async () => {
  const link = await admin.post('/api/links/one-time', { reg_type_id: ids.types.head.id });
  assert.equal(link.status, 201, JSON.stringify(link.data));
  const r = await anon.post(`/api/public/register/${link.data.token}`, form('Juan Carlos', 'Restrepo'));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.is_head, true);
  assert.equal(r.data.is_leader, true);
  assert.equal(r.data.head, 'Cabeza Juan Carlos Restrepo', 'nombre interno de la estructura');
  assert.equal(r.data.head_display, 'Juan Carlos Restrepo', 'públicamente, por la persona');
  assert.ok(r.data.panel_token);
  ids.cabezaPanel = r.data.panel_token;
  const juan = await find('juan carlos restrepo');
  assert.equal(juan.is_head, true);
  ids.cabeza = juan;
  ids.head = juan.head_id;
  const heads = (await admin.get('/api/heads')).data;
  const h = heads.find((x) => x.id === ids.head);
  assert.equal(h.cabeza_id, juan.id);
  assert.equal(h.cabeza_name, 'Juan Carlos Restrepo');
  const detail = (await admin.get(`/api/heads/${ids.head}`)).data;
  assert.equal(detail.cabeza.id, juan.id);
  assert.equal(detail.leaders[0].is_head, true, 'la cabeza encabeza la lista de líderes');
  // Ficha: la persona es cabeza y su estructura la nombra
  const ficha = (await admin.get(`/api/people/${juan.id}`)).data;
  assert.equal(ficha.person.is_head, true);
  assert.equal(ficha.head.cabeza.id, juan.id);
});

test('Los líderes sin padrino cuelgan de la cabeza; el formulario público la nombra sin prefijos', async () => {
  const link = await admin.post('/api/links/one-time', { reg_type_id: ids.types.leader.id, head_id: ids.head });
  assert.equal(link.status, 201, JSON.stringify(link.data));
  const inv = (await anon.get(`/api/public/invite/${link.data.token}`)).data;
  assert.equal(inv.role, 'leader');
  assert.equal(inv.head.name, 'Cabeza Juan Carlos Restrepo');
  assert.equal(inv.head.display_name, 'Juan Carlos Restrepo');
  assert.deepEqual(inv.cabeza, { name: 'Juan Carlos Restrepo', first_name: 'Juan', photo: null });
  const r = await anon.post(`/api/public/register/${link.data.token}`, form('Lucía', 'Líder Uno'));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.cabeza, 'Juan Carlos Restrepo');
  const lucia = await find('lucia lider uno');
  assert.equal(lucia.inviter_id, ids.cabeza.id, 'cuelga de la cabeza');
  assert.equal(lucia.leader_id, ids.cabeza.id);
  ids.lucia = lucia;
  // Registro manual de un líder sin invitador: también cuelga de la cabeza
  const m = await admin.post('/api/people', { ...form('Mario', 'Líder Manual'), head_id: ids.head, is_leader: true });
  assert.equal(m.status, 201, JSON.stringify(m.data));
  assert.equal(m.data.inviter_id, ids.cabeza.id);
  // Personas invitadas por Lucía: el formulario dice quién invita y de qué equipo
  const p = (await anon.get(`/api/public/invite/${r.data.invite_token}`)).data;
  assert.equal(p.inviter.name, 'Lucía Líder Uno');
  assert.equal(p.inviter.first_name, 'Lucía');
  assert.equal(p.inviter.is_head, false);
  assert.equal(p.head.display_name, 'Juan Carlos Restrepo');
  assert.equal((await anon.post(`/api/public/register/${r.data.invite_token}`, form('Pedro', 'Votante Lucía'))).status, 201);
});

test('Panel de la cabeza: ve a sus líderes e invita líderes con enlaces de un solo uso', async () => {
  const pin = await pinOf(ids.cabeza.id);
  const open = (body = {}) => anon.post(`/api/public/panel/${ids.cabezaPanel}`, { pin, ...body });
  const d = (await open()).data;
  assert.equal(d.person.is_head, true);
  assert.equal(d.stats.total, 3, 'Lucía, Mario y Pedro');
  assert.equal(d.stats.leaders, 2);
  assert.deepEqual(d.leaders.map((l) => l.full_name).sort(), ['Lucía Líder Uno', 'Mario Líder Manual']);
  assert.equal(d.leaders.find((l) => l.full_name === 'Lucía Líder Uno').network, 1);
  assert.deepEqual(d.leader_invites, { sent: 0, used: 0, open: 0 });

  const invite = (body = {}) => anon.post(`/api/public/panel/${ids.cabezaPanel}/leader-invite`, { pin, ...body });
  const wrong = String((Number(pin) + 1) % 10000).padStart(4, '0');
  assert.equal((await invite({ pin: wrong })).data.error.code, 'PIN_INVALID');
  const a = await invite();
  assert.equal(a.status, 201, JSON.stringify(a.data));
  assert.match(a.data.token, /^REG-[A-Z2-9]{12}$/, 'sin «LÍDER» en el link: lo ve quien lo recibe');
  assert.deepEqual(a.data.stats, { sent: 1, used: 0, open: 1 });
  const inv = (await anon.get(`/api/public/invite/${a.data.token}`)).data;
  assert.equal(inv.role, 'leader');
  assert.equal(inv.inviter.name, 'Juan Carlos Restrepo');
  assert.equal(inv.inviter.is_head, true);
  const r = await anon.post(`/api/public/register/${a.data.token}`, form('Sofía', 'Invitada Cabeza'));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.is_leader, true);
  assert.ok(r.data.panel_token, 'el líder recibe su panel');
  assert.equal((await find('sofia invitada cabeza')).inviter_id, ids.cabeza.id);
  assert.equal((await anon.post(`/api/public/register/${a.data.token}`, form('Reenvio', 'Cabeza'))).data.error.code, 'LINK_INVALID');
  assert.deepEqual((await open()).data.leader_invites, { sent: 1, used: 1, open: 0 });

  // Un líder ve su panel, pero no invita líderes: de su enlace sólo salen personas
  const luciaPin = await pinOf(ids.lucia.id);
  const lp = await admin.post(`/api/people/${ids.lucia.id}/panel`);
  const ld = (await anon.post(`/api/public/panel/${lp.data.token}`, { pin: luciaPin })).data;
  assert.equal(ld.person.is_head, false);
  assert.equal(ld.leaders, null);
  assert.equal(ld.head.cabeza, 'Juan Carlos Restrepo');
  assert.equal((await anon.post(`/api/public/panel/${lp.data.token}/leader-invite`, { pin: luciaPin })).status, 403);
});

test('Panel de la cabeza: la invitación está lista antes del toque y cuenta al entregarla; nunca vuelve la misma', async () => {
  const pin = await pinOf(ids.cabeza.id);
  const stats = async () => (await anon.post(`/api/public/panel/${ids.cabezaPanel}`, { pin })).data.leader_invites;
  const prepare = (body = {}) => anon.post(`/api/public/panel/${ids.cabezaPanel}/leader-invite`, { pin, device: 'celular-de-juan', ...body });
  const sent = (invite) => anon.post(`/api/public/panel/${ids.cabezaPanel}/leader-invite/sent`, { pin, invite });
  const before = await stats();

  const a = await prepare();
  assert.equal(a.status, 201, JSON.stringify(a.data));
  assert.match(a.data.token, /^REG-[A-Z2-9]{12}$/);
  assert.deepEqual(a.data.stats, before, 'preparada: aún no cuenta como enviada');
  assert.equal((await prepare()).data.token, a.data.token, 'el mismo dispositivo la reutiliza mientras no la entregue');
  const other = await prepare({ device: 'computador-de-juan' });
  assert.notEqual(other.data.token, a.data.token, 'cada dispositivo tiene la suya');
  // Mientras está preparada no aparece en Enlaces; en la ficha de la cabeza sólo están sus enlaces propios
  const listed = (await admin.get('/api/links?one_time=1&pageSize=200')).data.rows.map((l) => l.token);
  assert.ok(!listed.includes(a.data.token));
  const ficha = (await admin.get(`/api/people/${ids.cabeza.id}`)).data;
  assert.ok(ficha.links.every((l) => !l.one_time), 'sus invitaciones a líderes no son su enlace');
  assert.ok(ficha.links.some((l) => l.status === 'active'), 'su enlace propio sigue ahí');

  const s = await sent(a.data.token);
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.equal(s.data.already_sent, false);
  assert.deepEqual(s.data.stats, { ...before, sent: before.sent + 1, open: before.open + 1 });
  assert.equal((await sent(a.data.token)).data.already_sent, true, 'marcarla dos veces no la cuenta dos veces');
  const b = await prepare();
  assert.notEqual(b.data.token, a.data.token, 'la entregada nunca vuelve como la siguiente');
  // Entregada sin que su aviso llegara (sin conexión): viaja con la siguiente preparación y queda enviada
  const c = await prepare({ delivered: [b.data.token] });
  assert.notEqual(c.data.token, b.data.token);
  assert.equal(c.data.stats.sent, before.sent + 2);
  // Quien se registra con una preparada queda como líder de la cabeza, y cuenta como enviada y usada
  const r = await anon.post(`/api/public/register/${c.data.token}`, form('Tomás', 'Preparado'));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.is_leader, true);
  assert.equal((await find('tomas preparado')).inviter_id, ids.cabeza.id);
  assert.deepEqual(await stats(), { sent: before.sent + 3, used: before.used + 1, open: before.open + 2 });
  assert.equal((await sent(c.data.token)).data.error.code, 'LINK_CLOSED', 'ya usada');
  // Anulada por la coordinación mientras estaba preparada: al entregarla se avisa que ya no sirve
  const d = await prepare();
  await admin.post('/api/links/one-time/revoke-open', { reg_type_id: ids.types.leader.id, head_id: ids.head });
  assert.equal((await sent(d.data.token)).data.error.code, 'LINK_CLOSED');
  assert.notEqual((await prepare()).data.token, d.data.token, 'la anulada no vuelve');
  assert.equal((await sent('REG-NOEXISTE2345')).status, 404);
  assert.equal((await sent(other.data.token)).status, 409, 'la del otro dispositivo también quedó anulada');
});

test('La cabeza no se mueve ni se degrada; se puede retirar y designar (adopta a los líderes raíz)', async () => {
  const c = ids.cabeza.id;
  assert.equal((await admin.post(`/api/people/${c}/move`, { inviter_id: ids.lucia.id, reason: 'Prueba de movimiento' })).data.error.code, 'HEAD_PERSON');
  assert.equal((await admin.post(`/api/people/${c}/demote`, { reason: 'Prueba de retiro' })).data.error.code, 'HEAD_PERSON');
  // Estructura creada por el administrador con dos líderes raíz: designar a uno la convierte en su cabeza
  const h = await admin.post('/api/heads', { name: 'Estructura Manual' });
  const a = await admin.post('/api/people', { ...form('Ana', 'Raiz Uno'), head_id: h.data.id, is_leader: true });
  const b = await admin.post('/api/people', { ...form('Beto', 'Raiz Dos'), head_id: h.data.id, is_leader: true });
  assert.equal(b.data.inviter_id, null, 'sin cabeza, el líder cuelga de la estructura');
  const kid = await admin.post('/api/people', { ...form('Carla', 'Bajo Beto'), head_id: h.data.id, inviter_id: b.data.id });
  assert.equal(kid.status, 201, JSON.stringify(kid.data));
  const ha = await admin.post('/api/users', { username: 'adm.cab', password: 'AdmCab1234!', role: 'head_admin', head_ids: [h.data.id] });
  assert.equal(ha.status, 201);
  const headAdmin = await new Client(srv.base).login('adm.cab', 'AdmCab1234!');
  assert.equal((await headAdmin.post(`/api/people/${a.data.id}/head-role`, { is_head: true })).status, 403, 'sólo el administrador general');
  assert.equal((await admin.post(`/api/people/${kid.data.id}/head-role`, { is_head: true })).data.error.code, 'NOT_ROOT');
  const d = await admin.post(`/api/people/${a.data.id}/head-role`, { is_head: true, reason: 'Es quien lidera la zona' });
  assert.equal(d.status, 200, JSON.stringify(d.data));
  assert.equal(d.data.adopted, 1);
  const beto = (await admin.get(`/api/people/${b.data.id}`)).data;
  assert.equal(beto.inviter.id, a.data.id, 'Beto cuelga ahora de la cabeza');
  assert.equal(beto.leader.id, a.data.id);
  assert.deepEqual(beto.chain.map((x) => x.full_name), ['Ana Raiz Uno', 'Beto Raiz Dos']);
  assert.equal((await admin.get(`/api/people/${kid.data.id}`)).data.chain.length, 3);
  assert.equal((await admin.get(`/api/people/${a.data.id}`)).data.stats.total, 2);
  assert.equal((await admin.post(`/api/people/${b.data.id}/head-role`, { is_head: true })).data.error.code, 'NOT_ROOT');
  // Registro manual con tipo «Cabeza» en una estructura que ya tiene cabeza: rechazado
  const dup = await admin.post('/api/people', { ...form('Otra', 'Cabeza'), head_id: h.data.id, reg_type_id: ids.types.head.id });
  assert.equal(dup.data.error.code, 'HEAD_TAKEN');
  // Retirar el papel de cabeza
  const off = await admin.post(`/api/people/${a.data.id}/head-role`, { is_head: false, reason: 'Cambio de cabeza' });
  assert.equal(off.status, 200, JSON.stringify(off.data));
  assert.equal(off.data.person.is_head, 0);
  const again = await admin.post('/api/people', { ...form('Nueva', 'Cabeza Manual'), head_id: h.data.id, reg_type_id: ids.types.head.id });
  assert.equal(again.status, 201, JSON.stringify(again.data));
  assert.equal(again.data.is_head, 1);
  assert.equal(again.data.inviter_id, null);
  const ana = (await admin.get(`/api/people/${a.data.id}`)).data;
  assert.equal(ana.inviter.id, again.data.id, 'la nueva cabeza adopta al líder raíz con su rama');
  assert.deepEqual((await admin.get(`/api/people/${kid.data.id}`)).data.chain.map((x) => x.full_name),
    ['Nueva Cabeza Manual', 'Ana Raiz Uno', 'Beto Raiz Dos', 'Carla Bajo Beto']);
  assert.equal((await admin.get(`/api/people/${again.data.id}`)).data.stats.total, 3);
  assert.equal((await admin.get('/api/admin/integrity')).data.ok, true);
});

test('Volver al panel con el enlace de registro ya usado: cédula + celular, enlace nuevo y bloqueo en la base de datos', async () => {
  const link = await admin.post('/api/links/one-time', { reg_type_id: ids.types.leader.id, head_id: ids.head });
  const data = form('Rocío', 'Recupera Panel');
  const r = await anon.post(`/api/public/register/${link.data.token}`, data);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const oldPanel = r.data.panel_token;
  const inv = (await anon.get(`/api/public/invite/${link.data.token}`)).data;
  assert.equal(inv.valid, false, 'el enlace de un solo uso sigue apagado');
  assert.equal(inv.recoverable, true);
  const recover = (body) => anon.post(`/api/public/recover/${link.data.token}`, body);
  const bad = await recover({ document_id: data.document_id, phone: '3159999999' });
  assert.equal(bad.status, 401);
  assert.equal(bad.data.error.code, 'RECOVER_MISMATCH');
  const ok = await recover({ document_id: data.document_id, phone: `+57 ${data.phone}` });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.ok(ok.data.panel_token && ok.data.panel_token !== oldPanel);
  const pin = data.document_id.slice(-4);
  assert.equal((await anon.post(`/api/public/panel/${oldPanel}`, { pin })).status, 404, 'el enlace anterior del panel deja de funcionar');
  assert.equal((await anon.post(`/api/public/panel/${ok.data.panel_token}`, { pin })).status, 200);
  // Cinco intentos fallidos bloquean la recuperación 30 minutos, aunque después se acierte
  for (let i = 0; i < 4; i++) assert.equal((await recover({ document_id: '1234567', phone: data.phone })).status, 401);
  assert.equal((await recover({ document_id: '1234567', phone: data.phone })).data.error.code, 'RECOVER_LOCKED');
  assert.equal((await recover({ document_id: data.document_id, phone: data.phone })).data.error.code, 'RECOVER_LOCKED');
  // Un enlace sin usar no sirve para entrar a ningún panel
  const fresh = await admin.post('/api/links/one-time', { reg_type_id: ids.types.leader.id, head_id: ids.head });
  assert.equal((await anon.get(`/api/public/invite/${fresh.data.token}`)).data.recoverable, false);
  assert.equal((await anon.post(`/api/public/recover/${fresh.data.token}`, { document_id: data.document_id, phone: data.phone })).status, 404);
  // El registro guarda la recuperación en su historial
  const rocio = await find('rocio recupera panel');
  const hist = (await admin.get(`/api/people/${rocio.id}`)).data.history;
  assert.ok(hist.some((h) => h.change_type === 'panel_recovered'));
});

test('La red de John: de él cuelgan todas las cabezas (y las estructuras aún sin cabeza), cada una con su árbol', async () => {
  // La estructura que nace de una invitación de cabeza queda a nombre de la cuenta de la coordinación que la envió.
  const me = (await admin.get('/api/me')).data;
  assert.equal((await admin.get('/api/heads')).data.find((x) => x.id === ids.head).created_by, me.user.id);

  const suelta = await admin.post('/api/heads', { name: 'Estructura Sin Cabeza' });
  const raiz = await admin.post('/api/people', { ...form('Raúl', 'Raiz Suelta'), head_id: suelta.data.id, is_leader: true });
  assert.equal(raiz.status, 201, JSON.stringify(raiz.data));
  const net = await admin.get('/api/tree/network');
  assert.equal(net.status, 200, JSON.stringify(net.data));
  const juan = net.data.nodes.find((n) => n.kind === 'person' && n.id === ids.cabeza.id);
  assert.ok(juan, 'la cabeza cuelga de John');
  assert.equal(juan.is_head, true);
  assert.equal(juan.head_id, ids.head);
  assert.equal(juan.path, undefined, 'sin rutas internas');
  const sinCabeza = net.data.nodes.find((n) => n.kind === 'head' && n.id === suelta.data.id);
  assert.ok(sinCabeza, 'sin cabeza, cuelga de John la estructura');
  assert.ok(net.data.nodes.indexOf(juan) < net.data.nodes.indexOf(sinCabeza), 'primero las cabezas');
  assert.equal(net.data.root.heads, net.data.nodes.length);
  assert.equal(net.data.root.people, (await admin.get('/api/people?pageSize=5')).data.total, 'John suma toda la red');
  // Cada cabeza conserva su árbol: sus ramas se piden a su estructura.
  const kids = (await admin.get(`/api/tree/${ids.head}/children?parent=${ids.cabeza.id}`)).data.nodes;
  assert.ok(kids.some((k) => k.id === ids.lucia.id));

  // Una coordinación de una sola cabeza ve a John con esa cabeza; sin sesión no hay red.
  assert.equal((await admin.post('/api/users', { username: 'adm.red', password: 'AdmRed1234!', role: 'head_admin', head_ids: [ids.head] })).status, 201);
  const coord = await new Client(srv.base).login('adm.red', 'AdmRed1234!');
  const mine = (await coord.get('/api/tree/network')).data;
  assert.deepEqual(mine.nodes.map((n) => n.id), [ids.cabeza.id]);
  assert.equal((await anon.get('/api/tree/network')).status, 401);
});

test('Manifiesto instalable del panel: abre directo el panel', async () => {
  const m = await anon.get(`/api/public/manifest?start=/panel/${ids.cabezaPanel}`);
  assert.equal(m.status, 200);
  assert.equal(m.data.start_url, `/panel/${ids.cabezaPanel}`);
  assert.equal(m.data.display, 'standalone');
  assert.equal((await anon.get('/api/public/manifest?start=https://otro.sitio/x')).data.start_url, '/');
});

test('Equipo directo de John: él es la cabeza de quienes invita directamente, con las mismas reglas que en cualquier equipo', async () => {
  const direct = (await admin.get('/api/heads')).data.find((h) => h.is_direct);
  assert.ok(direct, 'existe «Directo con John»');
  assert.equal(direct.description, 'El equipo directo de John Thowinsson: las personas que él invita directamente. Él es su cabeza.');
  const link = await admin.post('/api/links/general', { reg_type_id: ids.types.person.id, head_id: direct.id, owner_person_id: null });
  assert.equal(link.status, 200, JSON.stringify(link.data));
  assert.equal(link.data.owner_person_id, null);
  const inv = (await anon.get(`/api/public/invite/${link.data.token}`)).data;
  assert.equal(inv.valid, true);
  assert.equal(inv.direct, true, 'el formulario dice «Te invita John Thowinsson»');
  const r = await anon.post(`/api/public/register/${link.data.token}`, form('Carmen', 'Directa John'));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const carmen = await find('carmen directa');
  assert.equal(carmen.is_direct, true);
  assert.equal(carmen.inviter_id, null);
  assert.equal(carmen.head_id, direct.id);
  // Quien ella invite cuelga de ella.
  const hijo = await anon.post(`/api/public/register/${r.data.invite_token}`, form('Hijo', 'De Carmen'));
  assert.equal(hijo.status, 201, JSON.stringify(hijo.data));
  const h = await find('hijo de carmen');
  assert.equal(h.inviter_id, carmen.id);
  assert.equal(h.is_direct, false);
  // En la red, Carmen cuelga de John como una rama más, después de sus cabezas (Hijo cuelga de ella); no es una cabeza.
  const net = (await admin.get('/api/tree/network')).data;
  const firstDirect = net.nodes.findIndex((n) => n.is_direct);
  assert.ok(firstDirect > 0, 'primero las cabezas');
  assert.deepEqual(net.nodes.slice(firstDirect).map((n) => [n.kind, n.id]), [['person', carmen.id]]);
  assert.equal(net.root.heads, firstDirect);
  assert.equal(net.total, firstDirect + 1);
  assert.equal(net.page, net.nodes.length);
  // Mismas reglas que en cualquier equipo: Carmen puede ser persona de confianza (líder) y su gente queda a su cargo.
  const prom = await admin.post(`/api/people/${carmen.id}/promote`, { reason: 'Suma mucha gente' });
  assert.equal(prom.status, 200, JSON.stringify(prom.data));
  assert.equal(prom.data.person.is_leader, 1);
  assert.equal(prom.data.person.is_direct, 1, 'sigue directo con John');
  assert.equal((await admin.get(`/api/people/${h.id}`)).data.person.leader_id, carmen.id);
  // Desde el panel la nombran persona de confianza de John (no hay cabeza en medio).
  const panel = await admin.post(`/api/people/${carmen.id}/panel`);
  assert.equal(panel.status, 200, JSON.stringify(panel.data));
  const pd = (await anon.post(`/api/public/panel/${panel.data.token}`, { pin: await pinOf(carmen.id) })).data;
  assert.equal(pd.head.is_direct, true);
  assert.equal(pd.head.cabeza, null);
  // Al retirarle el liderazgo vuelve a ser una persona directa con John (no hace falta moverla).
  const dem = await admin.post(`/api/people/${carmen.id}/demote`, { reason: 'Lo pidió' });
  assert.equal(dem.status, 200, JSON.stringify(dem.data));
  assert.equal(dem.data.person.is_leader, 0);
  assert.equal(dem.data.person.is_direct, 1);
  assert.equal((await admin.get(`/api/people/${h.id}`)).data.person.leader_id, null);
  // John invita a una persona de confianza directo con él: el formulario dice que le invita John.
  const lead = await admin.post('/api/links/one-time', { reg_type_id: ids.types.leader.id, head_id: direct.id });
  assert.equal(lead.status, 201, JSON.stringify(lead.data));
  const linv = (await anon.get(`/api/public/invite/${lead.data.token}`)).data;
  assert.equal(linv.role, 'leader');
  assert.equal(linv.direct, true);
  const lr = await anon.post(`/api/public/register/${lead.data.token}`, form('Lucía', 'Confianza John'));
  assert.equal(lr.status, 201, JSON.stringify(lr.data));
  assert.equal(lr.data.is_leader, true);
  assert.equal(lr.data.direct, true);
  assert.ok(lr.data.panel_token, 'tiene su panel');
  const lucia = await find('lucia confianza');
  assert.equal(lucia.is_direct, true);
  assert.equal(lucia.inviter_id, null);
  // Su cabeza es John: no admite otra.
  assert.equal((await admin.post(`/api/people/${lucia.id}/head-role`, { is_head: true, reason: 'Prueba' })).data.error.code, 'DIRECT_NO_HEAD');
  assert.equal((await admin.post('/api/people', { ...form('Cabeza', 'Directa John'), head_id: direct.id, is_head: true })).data.error.code, 'DIRECT_NO_HEAD');
  // Un líder registrado a mano también puede quedar directo con John.
  const ml = await admin.post('/api/people', { ...form('Líder', 'Manual Directo'), head_id: direct.id, is_leader: true });
  assert.equal(ml.status, 201, JSON.stringify(ml.data));
  assert.equal(ml.data.is_direct, 1);
  assert.equal(ml.data.is_leader, 1);
  // Registro manual directo; se puede mover al equipo de una cabeza y volver directo con John.
  const m = await admin.post('/api/people', { ...form('Manual', 'Directo John'), head_id: direct.id });
  assert.equal(m.status, 201, JSON.stringify(m.data));
  assert.equal(m.data.is_direct, 1);
  const mv = await admin.post(`/api/people/${m.data.id}/move`, { inviter_id: ids.cabeza.id, reason: 'Pasa al equipo de Juan Carlos' });
  assert.equal(mv.status, 200, JSON.stringify(mv.data));
  assert.equal((await admin.get(`/api/people/${m.data.id}`)).data.person.is_direct, false);
  const back = await admin.post(`/api/people/${m.data.id}/move`, { head_id: direct.id, reason: 'Vuelve directo con John' });
  assert.equal(back.status, 200, JSON.stringify(back.data));
  const again = (await admin.get(`/api/people/${m.data.id}`)).data;
  assert.equal(again.person.is_direct, true);
  assert.equal(again.inviter, null);
  assert.equal(again.head.is_direct, true);
  // Sus personas directas llegan por páginas (líderes primero), sin repetir las cabezas; «include» trae a una que
  // quede fuera de la página, para localizarla en el árbol.
  const all = (await admin.get('/api/tree/network')).data;
  const heads = all.root.heads;
  const directs = all.nodes.slice(heads);
  assert.equal(directs.length, 4);
  assert.ok(directs.every((n) => n.is_direct && n.inviter_id === null));
  assert.deepEqual(directs.map((n) => n.is_leader), [true, true, false, false]);
  assert.equal(all.total, heads + 4);
  const p1 = (await admin.get('/api/tree/network?limit=1')).data;
  assert.deepEqual(p1.nodes.slice(heads).map((n) => n.id), [directs[0].id]);
  assert.equal(p1.page, heads + 1);
  const p2 = (await admin.get('/api/tree/network?offset=1&limit=1')).data;
  assert.deepEqual(p2.nodes.map((n) => n.id), [directs[1].id], 'las siguientes, sin repetir las cabezas');
  const inc = (await admin.get(`/api/tree/network?limit=1&include=${directs[3].id}`)).data;
  assert.equal(inc.page, heads + 1);
  assert.deepEqual(inc.nodes.slice(heads).map((n) => n.id), [directs[0].id, directs[3].id]);
  assert.equal((await admin.get('/api/admin/integrity')).data.ok, true, JSON.stringify((await admin.get('/api/admin/integrity')).data.issues));
});

test('«Solo las mías»: en la cuenta de John, sus personas directas (sin líderes ni cabezas) y su ritmo en el Inicio', async () => {
  // Directo con John quedaron Carmen y Manual (personas), y Lucía y Líder Manual (líderes); Hijo es de Carmen.
  const mine = (await admin.get('/api/people?mine=1&pageSize=50')).data;
  assert.deepEqual(mine.rows.map((r) => r.full_name).sort(), ['Carmen Directa John', 'Manual Directo John']);
  assert.equal(mine.total, 2);
  assert.ok(mine.rows.every((r) => r.is_direct && !r.is_leader && r.inviter_id === null));
  // Se combina con los demás filtros.
  assert.equal((await admin.get('/api/people?mine=1&q=carmen')).data.total, 1);
  assert.equal((await admin.get('/api/people?mine=1&type=leader')).data.total, 0);
  // En el Inicio, su acumulado diario va aparte: no se suma a los equipos.
  const series = (await admin.get('/api/stats/dashboard?days=30')).data.growth.series;
  assert.equal(series.at(-1).mine, 2);
  assert.equal(series.at(-8).mine, 0, 'las dos llegaron esta semana');
  assert.ok(series.every((s) => !('mine' in s.values)));
  // Un coordinador de cabeza no las ve: ni en Personas ni en su Inicio.
  const headAdmin = await new Client(srv.base).login('adm.cab', 'AdmCab1234!');
  assert.equal((await headAdmin.get('/api/people?mine=1')).data.total, 0);
  assert.equal((await headAdmin.get('/api/stats/dashboard?days=30')).data.growth.series.at(-1).mine, undefined);
});

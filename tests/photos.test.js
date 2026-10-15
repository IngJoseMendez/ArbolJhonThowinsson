// Fotos de las personas de confianza: se suben firmadas a Cloudinary (aquí, un servidor de prueba que comprueba la
// firma como Cloudinary), aparecen donde antes iban las iniciales y la coordinación puede cambiarlas o quitarlas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { startServer, Client, nextPhone, nextDoc } from './helpers.js';
import { cloudinarySignature } from '../server/services/photos.js';

const KEY = '123456789012345';
const SECRET = 'secreto-de-prueba';
const CLOUD = 'nube-prueba';
const JPEG = fs.readFileSync(new URL('../client/public/brand/john-face-160.jpg', import.meta.url));
const dataUrl = (buf, mime = 'image/jpeg') => `data:${mime};base64,${buf.toString('base64')}`;

const calls = [];
let failNext = false;
let stub; let srv; let admin; let anon; let loc;
const ids = {};

const sign = (params) => crypto.createHash('sha1')
  .update(Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&') + SECRET).digest('hex');

before(async () => {
  // Cloudinary de prueba: valida clave y firma, y responde como el de verdad.
  stub = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': req.headers['content-type'] } }).formData();
    const fields = {};
    let file = null;
    for (const [k, v] of form.entries()) { if (typeof v === 'string') fields[k] = v; else file = v; }
    const { api_key: key, signature, ...signed } = fields;
    const action = req.url.split('/').pop();
    const ok = key === KEY && signature === sign(signed) && req.url.startsWith(`/v1_1/${CLOUD}/image/`);
    calls.push({ action, fields, file: file && { size: file.size, type: file.type }, ok });
    res.setHeader('content-type', 'application/json');
    if (!ok || failNext) {
      failNext = false;
      res.statusCode = ok ? 500 : 401;
      res.end(JSON.stringify({ error: { message: ok ? 'Falla de prueba' : 'Invalid Signature' } }));
      return;
    }
    if (action === 'upload') {
      res.end(JSON.stringify({ public_id: fields.public_id, version: 1, secure_url: `https://res.cloudinary.com/${CLOUD}/image/upload/v1/${fields.public_id}.jpg` }));
    } else res.end(JSON.stringify({ result: 'ok' }));
  }).listen(0);
  await new Promise((r) => stub.once('listening', r));
  process.env.CLOUDINARY_URL = `cloudinary://${KEY}:${SECRET}@${CLOUD}`;
  process.env.CLOUDINARY_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  srv = await startServer();
  admin = await new Client(srv.base).login('admin', 'Admin1234!');
  anon = new Client(srv.base);
  loc = { localidad_id: (await anon.get('/api/geo/areas?level=localidad')).data[0].id };
  const types = (await admin.get('/api/reg-types')).data;
  ids.types = Object.fromEntries(types.filter((t) => t.builtin).map((t) => [t.role, t]));
});
after(async () => { await srv.close(); stub.close(); });

const form = (first, last) => ({
  first_names: first, last_names: last, document_id: nextDoc(), address: 'Calle 1 # 2-3', phone: nextPhone(),
  location: loc, supports: 'yes', consent: true,
});
const lastCall = (action) => [...calls].reverse().find((c) => c.action === action);
const waitFor = async (fn) => { for (let i = 0; i < 40 && !fn(); i++) await new Promise((r) => setTimeout(r, 25)); return fn(); };

test('La firma es la de Cloudinary (ejemplo de su documentación)', () => {
  assert.equal(cloudinarySignature({ eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop', public_id: 'sample_image', timestamp: 1315060510 }, 'abcd'),
    'bfd09f95f331f558cbd1320e67aa8d488770583e');
});

test('La persona de confianza pone su foto desde su panel y se ve en su panel, en la red y en sus invitaciones', async () => {
  const link = await admin.post('/api/links/one-time', { reg_type_id: ids.types.head.id });
  const reg = await anon.post(`/api/public/register/${link.data.token}`, form('Adriana', 'Fotos Prueba'));
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  assert.equal(reg.data.photos_enabled, true, 'la credencial ofrece poner la foto');
  assert.equal(reg.data.photo_url, null);
  ids.panel = reg.data.panel_token;
  const person = (await admin.get('/api/people?q=adriana fotos')).data.rows[0];
  ids.cabeza = person;
  ids.pin = (await admin.get(`/api/people/${person.id}`)).data.person.document_id.slice(-4);
  const photo = (image, pin = ids.pin) => anon.post(`/api/public/panel/${ids.panel}/photo`, { pin, image });

  const panel = (await anon.post(`/api/public/panel/${ids.panel}`, { pin: ids.pin })).data;
  assert.equal(panel.photos_enabled, true);
  assert.equal(panel.person.photo_url, null);

  const wrong = String((Number(ids.pin) + 1) % 10000).padStart(4, '0');
  assert.equal((await photo(dataUrl(JPEG), wrong)).status, 401, 'sin el PIN no se cambia la foto');
  assert.equal((await photo('hola')).data.error.code, 'PHOTO_INVALID');
  assert.equal((await photo(dataUrl(Buffer.from('<script>alert(1)</script>'.repeat(10)), 'image/png'))).data.error.code, 'PHOTO_INVALID',
    'se comprueba el contenido, no lo que dice ser');
  assert.equal(calls.length, 0, 'nada inválido llega a Cloudinary');

  const ok = await photo(dataUrl(JPEG));
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.match(ok.data.photo_url, new RegExp(`^https://res\\.cloudinary\\.com/${CLOUD}/image/upload/`));
  const up = lastCall('upload');
  assert.equal(up.ok, true, 'firma válida');
  assert.equal(up.fields.asset_folder, 'thowinsson/personas-de-confianza');
  assert.equal(up.fields.transformation, 'c_fill,g_face,w_640,h_640', 'cuadrado centrado en la cara');
  assert.equal(up.fields.eager, 'c_fill,w_96,h_96,q_auto,f_webp|c_fill,w_160,h_160,q_auto,f_webp', 'los tamaños que se muestran quedan listos al subirla');
  assert.match(up.fields.public_id, new RegExp(`^persona-${person.id}-[0-9a-f]{12}$`));
  assert.equal(up.file.size, JPEG.length);
  ids.photo = ok.data.photo_url;
  ids.publicId = up.fields.public_id;

  assert.equal((await anon.post(`/api/public/panel/${ids.panel}`, { pin: ids.pin })).data.person.photo_url, ids.photo);
  const net = (await admin.get('/api/tree/network')).data.nodes.find((n) => n.id === person.id);
  assert.equal(net.photo_url, ids.photo, 'la red muestra su foto');
  assert.equal((await admin.get('/api/heads')).data.find((h) => h.cabeza_id === person.id).cabeza_photo, ids.photo);
  assert.equal((await admin.get(`/api/people/${person.id}`)).data.person.photo_url, ids.photo);
  // Quien recibe su invitación ve su foto.
  const inv = await anon.post(`/api/public/panel/${ids.panel}/leader-invite`, { pin: ids.pin });
  const pub = (await anon.get(`/api/public/invite/${inv.data.token}`)).data;
  assert.equal(pub.inviter.photo, ids.photo);
  // La página del registro pide desde el HTML la foto de John y la de quien invita (llegan con la página).
  const page = (await anon.get(`/registro/${inv.data.token}`)).data;
  assert.match(page, /<link rel="preload" as="image" href="\/brand\/john-hero\.webp"/);
  assert.ok(page.includes(ids.photo.replace('/image/upload/', '/image/upload/c_fill,w_160,h_160,q_auto,f_webp/')), 'la foto de quien invita, en el tamaño que se muestra');
  const leader = await anon.post(`/api/public/register/${inv.data.token}`, form('Rosa', 'Lider Fotos'));
  assert.equal(leader.status, 201);
  assert.equal(leader.data.photos_enabled, true);
  ids.leaderInvite = leader.data.invite_token;
});

test('Cambiarla borra la anterior; la coordinación la cambia o la quita; sólo las personas de confianza tienen foto', async () => {
  const again = await anon.post(`/api/public/panel/${ids.panel}/photo`, { pin: ids.pin, image: dataUrl(JPEG) });
  assert.equal(again.status, 200);
  assert.notEqual(again.data.photo_url, ids.photo);
  assert.ok(await waitFor(() => calls.some((c) => c.action === 'destroy' && c.fields.public_id === ids.publicId && c.ok)), 'la anterior se borra de Cloudinary');
  assert.equal(lastCall('destroy').fields.invalidate, 'true');

  // La coordinación, desde la ficha: la cambia (también con fotos de más de 50 kB) y la quita.
  const big = Buffer.concat([JPEG, Buffer.alloc(300 * 1024)]);
  const set = await admin.post(`/api/people/${ids.cabeza.id}/photo`, { image: dataUrl(big) });
  assert.equal(set.status, 200, JSON.stringify(set.data));
  assert.equal((await admin.post('/api/people', { notes: 'x'.repeat(60 * 1024) })).status, 413, 'las demás rutas siguen con su límite');
  const gone = await admin.post(`/api/people/${ids.cabeza.id}/photo/remove`);
  assert.equal(gone.status, 200);
  assert.equal(gone.data.photo_url, null);
  const ficha = (await admin.get(`/api/people/${ids.cabeza.id}`)).data;
  assert.equal(ficha.person.photo_url, null);
  assert.deepEqual(ficha.history.filter((h) => h.change_type.startsWith('photo')).map((h) => h.change_type), ['photo_removed', 'photo_set', 'photo_set', 'photo_set']);

  // Una persona sin papel (registrada con el link de una persona de confianza) no tiene foto.
  const p = await anon.post(`/api/public/register/${ids.leaderInvite}`, form('Pedro', 'Sin Foto'));
  assert.equal(p.status, 201);
  const pedro = (await admin.get('/api/people?q=pedro sin foto')).data.rows[0];
  assert.equal((await admin.post(`/api/people/${pedro.id}/photo`, { image: dataUrl(JPEG) })).data.error.code, 'NOT_TRUSTED');
  // Si Cloudinary falla, no cambia nada.
  failNext = true;
  const fail = await anon.post(`/api/public/panel/${ids.panel}/photo`, { pin: ids.pin, image: dataUrl(JPEG) });
  assert.equal(fail.status, 502);
  assert.equal(fail.data.error.code, 'PHOTO_SERVICE');
  assert.equal((await admin.get(`/api/people/${ids.cabeza.id}`)).data.person.photo_url, null);
});

test('Sin Cloudinary configurado no se ofrece poner fotos', async () => {
  const saved = process.env.CLOUDINARY_URL;
  delete process.env.CLOUDINARY_URL;
  try {
    assert.equal((await anon.post(`/api/public/panel/${ids.panel}`, { pin: ids.pin })).data.photos_enabled, false);
    assert.equal((await admin.get('/api/me')).data.features.photos, false);
    const r = await anon.post(`/api/public/panel/${ids.panel}/photo`, { pin: ids.pin, image: dataUrl(JPEG) });
    assert.equal(r.status, 503);
    assert.equal(r.data.error.code, 'PHOTOS_OFF');
  } finally {
    process.env.CLOUDINARY_URL = saved;
  }
  assert.equal((await admin.get('/api/me')).data.features.photos, true);
});

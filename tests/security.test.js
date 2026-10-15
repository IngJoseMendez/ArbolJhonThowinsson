// Seguridad: cabeceras (iguales en Express y en Vercel), compresión, límites de intentos guardados en la base de
// datos y verificación en dos pasos (códigos de una app de autenticación y de recuperación).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, Client } from './helpers.js';
import { CSP, SECURITY_HEADERS, HSTS } from '../server/security.js';
import {
  base32Encode, base32Decode, hotp, verifyTotp, currentStep, otpauthUri, sealSecret, openSecret, newRecoveryCodes, recoveryHash,
} from '../server/totp.js';

let srv; let admin;
before(async () => {
  srv = await startServer();
  admin = await new Client(srv.base).login('admin', 'Admin1234!');
});
after(() => srv.close());

/** Código que la app mostraría `ahead` pasos después del actual (los ya usados no valen dos veces). */
const codeFor = (secret, ahead = 0) => hotp(base32Decode(secret), currentStep() + ahead);
/** Un código de 6 dígitos que seguro no es válido ahora (ni en los pasos vecinos). */
function wrongCode(secret, seed = 0) {
  const valid = new Set([-1, 0, 1, 2].map((d) => codeFor(secret, d)));
  for (let n = 100000 + seed * 7919; ; n++) if (!valid.has(String(n))) return String(n);
}

test('Cabeceras de seguridad: política de contenido, marcos, ventanas y tipos', async () => {
  const r = await fetch(`${srv.base}/api/health`);
  assert.equal(r.headers.get('content-security-policy'), CSP);
  assert.match(CSP, /script-src 'self'/);
  assert.match(CSP, /frame-ancestors 'none'/);
  assert.doesNotMatch(CSP, /unsafe-inline|unsafe-eval/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
  assert.equal(r.headers.get('strict-transport-security'), null, 'HSTS sólo por HTTPS');
});

test('La sesión se consulta sin errores: null sin sesión, los datos con sesión; /me sigue exigiendo sesión', async () => {
  const anon = new Client(srv.base);
  const none = await anon.get('/api/session');
  assert.equal(none.status, 200);
  assert.equal(none.data, null);
  assert.equal((await anon.get('/api/me')).status, 401);
  const me = await admin.get('/api/session');
  assert.equal(me.data.user.username, 'admin');
  assert.equal(me.data.twofa.enabled, false);
});

test('Vercel envía exactamente las mismas cabeceras de seguridad que el servidor', () => {
  const expected = [...Object.entries(SECURITY_HEADERS), ['Strict-Transport-Security', HSTS]];
  for (const file of ['vercel.json', 'client/vercel.json']) {
    const conf = JSON.parse(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
    const all = conf.headers.find((h) => h.source === '/(.*)');
    assert.ok(all, `${file}: falta el bloque de cabeceras para todas las rutas`);
    assert.deepEqual(all.headers.map((h) => [h.key, h.value]), expected, file);
  }
  assert.match(fs.readFileSync(new URL('../client/public/robots.txt', import.meta.url), 'utf8'), /Disallow: \/api\//);
});

test('Respuestas comprimidas', async () => {
  const loc = (await (await fetch(`${srv.base}/api/geo/areas?level=localidad`)).json())[0];
  const r = await fetch(`${srv.base}/api/geo/areas?level=barrio&localidad_id=${loc.id}&todos=1`, { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-encoding'), 'gzip');
  assert.ok((await r.json()).length > 0);
});

test('Límite de intentos guardado en la base de datos, separado por tipo de límite', async () => {
  process.env.DISABLE_RATE_LIMIT = '';
  try {
    const anon = new Client(srv.base);
    for (let i = 0; i < 20; i++) {
      const r = await anon.post('/api/auth/login', { username: `nadie${i}`, password: 'x' });
      assert.equal(r.status, 401);
    }
    const blocked = await fetch(`${srv.base}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'Admin1234!' }),
    });
    assert.equal(blocked.status, 429, 'el intento 21 queda bloqueado aunque la contraseña sea correcta');
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    // Otro límite (consulta de enlaces) lleva su propia cuenta.
    assert.notEqual((await anon.get('/api/public/invite/NO-EXISTE')).status, 429);
  } finally {
    process.env.DISABLE_RATE_LIMIT = '1';
  }
});

test('TOTP: vectores del RFC 6238, base32 y enlace para la app', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(base32Decode('gezd gnbv-gy3t qojq gezd gnbv gy3t qojq'), Buffer.from('12345678901234567890'));
  const key = Buffer.from('12345678901234567890');
  for (const [t, code] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']]) {
    assert.equal(hotp(key, Math.floor(t / 30)), code, `T=${t}`);
    assert.equal(verifyTotp(secret, code, { now: t * 1000 }), Math.floor(t / 30));
  }
  // ±1 paso de tolerancia, nunca un paso ya usado.
  assert.equal(verifyTotp(secret, '287082', { now: 89 * 1000 }), 1);
  assert.equal(verifyTotp(secret, '287082', { now: 119 * 1000 }), null);
  assert.equal(verifyTotp(secret, '287082', { now: 59 * 1000, lastStep: 1 }), null);
  assert.equal(verifyTotp(secret, '28708', { now: 59 * 1000 }), null);
  assert.equal(otpauthUri('ABC', 'admin'), 'otpauth://totp/Thowinsson:admin?secret=ABC&issuer=Thowinsson&algorithm=SHA1&digits=6&period=30');
  const codes = newRecoveryCodes();
  assert.equal(codes.length, 8);
  assert.equal(new Set(codes).size, 8);
  for (const c of codes) assert.match(c, /^([A-Z2-9]{4}-){3}[A-Z2-9]{4}$/);
  // Huella por cuenta: el mismo código no da la misma huella en dos cuentas, y no depende de TOTP_KEY.
  assert.notEqual(recoveryHash(1, codes[0]), recoveryHash(2, codes[0]));
  assert.equal(recoveryHash(1, codes[0].toLowerCase().replaceAll('-', ' ')), recoveryHash(1, codes[0]));
  const prev = process.env.TOTP_KEY;
  const before = recoveryHash(1, codes[0]);
  process.env.TOTP_KEY = 'otra-clave-cualquiera';
  try { assert.equal(recoveryHash(1, codes[0]), before, 'si la clave cambia, los códigos siguen sirviendo'); }
  finally { if (prev === undefined) delete process.env.TOTP_KEY; else process.env.TOTP_KEY = prev; }
});

test('La clave de la app se guarda cifrada si el servidor tiene TOTP_KEY', () => {
  const prev = process.env.TOTP_KEY;
  try {
    delete process.env.TOTP_KEY;
    assert.equal(openSecret(sealSecret('JBSWY3DPEHPK3PXP')), 'JBSWY3DPEHPK3PXP');
    process.env.TOTP_KEY = 'clave-de-prueba';
    const sealed = sealSecret('JBSWY3DPEHPK3PXP');
    assert.ok(sealed.startsWith('g:') && !sealed.includes('JBSWY3DPEHPK3PXP'));
    assert.equal(openSecret(sealed), 'JBSWY3DPEHPK3PXP');
    process.env.TOTP_KEY = 'otra-clave';
    assert.equal(openSecret(sealed), null, 'con otra clave no se puede leer');
  } finally {
    if (prev === undefined) delete process.env.TOTP_KEY; else process.env.TOTP_KEY = prev;
  }
});

test('Verificación en dos pasos: activar, entrar con código o de recuperación, sin repetir códigos, y desactivar', async () => {
  const me = new Client(srv.base);
  await me.login('admin', 'Admin1234!');
  assert.equal((await me.get('/api/me')).data.twofa.enabled, false);

  assert.equal((await me.post('/api/me/2fa/setup', { password: 'mala' })).data.error.code, 'BAD_PASSWORD');
  const setup = await me.post('/api/me/2fa/setup', { password: 'Admin1234!' });
  assert.equal(setup.status, 200, JSON.stringify(setup.data));
  assert.match(setup.data.secret, /^[A-Z2-7]{32}$/);
  assert.ok(setup.data.uri.startsWith('otpauth://totp/Thowinsson:admin?secret='));
  const { secret } = setup.data;

  assert.equal((await me.post('/api/me/2fa/enable', { code: wrongCode(secret) })).data.error.code, 'BAD_CODE');
  const enabled = await me.post('/api/me/2fa/enable', { code: codeFor(secret) });
  assert.equal(enabled.status, 200, JSON.stringify(enabled.data));
  const recovery = enabled.data.recovery_codes;
  assert.equal(recovery.length, 8);
  const status = (await me.get('/api/me')).data.twofa;
  assert.equal(status.enabled, true);
  assert.equal(status.recovery_left, 8);
  assert.ok(status.since);
  assert.equal((await admin.get('/api/me')).status, 401, 'las otras sesiones se cierran al activarla');

  // Entrar: la contraseña ya no abre la sesión sola.
  const anon = new Client(srv.base);
  const step1 = await anon.post('/api/auth/login', { username: 'admin', password: 'Admin1234!' });
  assert.deepEqual(Object.keys(step1.data).sort(), ['challenge', 'ok', 'twofa']);
  assert.equal(step1.data.twofa, true);
  assert.equal(anon.cookie, '', 'sin sesión antes del código');
  assert.equal((await anon.get('/api/me')).status, 401);
  const bad = await anon.post('/api/auth/login/2fa', { challenge: step1.data.challenge, code: wrongCode(secret, 1) });
  assert.equal(bad.data.error.code, 'BAD_CODE');
  const code = codeFor(secret, 1);
  const ok = await anon.post('/api/auth/login/2fa', { challenge: step1.data.challenge, code });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal((await anon.get('/api/me')).status, 200);
  assert.equal((await anon.post('/api/auth/login/2fa', { challenge: step1.data.challenge, code })).data.error.code, 'CHALLENGE_EXPIRED', 'el comprobante es de un solo uso');

  // El mismo código no vale otra vez (aunque siga en su ventana de 30 s).
  const again = new Client(srv.base);
  const s2 = await again.post('/api/auth/login', { username: 'admin', password: 'Admin1234!' });
  assert.equal((await again.post('/api/auth/login/2fa', { challenge: s2.data.challenge, code })).data.error.code, 'BAD_CODE');

  // Código de recuperación: sirve una vez.
  const viaRecovery = await again.post('/api/auth/login/2fa', { challenge: s2.data.challenge, code: recovery[0].toLowerCase().replaceAll('-', ' ') });
  assert.equal(viaRecovery.status, 200, JSON.stringify(viaRecovery.data));
  assert.equal(viaRecovery.data.recovery_left, 7);
  const s3 = await new Client(srv.base).post('/api/auth/login', { username: 'admin', password: 'Admin1234!' });
  assert.equal((await new Client(srv.base).post('/api/auth/login/2fa', { challenge: s3.data.challenge, code: recovery[0] })).data.error.code, 'BAD_CODE');

  // Renovar códigos y desactivar exigen un código vigente.
  assert.equal((await anon.post('/api/me/2fa/recovery-codes', { code: recovery[0] })).data.error.code, 'BAD_CODE');
  const renewed = await anon.post('/api/me/2fa/recovery-codes', { code: recovery[1] });
  assert.equal(renewed.status, 200, JSON.stringify(renewed.data));
  assert.notDeepEqual(renewed.data.recovery_codes, recovery);
  assert.equal((await anon.post('/api/me/2fa/disable', { password: 'Admin1234!', code: recovery[2] })).data.error.code, 'BAD_CODE', 'los anteriores ya no sirven');
  assert.equal((await anon.post('/api/me/2fa/disable', { password: 'mala', code: renewed.data.recovery_codes[0] })).data.error.code, 'BAD_PASSWORD');
  const off = await anon.post('/api/me/2fa/disable', { password: 'Admin1234!', code: renewed.data.recovery_codes[0] });
  assert.equal(off.status, 200, JSON.stringify(off.data));
  const plain = await new Client(srv.base).post('/api/auth/login', { username: 'admin', password: 'Admin1234!' });
  assert.deepEqual(plain.data, { ok: true });
  admin = await new Client(srv.base).login('admin', 'Admin1234!');

  const actions = (await admin.get('/api/audit?pageSize=200')).data.rows.map((r) => r.action);
  for (const a of ['user.2fa_enabled', 'auth.2fa_failed', 'user.2fa_recovery_renewed', 'user.2fa_disabled']) assert.ok(actions.includes(a), a);
});

test('Tope de códigos errados por cuenta y desbloqueo por un administrador (celular perdido)', async () => {
  const heads = (await admin.get('/api/heads')).data;
  const headId = heads[0]?.id ?? (await admin.post('/api/heads', { name: 'Estructura de prueba 2FA' })).data.id;
  const created = await admin.post('/api/users', { username: 'coordinadora', password: 'Coord1234!', role: 'head_admin', head_ids: [headId], display_name: 'Coordinadora' });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const coord = await new Client(srv.base).login('coordinadora', 'Coord1234!');
  const { secret } = (await coord.post('/api/me/2fa/setup', { password: 'Coord1234!' })).data;
  assert.equal((await coord.post('/api/me/2fa/enable', { code: codeFor(secret) })).status, 200);
  assert.equal((await admin.get('/api/users')).data.find((u) => u.username === 'coordinadora').twofa, true);

  // Cinco códigos errados anulan el comprobante; diez en total bloquean la cuenta 15 minutos, aunque luego acierte.
  const attacker = new Client(srv.base);
  for (let round = 0; round < 2; round++) {
    const c = (await attacker.post('/api/auth/login', { username: 'coordinadora', password: 'Coord1234!' })).data.challenge;
    for (let i = 0; i < 5; i++) {
      const r = await attacker.post('/api/auth/login/2fa', { challenge: c, code: wrongCode(secret, round * 10 + i) });
      assert.equal(r.data.error.code, i < 4 ? 'BAD_CODE' : 'CHALLENGE_EXPIRED');
    }
  }
  const c = (await attacker.post('/api/auth/login', { username: 'coordinadora', password: 'Coord1234!' })).data.challenge;
  const locked = await attacker.post('/api/auth/login/2fa', { challenge: c, code: codeFor(secret, 1) });
  assert.equal(locked.status, 429);

  // Un administrador general le quita la verificación (no la propia): se cierran sus sesiones.
  const id = (await admin.get('/api/users')).data.find((u) => u.username === 'coordinadora').id;
  const self = (await admin.get('/api/me')).data.user.id;
  assert.equal((await admin.patch(`/api/users/${self}`, { reset_2fa: true })).status, 400);
  assert.equal((await admin.patch(`/api/users/${id}`, { reset_2fa: true })).status, 200);
  assert.equal((await coord.get('/api/me')).status, 401);
  assert.equal((await admin.get('/api/users')).data.find((u) => u.username === 'coordinadora').twofa, false);
  assert.deepEqual((await new Client(srv.base).post('/api/auth/login', { username: 'coordinadora', password: 'Coord1234!' })).data, { ok: true });
});

test('Los topes de códigos errados se cumplen también con peticiones simultáneas', async () => {
  const heads = (await admin.get('/api/heads')).data;
  const headId = heads[0]?.id ?? (await admin.post('/api/heads', { name: 'Estructura de prueba 2FA simultáneo' })).data.id;
  const created = await admin.post('/api/users', { username: 'simultanea', password: 'Simul1234!', role: 'head_admin', head_ids: [headId], display_name: 'Simultánea' });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = (await admin.get('/api/users')).data.find((u) => u.username === 'simultanea').id;
  const me = await new Client(srv.base).login('simultanea', 'Simul1234!');
  const { secret } = (await me.post('/api/me/2fa/setup', { password: 'Simul1234!' })).data;
  assert.equal((await me.post('/api/me/2fa/enable', { code: codeFor(secret) })).status, 200);

  const attacker = new Client(srv.base);
  const challenge = async () => (await attacker.post('/api/auth/login', { username: 'simultanea', password: 'Simul1234!' })).data.challenge;
  // Veinte códigos a la vez con el mismo comprobante: sólo cinco llegan a comprobarse.
  const c1 = await challenge();
  const burst = await Promise.all(Array.from({ length: 20 }, (_, i) => attacker.post('/api/auth/login/2fa', { challenge: c1, code: wrongCode(secret, i) })));
  const codes = burst.map((r) => r.data.error.code);
  assert.equal(codes.filter((c) => c === 'BAD_CODE').length, 4, codes.join());
  assert.ok(codes.every((c) => c === 'BAD_CODE' || c === 'CHALLENGE_EXPIRED'), codes.join());
  // Con tres comprobantes a la vez, la cuenta tampoco pasa de diez códigos errados en total.
  const more = await Promise.all([challenge(), challenge(), challenge()]);
  const burst2 = await Promise.all(more.flatMap((c, k) => Array.from({ length: 5 }, (_, i) =>
    attacker.post('/api/auth/login/2fa', { challenge: c, code: wrongCode(secret, 20 + k * 5 + i) }))));
  assert.equal(burst2.filter((r) => r.status !== 429).length, 5, burst2.map((r) => r.status).join());
  assert.equal((await admin.get(`/api/audit?action=auth.2fa_failed&entity_id=${id}`)).data.total, 10);
  // Bloqueada: ni el código correcto entra hasta que pasen los 15 minutos.
  assert.equal((await attacker.post('/api/auth/login/2fa', { challenge: await challenge(), code: codeFor(secret, 1) })).status, 429);
});

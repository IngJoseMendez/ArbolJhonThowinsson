import pg from 'pg';

process.env.DISABLE_RATE_LIMIT = '1';
process.env.ADMIN_PASSWORD = 'Admin1234!';

// Servidor PostgreSQL de pruebas: se crea y destruye una base de datos por archivo de pruebas.
const TEST_SERVER = (process.env.TEST_DATABASE_URL || 'postgres://arbol:arbolpw@localhost:5432/postgres').replace(/\/[^/]*$/, '');

export async function startServer() {
  const name = `arbol_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = new pg.Client({ connectionString: `${TEST_SERVER}/postgres` });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const drop = async () => { await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await admin.end(); };
  let closeDb;
  let createApp;
  try {
    const db = await import('../server/db.js');
    closeDb = db.closeDb;
    await db.openDb(`${TEST_SERVER}/${name}`);
    const { ensureBootstrapAdmin } = await import('../server/bootstrap.js');
    await ensureBootstrapAdmin();
    ({ createApp } = await import('../server/app.js'));
  } catch (e) {
    await closeDb?.().catch(() => {});
    await drop();
    throw e;
  }
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    async close() {
      await new Promise((r) => server.close(r));
      await closeDb();
      await drop();
    },
  };
}

export class Client {
  constructor(base) { this.base = base; this.cookie = ''; }
  async req(method, url, body) {
    const res = await fetch(this.base + url, {
      method,
      headers: { 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }
  get(u) { return this.req('GET', u); }
  post(u, b = {}) { return this.req('POST', u, b); }
  patch(u, b = {}) { return this.req('PATCH', u, b); }
  async login(username, password) {
    const r = await this.post('/api/auth/login', { username, password });
    if (r.status !== 200) throw new Error(`login ${username}: ${JSON.stringify(r.data)}`);
    return this;
  }
}

let phone = 3100000000;
export const nextPhone = () => String(phone++);

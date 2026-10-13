import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DISABLE_RATE_LIMIT = '1';
process.env.ADMIN_PASSWORD = 'Admin1234!';

export async function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arbol-test-'));
  const { openDb, closeDb } = await import('../server/db.js');
  closeDb();
  openDb(path.join(dir, 'test.db'));
  const { ensureBootstrapAdmin } = await import('../server/bootstrap.js');
  ensureBootstrapAdmin();
  const { createApp } = await import('../server/app.js');
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    async close() { server.close(); closeDb(); fs.rmSync(dir, { recursive: true, force: true }); },
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

// Almacén del árbol con carga progresiva de ramas (lazy loading + paginación).
// Lo comparten la vista gráfica y la vista de lista jerárquica.
import { api, qs } from '../api.js';

export const PAGE = 50;
export const NODE_W = 236;
export const NODE_H = 66;
export const HEAD_H = 76;
const GAP_X = 64;
const GAP_Y = 14;
const MORE_H = 36;

export class TreeStore {
  constructor(head, focusPerson = null) {
    this.head = head;
    this.focus = focusPerson; // nodo persona que actúa como raíz (rama concreta)
    this.nodes = new Map();
    this.listeners = new Set();
    this.version = 0;
    const rootKey = focusPerson ? `p${focusPerson.id}` : 'head';
    this.rootKey = rootKey;
    this.nodes.set(rootKey, focusPerson
      ? { key: rootKey, kind: 'person', data: focusPerson, children: null, total: focusPerson.child_count, expanded: false, loading: false }
      : { key: 'head', kind: 'head', data: head, children: null, total: null, expanded: false, loading: false });
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.version++; for (const l of this.listeners) l(this.version); }
  get(key) { return this.nodes.get(key); }

  personKey(id) { return `p${id}`; }

  async loadChildren(key, { append = false, include = null } = {}) {
    const n = this.nodes.get(key);
    if (!n || n.loading) return;
    n.loading = true; this.emit();
    try {
      const prev = n.children || [];
      const isExtra = (k) => !!this.nodes.get(k)?.extra;
      const regular = append ? prev.filter((k) => !isExtra(k)) : [];
      const prevExtras = prev.filter(isExtra);
      const offset = regular.length;
      const parent = n.kind === 'head' ? undefined : n.data.id;
      const r = await api.get(`/tree/${this.head.id}/children${qs({ parent, offset, limit: PAGE, include })}`);
      const pageCount = Math.min(PAGE, Math.max(0, r.total - offset));
      const seen = new Set(regular);
      const extras = [];
      r.nodes.forEach((d, i) => {
        const k = this.personKey(d.id);
        const extra = i >= pageCount; // nodo incluido fuera de la página (para localizar a alguien)
        const existing = this.nodes.get(k);
        if (existing) { existing.data = d; existing.total = d.child_count; existing.extra = extra; }
        else this.nodes.set(k, { key: k, kind: 'person', data: d, children: null, total: d.child_count, expanded: false, loading: false, parent: key, extra });
        if (seen.has(k)) return;
        seen.add(k);
        (extra ? extras : regular).push(k);
      });
      for (const k of prevExtras) if (!seen.has(k)) { seen.add(k); extras.push(k); }
      n.children = [...regular, ...extras];
      n.total = r.total;
      n.expanded = true;
    } finally {
      n.loading = false;
      this.emit();
    }
  }

  async expand(key) {
    const n = this.nodes.get(key);
    if (!n) return;
    if (!n.children) await this.loadChildren(key);
    else { n.expanded = true; this.emit(); }
  }

  collapse(key) {
    const n = this.nodes.get(key);
    if (n) { n.expanded = false; this.emit(); }
  }

  async toggle(key) {
    const n = this.nodes.get(key);
    if (!n) return;
    if (n.expanded) this.collapse(key);
    else await this.expand(key);
  }

  hasChildren(n) {
    return n.kind === 'head' ? true : (n.data.child_count ?? n.total ?? 0) > 0;
  }

  /** Expande hasta `levels` niveles bajo un nodo, con un presupuesto de peticiones. */
  async expandLevels(key, levels = 2, budget = 40) {
    let frontier = [key];
    for (let l = 0; l < levels && frontier.length && budget > 0; l++) {
      const next = [];
      for (const k of frontier) {
        if (budget-- <= 0) break;
        const n = this.nodes.get(k);
        if (!n || !this.hasChildren(n)) continue;
        await this.expand(k);
        next.push(...(n.children || []));
      }
      frontier = next;
    }
  }

  collapseAll() {
    for (const n of this.nodes.values()) n.expanded = false;
    this.nodes.get(this.rootKey).expanded = true;
    this.emit();
  }

  /** Abre el camino hasta una persona. Devuelve la cadena de nodos o null si queda fuera de la rama actual. */
  async locate(personId) {
    const { chain } = await api.get(`/tree/path/${personId}`);
    let start = 0;
    if (this.focus) {
      start = chain.findIndex((c) => c.id === this.focus.id);
      if (start < 0) return null;
    } else {
      // Raíz virtual de la cabeza: el primer eslabón cuelga de ella.
      const root = this.nodes.get('head');
      if (!root.children || !root.children.includes(this.personKey(chain[0].id))) {
        await this.loadChildren('head', { include: chain[0].id, append: !!root.children });
      } else root.expanded = true;
    }
    for (let i = start; i < chain.length - 1; i++) {
      const k = this.personKey(chain[i].id);
      const n = this.nodes.get(k);
      if (!n) return null;
      const nextKey = this.personKey(chain[i + 1].id);
      if (!n.children || !n.children.includes(nextKey)) await this.loadChildren(k, { include: chain[i + 1].id, append: !!n.children });
      else n.expanded = true;
    }
    this.emit();
    return chain.slice(start);
  }

  /** Lista aplanada de nodos visibles (para la vista de lista). */
  flatten() {
    const out = [];
    const stack = [[this.rootKey, 0]];
    while (stack.length) {
      const [k, depth] = stack.pop();
      const n = this.nodes.get(k);
      if (!n) continue;
      out.push({ node: n, depth });
      if (n.expanded && n.children) {
        if (this.remaining(k) > 0) {
          stack.push([`more:${k}`, depth + 1]);
          if (!this.nodes.has(`more:${k}`)) this.nodes.set(`more:${k}`, { key: `more:${k}`, kind: 'more', parent: k });
        }
        for (let i = n.children.length - 1; i >= 0; i--) stack.push([n.children[i], depth + 1]);
      }
    }
    return out;
  }

  remaining(k) {
    const n = this.nodes.get(k);
    if (!n?.children) return 0;
    return Math.max(0, n.total - n.children.length);
  }

  /** Disposición horizontal (izquierda → derecha) de los nodos visibles. */
  layout() {
    const items = [];
    const edges = [];
    let cursor = 0;
    const place = (k, depth) => {
      const n = this.nodes.get(k);
      const h = n.kind === 'head' ? HEAD_H : NODE_H;
      const x = depth * (NODE_W + GAP_X);
      const kids = [];
      if (n.expanded && n.children) {
        for (const c of n.children) kids.push(place(c, depth + 1));
        const rem = this.remaining(k);
        if (rem > 0) {
          const mk = `more:${k}`;
          const item = { key: mk, kind: 'more', x: (depth + 1) * (NODE_W + GAP_X), y: cursor, h: MORE_H, parent: k, remaining: rem };
          cursor += MORE_H + GAP_Y;
          items.push(item);
          kids.push(item);
        }
      }
      let y;
      if (kids.length) y = (kids[0].y + kids[0].h / 2 + kids[kids.length - 1].y + kids[kids.length - 1].h / 2) / 2 - h / 2;
      else { y = cursor; cursor += h + GAP_Y; }
      const item = { key: k, kind: n.kind, x, y, h, node: n };
      items.push(item);
      for (const c of kids) edges.push({ from: item, to: c });
      return item;
    };
    place(this.rootKey, 0);
    let minY = Infinity; let maxY = -Infinity; let maxX = 0;
    for (const it of items) { minY = Math.min(minY, it.y); maxY = Math.max(maxY, it.y + it.h); maxX = Math.max(maxX, it.x + NODE_W); }
    return { items, edges, bounds: { x: 0, y: minY, w: maxX, h: maxY - minY } };
  }
}

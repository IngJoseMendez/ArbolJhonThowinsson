// Almacén del árbol con carga progresiva de ramas (lazy loading + paginación).
// Lo comparten la vista gráfica y la vista de lista jerárquica.
//
// Dos alcances:
// - Una estructura (cabeza): su árbol, con la estructura como raíz.
// - La red completa (sin estructura): John Thowinsson arriba, la primera cabeza. De él cuelgan sus cabezas, cada una
//   con su propio árbol, y las personas que él invita directamente, cada una como una rama más. Cada nodo sabe de qué
//   estructura es, así que sus ramas se piden a la estructura que corresponde.
import { api, qs } from '../api.js';

export const PAGE = 50;
export const NODE_W = 236;
export const NODE_H = 66;
export const HEAD_H = 76;
export const NET_H = 92;
const GAP_X = 100; // deja sitio a los controles de expansión del nodo
const GAP_Y = 14;
const MORE_H = 36;

/** Estructura a la que pertenece un nodo (ninguna para John, la raíz de la red). */
const headOf = (n) => (n.kind === 'person' ? n.data.head_id : n.kind === 'head' ? n.data.id : null);

export class TreeStore {
  /**
   * head: la estructura cuyo árbol se muestra, o null para la red completa de John Thowinsson.
   * focusPerson: una persona que actúa como raíz (su rama).
   */
  constructor(head, focusPerson = null) {
    this.head = head;
    this.network = !head;
    this.focus = focusPerson;
    this.nodes = new Map();
    this.listeners = new Set();
    this.version = 0;
    const rootKey = focusPerson ? `p${focusPerson.id}` : head ? 'head' : 'red';
    this.rootKey = rootKey;
    let root;
    if (focusPerson) root = { kind: 'person', data: focusPerson, total: focusPerson.child_count };
    else if (head) root = { kind: 'head', data: head, total: null };
    else root = { kind: 'network', data: {}, total: null };
    this.nodes.set(rootKey, { key: rootKey, ...root, children: null, expanded: false, loading: false });
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.version++; for (const l of this.listeners) l(this.version); }
  get(key) { return this.nodes.get(key); }

  personKey(id) { return `p${id}`; }
  /** Estructura sin cabeza colgando de la red. */
  headKey(id) { return `h${id}`; }

  async loadChildren(key, { append = false, include = null, limit } = {}) {
    const n = this.nodes.get(key);
    if (!n || n.loading) return;
    n.loading = true; this.emit();
    try {
      if (n.kind === 'network') { await this.loadNetwork(n, { append, include, limit }); return; }
      const prev = n.children || [];
      const isExtra = (k) => !!this.nodes.get(k)?.extra;
      const regular = append ? prev.filter((k) => !isExtra(k)) : [];
      const prevExtras = prev.filter(isExtra);
      const offset = regular.length;
      const parent = n.kind === 'head' ? undefined : n.data.id;
      const r = await api.get(`/tree/${headOf(n)}/children${qs({ parent, offset, limit: PAGE, include })}`);
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

  /**
   * John Thowinsson: de él cuelgan sus cabezas (y las estructuras que aún no tienen cabeza), que llegan todas en la
   * primera página, y las personas que él invita directamente, de a PAGE (append: las siguientes; include: una de
   * ellas aunque quede fuera de la página, para localizarla).
   */
  async loadNetwork(n, { append = false, include = null, limit } = {}) {
    const prev = n.children || [];
    const isExtra = (k) => !!this.nodes.get(k)?.extra;
    const regular = append ? prev.filter((k) => !isExtra(k)) : [];
    const prevExtras = append ? prev.filter(isExtra) : [];
    const offset = regular.filter((k) => this.nodes.get(k)?.data?.is_direct).length;
    const r = await api.get(`/tree/network${qs({ offset: offset || undefined, limit, include })}`);
    n.data = r.root;
    const seen = new Set(regular);
    const extras = [];
    r.nodes.forEach(({ kind, ...d }, i) => {
      const k = kind === 'head' ? this.headKey(d.id) : this.personKey(d.id);
      const extra = i >= r.page; // incluida fuera de la página (para localizarla)
      const existing = this.nodes.get(k);
      if (existing) {
        existing.data = d;
        if (kind === 'person') existing.total = d.child_count;
        existing.parent = n.key;
        existing.extra = extra;
      } else {
        this.nodes.set(k, { key: k, kind, data: d, children: null, total: kind === 'person' ? d.child_count : null, expanded: false, loading: false, parent: n.key, extra });
      }
      if (seen.has(k)) return;
      seen.add(k);
      (extra ? extras : regular).push(k);
    });
    for (const k of prevExtras) if (!seen.has(k)) { seen.add(k); extras.push(k); }
    n.children = [...regular, ...extras];
    n.total = r.total;
    n.expanded = true;
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
    return n.kind === 'person' ? (n.data.child_count ?? n.total ?? 0) > 0 : true;
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

  /** Contraer todo: cierra el nodo y todos sus descendientes cargados (la raíz del árbol queda mostrando su primer nivel). */
  collapseBranch(key = this.rootKey) {
    const stack = [key];
    while (stack.length) {
      const k = stack.pop();
      const n = this.nodes.get(k);
      if (!n) continue;
      n.expanded = false;
      if (n.children) stack.push(...n.children);
    }
    if (key === this.rootKey) this.nodes.get(key).expanded = true;
    this.emit();
  }

  collapseAll() { this.collapseBranch(this.rootKey); }

  /** Orden de hermanos igual al del servidor: líderes primero, luego por fecha de registro. */
  static sortKeys(nodes) {
    return nodes.sort((a, b) => (b.is_leader - a.is_leader) || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id));
  }

  /**
   * Expandir todo: descarga la rama completa por bloques ordenados por ruta y abre todos los niveles,
   * incluidos los que nunca se habían abierto. Desde John (la red), cada cabeza se descarga entera, una tras otra.
   * Informa del progreso en this.progress.
   */
  async expandAll(key = this.rootKey, { chunk = 2000 } = {}) {
    const root = this.nodes.get(key);
    if (!root) return;
    if (root.kind === 'person' && !(root.data.child_count > 0)) return;
    if (root.kind === 'network') {
      if (!root.children) await this.loadChildren(key);
      // Todas las personas directas de John: cada una es una rama.
      for (let before = -1; this.remaining(key) > 0 && root.children.length !== before;) {
        before = root.children.length;
        await this.loadChildren(key, { append: true, limit: 2000 });
      }
    }
    const expected = root.kind === 'person' ? root.data.descendant_count : (root.data.people ?? null);
    const label = root.kind === 'network' ? 'toda la red' : root.kind === 'head' ? root.data.cabeza_name || root.data.name : root.data.full_name;
    const token = (this.loadToken = {});
    this.progress = { key, loaded: 0, total: expected, label };
    this.emit();
    try {
      const branches = root.kind === 'network' ? root.children || [] : [key];
      for (const bk of branches) {
        const b = this.nodes.get(bk);
        if (!b || (b.kind === 'person' && !(b.data.child_count > 0))) continue;
        if (!(await this.loadBranch(b, token, chunk))) return; // cancelado
      }
      root.expanded = true;
    } finally {
      if (this.loadToken === token) { this.progress = null; this.loadToken = null; this.emit(); }
    }
  }

  /** Descarga una rama entera (una persona o una estructura) y abre todos sus niveles. false si se canceló. */
  async loadBranch(root, token, chunk) {
    const key = root.key;
    const kids = new Map(); // clave del padre -> [datos]
    const all = [];
    let after = null;
    do {
      const r = await api.get(`/tree/${headOf(root)}/subtree${qs({ root: root.kind === 'person' ? root.data.id : undefined, after, limit: chunk })}`);
      if (this.loadToken !== token) return false;
      for (const d of r.nodes) {
        all.push(d);
        const k = this.personKey(d.id);
        const existing = this.nodes.get(k);
        if (existing) { existing.data = d; existing.total = d.child_count; existing.extra = false; }
        else this.nodes.set(k, { key: k, kind: 'person', data: d, children: null, total: d.child_count, expanded: false, loading: false, extra: false });
      }
      after = r.next;
      this.progress = { ...this.progress, loaded: (this.progress?.loaded || 0) + r.nodes.length };
      this.emit();
    } while (after);
    // Reconstruye las listas completas de hijos y abre todos los niveles.
    const inBranch = new Set(all.map((d) => d.id));
    const rootPersonId = root.kind === 'person' ? root.data.id : null;
    for (const d of all) {
      // Cuelga de su invitador si está en la rama (o es la raíz); si no, de la raíz de la rama.
      const parentKey = d.inviter_id && (inBranch.has(d.inviter_id) || d.inviter_id === rootPersonId) ? this.personKey(d.inviter_id) : key;
      this.nodes.get(this.personKey(d.id)).parent = parentKey;
      if (!kids.has(parentKey)) kids.set(parentKey, []);
      kids.get(parentKey).push(d);
    }
    for (const [pk, list] of kids) {
      const n = this.nodes.get(pk);
      if (!n) continue;
      n.children = TreeStore.sortKeys(list).map((d) => this.personKey(d.id));
      n.total = list.length;
      n.expanded = true;
    }
    for (const d of all) {
      const n = this.nodes.get(this.personKey(d.id));
      if (!kids.has(n.key)) { n.children = []; n.total = 0; }
    }
    root.expanded = true;
    return true;
  }

  cancelLoad() {
    this.loadToken = null;
    this.progress = null;
    this.emit();
  }

  /** Identificadores de los nodos expandidos (para persistir el estado). */
  snapshot() {
    const expanded = [];
    const heads = [];
    for (const n of this.nodes.values()) {
      if (!n.expanded || n.key === this.rootKey) continue;
      if (n.kind === 'person') expanded.push(n.data.id);
      else if (n.kind === 'head') heads.push(n.data.id);
    }
    if (this.focus && this.nodes.get(this.rootKey)?.expanded) expanded.push(this.focus.id);
    return { rootExpanded: !!this.nodes.get(this.rootKey)?.expanded, expanded, heads };
  }

  /**
   * Restaura un estado guardado: carga por niveles (una petición por estructura y por cada 2000 ramas abiertas)
   * los hijos de los nodos que estaban expandidos.
   */
  async restore(saved) {
    const want = new Set(saved.expanded || []);
    const wantHeads = new Set(saved.heads || []);
    const root = this.nodes.get(this.rootKey);
    if (saved.rootExpanded && !root.children) await this.loadChildren(this.rootKey);
    root.expanded = !!saved.rootExpanded;
    let frontier = root.children || [];
    for (let guard = 0; frontier.length && guard < 500; guard++) {
      const next = [];
      // Estructuras sin cabeza dentro de la red: sus raíces (son pocas).
      for (const k of frontier) {
        const n = this.nodes.get(k);
        if (n?.kind !== 'head' || !wantHeads.has(n.data.id)) continue;
        await this.loadChildren(k);
        next.push(...(n.children || []));
      }
      const toLoad = frontier.map((k) => this.nodes.get(k)).filter((n) => n && n.kind === 'person' && want.has(n.data.id));
      const byHead = new Map();
      for (const n of toLoad) {
        if (!byHead.has(n.data.head_id)) byHead.set(n.data.head_id, []);
        byHead.get(n.data.head_id).push(n);
      }
      for (const [headId, list] of byHead) {
        for (let i = 0; i < list.length; i += 2000) {
          const part = list.slice(i, i + 2000);
          const r = await api.post(`/tree/${headId}/children-batch`, { parents: part.map((n) => n.data.id) });
          const byParent = new Map();
          for (const d of r.nodes) {
            const k = this.personKey(d.id);
            if (!this.nodes.has(k)) this.nodes.set(k, { key: k, kind: 'person', data: d, children: null, total: d.child_count, expanded: false, loading: false });
            else this.nodes.get(k).data = d;
            if (!byParent.has(d.inviter_id)) byParent.set(d.inviter_id, []);
            byParent.get(d.inviter_id).push(k);
          }
          for (const n of part) {
            if (!r.parents.includes(n.data.id)) continue;
            n.children = byParent.get(n.data.id) || [];
            for (const c of n.children) this.nodes.get(c).parent = n.key;
            n.total = n.children.length;
            n.expanded = true;
            next.push(...n.children);
          }
        }
      }
      frontier = next;
      this.emit();
    }
    this.emit();
  }

  /** Abre el camino hasta una persona. Devuelve la cadena de nodos o null si queda fuera de la rama actual. */
  async locate(personId) {
    const { chain } = await api.get(`/tree/path/${personId}`);
    let start = 0;
    if (this.focus) {
      start = chain.findIndex((c) => c.id === this.focus.id);
      if (start < 0) return null;
    } else if (this.network) {
      // Red completa: la cabeza (primer eslabón) o la persona que John invitó directamente cuelga de John; en una
      // estructura sin cabeza, de la estructura.
      const root = this.nodes.get(this.rootKey);
      const first = this.personKey(chain[0].id);
      const hk = this.headKey(chain[0].head_id);
      const listed = () => !!root.children && (root.children.includes(first) || root.children.includes(hk));
      // P. ej., una cabeza nueva desde que se abrió el árbol, o una persona directa fuera de las ya cargadas.
      if (!listed()) await this.loadChildren(this.rootKey, { include: chain[0].id });
      else root.expanded = true;
      if (!listed()) return null;
      if (!root.children.includes(first)) {
        const hn = this.nodes.get(hk);
        if (!hn.children || !hn.children.includes(first)) await this.loadChildren(hk, { include: chain[0].id, append: !!hn.children });
        else hn.expanded = true;
      }
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
      const h = n.kind === 'network' ? NET_H : n.kind === 'head' ? HEAD_H : NODE_H;
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

// ---------------------------------------------------------------------------
// Persistencia del estado del árbol
// - En memoria: al ir a una ficha y volver, el árbol reaparece exactamente igual (mismo objeto).
// - sessionStorage: al recargar la pestaña se restauran ramas abiertas, zoom, selección y filtros.
// ---------------------------------------------------------------------------
const memory = new Map();
const MAX_CACHED = 8;
const SS_PREFIX = 'arbol:tree:';

export function getCachedTree(key) { return memory.get(key) || null; }
export function putCachedTree(key, store) {
  memory.delete(key);
  memory.set(key, store);
  while (memory.size > MAX_CACHED) memory.delete(memory.keys().next().value);
}
export function loadTreeState(key) {
  try { return JSON.parse(sessionStorage.getItem(SS_PREFIX + key) || 'null'); } catch { return null; }
}
export function saveTreeState(key, state) {
  try { sessionStorage.setItem(SS_PREFIX + key, JSON.stringify(state)); } catch { /* sin almacenamiento disponible */ }
}
export function clearTreeCaches() {
  memory.clear();
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(SS_PREFIX)) sessionStorage.removeItem(k);
    }
  } catch { /* */ }
}

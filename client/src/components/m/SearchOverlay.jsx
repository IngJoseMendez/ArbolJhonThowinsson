import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ArrowLeft, Search } from 'lucide-react';
import { api, qs } from '../../api.js';
import { recentSearches, rememberSearch, tabOf, useGo } from '../../lib/nav.js';
import { osName } from '../../lib/device.js';
import Sheet from './Sheet.jsx';
import { Group, Row, Section } from './List.jsx';
import { PersonAvatar } from './Spark.jsx';
import { CAMPAIGN } from '../../brand/Brand.jsx';

let openFn = null;
/** Abre el buscador y enfoca el campo en el mismo toque (así el iPhone abre el teclado). */
export function openSearch() { openFn?.(); }

export default function SearchOverlay() {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const go = useGo();

  useEffect(() => {
    openFn = () => {
      flushSync(() => setOpen(true));
      input.current?.focus();
    };
    return () => { openFn = null; };
  }, []);

  const q = term.trim();
  const enough = q.replace(/\D/g, '').length >= 4 || q.replace(/[\d\s]/g, '').length >= 2;
  useEffect(() => {
    if (!open || !enough) { setItems(null); return undefined; }
    let alive = true;
    setBusy(true);
    const t = setTimeout(() => {
      api.get(`/search${qs({ q })}`).then((r) => alive && setItems(r)).catch(() => alive && setItems([])).finally(() => alive && setBusy(false));
    }, 220);
    return () => { alive = false; clearTimeout(t); };
  }, [q, enough, open]);

  if (!open) return null;
  const close = () => { setOpen(false); setTerm(''); setItems(null); };
  const pick = (p) => {
    rememberSearch(p);
    const to = p.is_head ? `/cabezas/${p.head_id}` : `/personas/${p.id}`;
    close();
    // Se abre en la pestaña que le corresponde, reemplazando la entrada del buscador: «atrás» vuelve a la pantalla
    // donde se abrió el buscador.
    go(to, { replace: true, tab: tabOf(to) });
  };
  const groups = items ? [
    ['Cabezas', items.filter((p) => p.is_head)],
    ['Líderes', items.filter((p) => p.is_leader && !p.is_head)],
    ['Personas', items.filter((p) => !p.is_leader && !p.is_head)],
  ].filter(([, list]) => list.length) : [];
  const row = (p) => (
    <Row key={p.id} lead={<PersonAvatar name={p.full_name} leader={p.is_leader} head={p.is_head} photo={p.photo_url} />} title={p.full_name}
      meta={p.is_head ? `Cabeza de ${CAMPAIGN}` : p.is_leader ? `Líder${p.inviter_name ? `, con ${p.inviter_name}` : ''}` : p.inviter_name ? `Con ${p.inviter_name}` : p.head_name}
      chevron onClick={() => pick(p)} />
  );
  return (
    <Sheet onClose={close} size="full" className="m-search" title="Buscar" bare>
      {({ close: dismiss }) => (
        <>
          <div className="m-search__field">
            {osName() === 'android' && <button type="button" className="m-icon-btn" aria-label="Atrás" onClick={dismiss}><ArrowLeft size={22} /></button>}
            <span className="m-search__box">
              <Search size={18} aria-hidden="true" />
              <input ref={input} id="m-search-input" className="input" type="search" enterKeyHint="search" autoComplete="off" spellCheck={false}
                placeholder="Persona, líder o cabeza" aria-label="Buscar persona, líder o cabeza" value={term} onChange={(e) => setTerm(e.target.value)} />
            </span>
            {osName() !== 'android' && <button type="button" className="m-search__cancel" onClick={dismiss}>Cancelar</button>}
          </div>
          {!enough && (
            recentSearches().length ? <Section title="Recientes"><Group>{recentSearches().map(row)}</Group></Section>
              : <p className="m-hint">Escriba al menos 2 letras o 4 dígitos del celular.</p>
          )}
          {enough && busy && !items && <p className="m-hint">Buscando…</p>}
          {enough && items && !groups.length && <p className="m-hint">Nadie coincide con «{q}».</p>}
          {groups.map(([title, list]) => <Section key={title} title={title}><Group>{list.map(row)}</Group></Section>)}
        </>
      )}
    </Sheet>
  );
}

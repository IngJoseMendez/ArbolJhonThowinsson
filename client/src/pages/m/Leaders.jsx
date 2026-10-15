import { useEffect, useState } from 'react';
import { Crown, Search } from 'lucide-react';
import { api, qs } from '../../api.js';
import { useCached } from '../../lib/cache.js';
import { teamName, useTeams } from '../../lib/teams.js';
import Screen from '../../components/m/Screen.jsx';
import { Chip, Chips, EmptyState, Group, Row, RowsSkeleton } from '../../components/m/List.jsx';
import { PersonAvatar } from '../../components/m/Spark.jsx';
import { StatusBadge } from '../../components/ui.jsx';

const nf = new Intl.NumberFormat('es');

/** Líderes: búsqueda y fichas por cabeza; cada fila abre su ficha. */
export default function Leaders() {
  const teams = useTeams();
  const [headId, setHeadId] = useState('');
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(term.trim().length >= 2 ? term.trim() : ''), 300); return () => clearTimeout(t); }, [term]);
  const list = useCached(`leaders:${headId}:${q}`, () => api.get(`/leaders${qs({ head_id: headId, q })}`), { ttl: 30000 });
  const heads = teams.active;
  return (
    <Screen title="Líderes" back="/mas" count={list.data ? nf.format(list.data.length) : undefined}>
      <div className="m-search-inline">
        <Search size={18} aria-hidden="true" />
        <input className="input" type="search" enterKeyHint="search" placeholder="Nombre o código" aria-label="Buscar líderes" value={term} onChange={(e) => setTerm(e.target.value)} />
      </div>
      {heads.length > 1 && (
        <Chips label="Cabeza" className="m-quick-filters">
          <Chip active={!headId} onClick={() => setHeadId('')}>Todas</Chip>
          {heads.map((h) => <Chip key={h.id} active={String(h.id) === String(headId)} onClick={() => setHeadId(String(h.id))}>{teams.short(h)}</Chip>)}
        </Chips>
      )}
      {list.loading ? <RowsSkeleton rows={6} /> : list.data?.length ? (
        <Group>
          {list.data.map((l) => (
            <Row key={l.id} to={`/personas/${l.id}`} lead={<PersonAvatar name={l.full_name} leader head={l.is_head} photo={l.photo_url} />} title={l.full_name}
              meta={<>{l.status !== 'active' && <><StatusBadge status={l.status} /> </>}{l.is_head ? 'Cabeza de su equipo' : teamName(teams.byId.get(l.head_id)) || l.head_name}</>}
              trail={<><span>{nf.format(l.branch)}</span><small>{l.is_head ? 'en su equipo' : 'en su red'}</small></>} chevron={false} />
          ))}
        </Group>
      ) : <EmptyState icon={Crown} title={q ? `Ningún líder coincide con «${q}»` : 'Aún no hay líderes'}>{q ? 'Pruebe con otro nombre o con su código.' : 'Invite líderes desde Invitar.'}</EmptyState>}
    </Screen>
  );
}

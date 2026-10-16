import { useCallback, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Crown, MoreHorizontal, MoreVertical, Pencil, UserCircle, UserPlus, Users } from 'lucide-react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { useCached, invalidate } from '../../lib/cache.js';
import { osName } from '../../lib/device.js';
import { fmtDate, relTime } from '../../lib/format.js';
import { useGo } from '../../lib/nav.js';
import { useQueryState } from '../../lib/useParams.js';
import { CAMPAIGN } from '../../brand/Brand.jsx';
import { useOneTimeInvite } from '../../lib/invites.js';
import { extLinkProps, inviteText, waUrl } from '../../lib/whatsapp.js';
import Screen, { BarButton } from '../../components/m/Screen.jsx';
import Sheet, { ActionSheet } from '../../components/m/Sheet.jsx';
import { EmptyState, Group, Row, RowsSkeleton, Section, Segmented } from '../../components/m/List.jsx';
import { PersonAvatar, TeamAvatar, TrendChart } from '../../components/m/Spark.jsx';
import { InviteButton, InviteCounts, SentLine, useRoleTypes } from '../../components/invite/InviteBlocks.jsx';
import { ErrorBox, WhatsAppIcon } from '../../components/ui.jsx';
import TreeExplorerView from '../../components/TreeExplorerView.jsx';
import RegisterPersonModal from '../../components/RegisterPersonModal.jsx';
import { HeadFormModal } from '../Heads.jsx';

const nf = new Intl.NumberFormat('es');

const count = (n, one, many) => `${nf.format(n)} ${n === 1 ? one : many}`;

/** Estado de los registros en una sola barra: activas, por aprobar e inactivas. */
function StatusBar({ t }) {
  const total = Math.max(1, t.active + t.pending + t.inactive);
  const seg = [[t.active, 'var(--good)'], [t.pending, 'var(--warning)'], [t.inactive, 'var(--axis)']];
  const text = `${count(t.active, 'activa', 'activas')}, ${nf.format(t.pending)} por aprobar, ${count(t.inactive, 'inactiva', 'inactivas')}`;
  return (
    <div className="card m-chart-card">
      <div className="m-stack-bar" role="img" aria-label={text}>
        {seg.map(([n, c], i) => n > 0 && <span key={i} style={{ '--w': `${(n / total) * 100}%`, '--c': c }} />)}
      </div>
      <p className="m-note" style={{ margin: '10px 0 0' }}>{text}</p>
    </div>
  );
}

export default function Head() {
  const { id } = useParams();
  const a = useAuth();
  const go = useGo();
  const [params, setParams] = useQueryState();
  const tab = ['lideres', 'resumen', 'arbol'].includes(params.tab) ? params.tab : 'lideres';
  const { data, error, loading, reload } = useCached(`head:${id}`, () => api.get(`/heads/${id}`), { ttl: 20000 });
  const [menu, setMenu] = useState(null);
  const leaderType = useRoleTypes('leader').base;
  const More = osName() === 'android' ? MoreVertical : MoreHorizontal;

  const h = data?.head;
  const c = data?.cabeza;
  const direct = !!h?.is_direct; // «Directo con John»: lo encabeza él
  const canInvite = !!(data?.can_manage && h?.status === 'active' && leaderType);
  const cabezaName = c?.full_name || null;
  const makeText = useCallback(({ url, name }) => inviteText({ role: 'leader', name, cabeza: cabezaName, direct, url }), [cabezaName, direct]);
  const invite = useOneTimeInvite({ typeId: leaderType?.id, headId: h?.id, role: 'leader', cabeza: cabezaName, makeText, enabled: canInvite });
  const leaders = useMemo(() => (data?.leaders || []).filter((l) => !l.is_head), [data]);
  const t = data?.stats?.totals;
  const points = useMemo(() => (data?.stats?.growth.series || []).map((s) => ({ day: s.day, value: Object.values(s.values).reduce((n, v) => n + v, 0) })), [data]);
  const headRow = h ? { ...h, cabeza_name: cabezaName } : null;
  const title = cabezaName || h?.name || 'Cabeza';

  const changed = () => { reload(); invalidate('heads'); invalidate('dash'); };
  if (error) return <Screen title="Cabeza" back="/cabezas" noHero><ErrorBox error={error} /></Screen>;

  const header = (ref) => (
    <div className="m-detail">
      <div className="m-detail__top">
        {c ? <PersonAvatar name={c.full_name} head size={56} photo={c.photo_url} /> : headRow ? <TeamAvatar head={headRow} size={56} /> : <span className="skeleton m-sk-avatar" />}
        <span className="m-detail__since">
          {h ? (c ? `Cabeza de ${CAMPAIGN} desde el ${fmtDate(c.created_at)}` : direct ? `Lo encabeza ${CAMPAIGN}` : 'Sin cabeza asignada') : ''}{h?.status === 'archived' ? ', estructura archivada' : ''}
        </span>
      </div>
      <h1 ref={ref} className="m-detail__name">{loading && !data ? '…' : title}</h1>
      {c && <p className="m-detail__line">{c.panel_active ? (c.panel_viewed_at ? `Abrió su panel ${relTime(c.panel_viewed_at)}` : 'Aún no abre su panel') : 'Sin panel'}</p>}
      {!c && h && <p className="m-detail__line">{direct ? 'Personas que llegan directo con él' : `${h.name}${h.region ? `, ${h.region}` : ''}`}</p>}
      {t && (
        <div className="m-strip">
          <div><b>{nf.format(leaders.length)}</b><span>{leaders.length === 1 ? 'líder' : 'líderes'}</span></div>
          <div><b>{nf.format(t.people)}</b><span>{t.people === 1 ? 'persona' : 'personas'}</span></div>
          <div className={t.last7 ? 'is-good' : ''}><b>+{nf.format(t.last7)}</b><span>esta semana</span></div>
        </div>
      )}
    </div>
  );
  const heroActions = canInvite && (
    <div className="m-hero__actions">
      <InviteButton invite={invite}>Invitar un líder</InviteButton>
      <SentLine role="leader" headId={h.id} />
      <InviteCounts stats={invite.stats} to={`/enlaces?estado=sin-usar&tipo=${leaderType.id}&cabeza=${h.id}`} />
    </div>
  );
  const waIcon = canInvite && invite.ready && (
    <a className="m-bar__wa" href={waUrl(invite.text())} {...extLinkProps()} onClick={() => invite.onSend()} aria-label={`Invitar un líder para ${title} por WhatsApp`}>
      <WhatsAppIcon size={19} />
    </a>
  );
  const menuBtn = <BarButton icon={More} label="Más opciones" onClick={() => setMenu('more')} />;

  return (
    <Screen title={title} back="/cabezas" heroTitle={header} hero={heroActions} actions={menuBtn} compactActions={<>{waIcon}{menuBtn}</>}
      bodyClassName={tab === 'arbol' ? 'm-body--tree' : ''}>
      <Segmented sticky label="Secciones de la cabeza" value={tab} onChange={(v) => {
        setParams({ tab: v === 'lideres' ? null : v, foco: null, persona: null }, true);
        if (v === 'arbol') {
          requestAnimationFrame(() => {
            const seg = document.querySelector('.m-seg.is-sticky');
            const bar = document.querySelector('.m-bar');
            if (seg && bar) window.scrollTo({ top: seg.getBoundingClientRect().top + window.scrollY - bar.offsetHeight - 6, behavior: 'smooth' });
          });
        }
      }}
        options={[{ value: 'lideres', label: 'Líderes', count: data ? leaders.length : undefined }, { value: 'resumen', label: 'Resumen' }, { value: 'arbol', label: 'Árbol' }]} />

      {tab === 'lideres' && (
        <div className="m-seg-body">
          {loading && !data ? <RowsSkeleton rows={4} /> : leaders.length ? (
            <Group>
              {leaders.map((l) => {
                const meta = l.status === 'pending' ? <span className="badge badge-warning">Por aprobar</span>
                  : l.last7 > 0 ? <span className="m-delta">+{l.last7} esta semana</span>
                    : l.inviter_name && !l.inviter_is_head ? `con ${l.inviter_name}`
                      : l.branch === 0 ? `Desde el ${fmtDate(l.created_at)}, aún sin gente` : `Desde el ${fmtDate(l.created_at)}`;
                return (
                  <Row key={l.id} lead={<PersonAvatar name={l.full_name} leader photo={l.photo_url} />} title={l.full_name} meta={meta} to={`/personas/${l.id}`}
                    trail={<><span>{nf.format(l.branch)}</span><small>en su red</small></>} chevron={false} />
                );
              })}
              {canInvite && invite.ready && (
                <a className="m-row m-row--action" href={waUrl(invite.text())} {...extLinkProps()} onClick={() => invite.onSend()}>
                  <span className="m-row__lead"><span className="m-today-icon is-wa"><WhatsAppIcon size={18} /></span></span>
                  <span className="m-row__main"><span className="m-row__title">Invitar otro líder</span></span>
                </a>
              )}
            </Group>
          ) : (
            <EmptyState icon={Crown} title="Todavía no hay líderes">
              {canInvite ? 'Invite al primero: cada líder suma a su propia gente.' : 'Cuando se registren líderes en este equipo, aparecerán aquí.'}
            </EmptyState>
          )}
          {t && t.people > 0 && (
            <Group className="m-group--spaced">
              <Row lead={<span className="m-today-icon"><Users size={18} /></span>} title={t.people === 1 ? 'Ver a la persona del equipo' : `Ver las ${nf.format(t.people)} personas del equipo`}
                onClick={() => go(`/personas?head_id=${id}`, { tab: 'personas' })} chevron />
            </Group>
          )}
        </div>
      )}

      {tab === 'resumen' && t && (
        <div className="m-seg-body">
          <Section title="Así crece, últimos 60 días">
            <div className="card m-chart-card"><TrendChart points={points} label={`Personas en el equipo de ${title}`} /></div>
          </Section>
          <Section title="Estado de los registros"><StatusBar t={t} /></Section>
          {data.stats.perLeader.filter((l) => !l.is_head).length > 0 && (
            <Section title="Líderes que más suman">
              <Group>
                {data.stats.perLeader.filter((l) => !l.is_head).slice(0, 5).map((l) => (
                  <Row key={l.id} lead={<PersonAvatar name={l.full_name} leader photo={l.photo_url} />} title={l.full_name} to={`/personas/${l.id}`}
                    trail={<><span>{nf.format(l.branch)}</span><small>en su red</small></>} chevron={false} />
                ))}
              </Group>
            </Section>
          )}
          <p className="m-note">Cómo llegan: {nf.format(t.via_invitation)} por enlace, {nf.format(t.via_manual)} a mano.</p>
          {data.stats.recent.length > 0 && (
            <Section title="Recién registrados">
              <Group>
                {data.stats.recent.slice(0, 5).map((r) => (
                  <Row key={r.id} lead={<PersonAvatar name={r.full_name} leader={r.is_leader} head={r.is_head} photo={r.photo_url} />} title={r.full_name} to={`/personas/${r.id}`}
                    meta={r.inviter_name ? `con ${r.inviter_name}` : r.is_head ? `Cabeza, con ${CAMPAIGN}` : r.is_direct ? `Directo con ${CAMPAIGN}` : 'Líder'} trail={<small>{relTime(r.created_at)}</small>} chevron={false} />
                ))}
              </Group>
            </Section>
          )}
        </div>
      )}

      {tab === 'arbol' && h && (
        <div className="m-tree-wrap">
          <TreeExplorerView lockHead compact heads={[{ ...h, people: t?.people, cabeza_name: cabezaName }]} params={{ ...params, cabeza: h.id }} setParams={(p) => setParams(p, true)} />
        </div>
      )}

      {menu === 'more' && (
        <ActionSheet onClose={() => setMenu((m) => (m === 'more' ? null : m))} groups={[[
          { label: 'Ver su ficha', icon: UserCircle, hidden: !c, onSelect: () => go(`/personas/${c.id}`) },
          { label: 'Registrar a alguien aquí', icon: UserPlus, hidden: !data?.can_manage || h?.status !== 'active', onSelect: () => setMenu('register') },
          { label: 'Editar estructura', icon: Pencil, hidden: !data?.can_manage, onSelect: () => setMenu('edit') },
          { label: 'Elegir su cabeza', icon: Crown, hidden: !(a.isSuper && h && !c && !direct), onSelect: () => setMenu('choose') },
        ]]} />
      )}
      {menu === 'register' && <RegisterPersonModal defaultHeadId={h.id} onClose={() => setMenu(null)} onCreated={(p) => { changed(); go(`/personas/${p.id}`); }} />}
      {menu === 'edit' && <HeadFormModal head={h} onClose={() => setMenu(null)} onSaved={changed} />}
      {menu === 'choose' && (
        <Sheet title="Elegir su cabeza" subtitle="Abra la ficha de un líder raíz y elija «Designar como cabeza». Los demás líderes pasarán a colgar de ella." onClose={() => setMenu(null)}>
          <Group>
            {(data?.leaders || []).filter((l) => !l.inviter_id).map((l) => (
              <Row key={l.id} lead={<PersonAvatar name={l.full_name} leader photo={l.photo_url} />} title={l.full_name} meta="Líder raíz" to={`/personas/${l.id}`} />
            ))}
          </Group>
          {!(data?.leaders || []).some((l) => !l.inviter_id) && <p className="m-hint">Esta estructura aún no tiene líderes raíz. Invite uno o registre a la cabeza.</p>}
        </Sheet>
      )}
    </Screen>
  );
}

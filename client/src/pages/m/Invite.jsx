import { useEffect, useState } from 'react';
import { ClipboardCheck, Send, UserPlus } from 'lucide-react';
import { api, qs } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { useCached, invalidate } from '../../lib/cache.js';
import { useGo } from '../../lib/nav.js';
import { useQueryState } from '../../lib/useParams.js';
import { useRegTypes } from '../../lib/regTypes.js';
import Screen from '../../components/m/Screen.jsx';
import { ActionRow, EmptyState, Group, RowsSkeleton, Section } from '../../components/m/List.jsx';
import { InviteHeadBlock, InviteLeaderBlock, PersonLinkBlock } from '../../components/invite/InviteBlocks.jsx';
import { LinkRow } from '../../components/invite/LinkRows.jsx';
import RegisterPersonModal from '../../components/RegisterPersonModal.jsx';

/** Últimas invitaciones de un estado (sin usar o usadas), en caché para volver al instante. */
function useInviteList(state, size = 5) {
  return useCached(`links:${state}:${size}`, () => api.get(`/links${qs({ one_time: 1, state, pageSize: size })}`), { ttl: 20000 });
}

const LEGACY_ID = { head: 'invitar-cabeza', leader: 'invitar-lider', person: 'invitar-personas' };

/**
 * Invitar: la pantalla del centro de la barra. Un bloque por cada tipo de registro (CAB, COV, LID…), uno debajo del
 * otro y con su color, cada uno con su botón de WhatsApp listo; luego lo que está sin usar y quiénes se registraron.
 * Las cabezas sólo las invita el administrador general.
 */
export default function Invite() {
  const a = useAuth();
  const go = useGo();
  const [params] = useQueryState();
  const [registering, setRegistering] = useState(false);
  const open = useInviteList('open');
  const used = useInviteList('used');
  const pending = useCached('counts:pending', () => api.get('/pending?count=1'), { ttl: 60000 });
  const types = useRegTypes();
  const list = types.list.filter((t) => t.active && (t.role !== 'head' || a.isSuper));
  // El primero de cada papel conserva el ancla de siempre (/invitar?que=cabeza|lider|personas).
  const seen = new Set();
  const blocks = list.map((t) => {
    const id = seen.has(t.role) ? `invitar-tipo-${t.id}` : LEGACY_ID[t.role];
    seen.add(t.role);
    if (t.role === 'head') return <InviteHeadBlock key={t.id} type={t} id={id} hero={false} />;
    if (t.role === 'leader') return <InviteLeaderBlock key={t.id} type={t} id={id} />;
    return <PersonLinkBlock key={t.id} type={t} id={id} />;
  });

  // /invitar?que=cabeza|lider|personas: lleva a ese bloque y lo resalta.
  useEffect(() => {
    const id = { cabeza: 'invitar-cabeza', lider: 'invitar-lider', personas: 'invitar-personas' }[params.que];
    const el = id && document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    el.classList.add('is-target');
    const t = setTimeout(() => el.classList.remove('is-target'), 2000);
    return () => clearTimeout(t);
  }, [params.que, list.length]);

  const none = open.data && used.data && !open.data.total && !used.data.total;
  return (
    <Screen title="Invitar"
      actions={<button type="button" className="m-bar__text-btn" onClick={() => go('/enlaces')}>Enlaces</button>}
      hero={<p className="m-hero__sub">Cada invitación es personal: sirve a una sola persona y vence en 7 días.</p>}>
      {blocks.length ? blocks : <RowsSkeleton rows={3} />}

      <Section>
        <Group>
          <ActionRow icon={UserPlus} onClick={() => setRegistering(true)}>Registrar a alguien aquí<span className="list-row__sub">Si la persona está con usted</span></ActionRow>
          {pending.data?.count > 0 && <ActionRow icon={ClipboardCheck} to="/pendientes" value={pending.data.count}>Por aprobar</ActionRow>}
        </Group>
      </Section>

      {none ? (
        <EmptyState icon={Send} title="Aún no ha enviado invitaciones">
          {a.isSuper ? 'Empiece por una cabeza: ella arma su equipo.' : 'Empiece por un líder: cada líder suma a su gente.'}
        </EmptyState>
      ) : (
        <>
          <Section title="Sin usar" action={open.data?.total > 5 && <button type="button" className="m-link-btn" onClick={() => go('/enlaces?estado=sin-usar')}>Ver todas</button>}>
            {open.loading ? <RowsSkeleton rows={2} /> : open.data?.rows.length ? (
              <Group>{open.data.rows.map((l) => <LinkRow key={l.id} link={l} />)}</Group>
            ) : <p className="m-note">Todas las invitaciones enviadas ya se usaron.</p>}
          </Section>
          <Section title="Se registraron" action={used.data?.total > 5 && <button type="button" className="m-link-btn" onClick={() => go('/enlaces?estado=usadas')}>Ver todas</button>}>
            {used.loading ? <RowsSkeleton rows={2} /> : used.data?.rows.length ? (
              <Group>{used.data.rows.map((l) => <LinkRow key={l.id} link={l} />)}</Group>
            ) : <p className="m-note">Cuando alguien se registre con una invitación, aparecerá aquí.</p>}
          </Section>
        </>
      )}
      {registering && <RegisterPersonModal onClose={() => setRegistering(false)}
        onCreated={(p) => { invalidate('counts:'); invalidate('dash'); go(`/personas/${p.id}`); }} />}
    </Screen>
  );
}

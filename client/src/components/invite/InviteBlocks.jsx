import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ChevronRight, Copy, RotateCw, Share, Share2, UserRound } from 'lucide-react';
import { Mark } from '../../brand/Brand.jsx';
import { useAuth } from '../../auth.jsx';
import { api, qs } from '../../api.js';
import { osName } from '../../lib/device.js';
import { useGo } from '../../lib/nav.js';
import { getLastSent, subscribeSent, useGeneralLink, useOneTimeInvite, copyNow } from '../../lib/invites.js';
import { useRegTypes, typeVars } from '../../lib/regTypes.js';
import { inviteMessage, useToast, WhatsAppIcon } from '../ui.jsx';
import { extLinkProps, inviteText, waUrl } from '../../lib/whatsapp.js';
import { teamName, useTeams } from '../../lib/teams.js';
import { Chip, Chips } from '../m/List.jsx';
import Sheet from '../m/Sheet.jsx';
import { PersonAvatar, TeamAvatar } from '../m/Spark.jsx';

const ShareIcon = () => (osName() === 'ios' ? <Share size={17} aria-hidden="true" /> : <Share2 size={17} aria-hidden="true" />);
const time = new Intl.DateTimeFormat('es', { hour: 'numeric', minute: '2-digit' });

/** Tipo base (Cabeza o Líder) y los demás tipos activos del mismo papel. */
export function useRoleTypes(role) {
  const types = useRegTypes();
  return useMemo(() => {
    const list = types.list.filter((t) => t.active && t.role === role);
    return { list, base: list.find((t) => t.builtin) || list[0] || null };
  }, [types.list, role]);
}

/**
 * Botón verde de WhatsApp con la invitación ya preparada: es un enlace real, así un toque abre WhatsApp.
 * Mientras se prepara dice «Preparando…»; si falló, ofrece reintentar.
 */
export function InviteButton({ invite, label, children, phone, className = '' }) {
  if (invite.error && !invite.ready) {
    return (
      <button type="button" className={`m-wa ${className}`} onClick={invite.retry}>
        <RotateCw size={18} aria-hidden="true" />No se pudo preparar la invitación. Reintentar
      </button>
    );
  }
  if (!invite.ready) {
    return <span className={`m-wa ${className}`} aria-disabled="true" role="link"><WhatsAppIcon size={20} />Preparando…</span>;
  }
  return (
    <a className={`m-wa ${className}`} href={waUrl(invite.text(label), phone)} {...extLinkProps()} onClick={() => invite.onSend(label)}>
      <WhatsAppIcon size={20} />{children}
    </a>
  );
}

/** Compartir con otra app y copiar el mensaje (también cuentan como invitación enviada). */
export function InviteAlt({ invite, label }) {
  const toast = useToast();
  const canShare = typeof navigator !== 'undefined' && !!navigator.share;
  return (
    <div className="m-invite__alt">
      {canShare ? <button type="button" disabled={!invite.ready} onClick={() => invite.share(label)}><ShareIcon />Compartir</button> : <span />}
      <button type="button" disabled={!invite.ready} onClick={() => invite.copy(label).then((ok) => { if (!ok) toast('No se pudo copiar. Mantenga el dedo sobre el enlace para copiarlo.', 'error'); })}>
        <Copy size={17} aria-hidden="true" />Copiar mensaje
      </button>
    </div>
  );
}

/** «5 enviadas, 3 se registraron, 2 sin usar ›»: abre la lista de esas invitaciones. */
export function InviteCounts({ stats, to }) {
  const go = useGo();
  if (!stats) return <p className="m-invite__counts is-empty" aria-hidden="true">&nbsp;</p>;
  if (!stats.sent) return <p className="m-invite__counts is-empty">Aún no ha enviado ninguna.</p>;
  return (
    <button type="button" className="m-invite__counts" onClick={() => go(to)}>
      <span><b>{stats.sent}</b> {stats.sent === 1 ? 'enviada' : 'enviadas'}, <b>{stats.used || 0}</b> se {stats.used === 1 ? 'registró' : 'registraron'}, <b>{stats.open || 0}</b> sin usar</span>
      <ChevronRight size={18} aria-hidden="true" />
    </button>
  );
}

/** Durante un minuto tras enviar: «Lista en WhatsApp a las 3:42 p. m.» con la marca que sube. */
export function SentLine({ role, headId, typeId }) {
  const s = useSyncExternalStore(subscribeSent, getLastSent, getLastSent);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!s) return undefined;
    const t = setTimeout(() => setTick((x) => x + 1), Math.max(0, 60e3 - (Date.now() - s.at)) + 50);
    return () => clearTimeout(t);
  }, [s]);
  if (!s || s.role !== role || (typeId && s.typeId !== typeId) || (role === 'leader' && String(s.headId ?? '') !== String(headId ?? '')) || Date.now() - s.at > 60e3) return null;
  if (s.closed) return <p className="m-sent is-error" role="alert">La invitación de las {time.format(new Date(s.at))} ya no servía (se anuló). Envíe la nueva.</p>;
  return <p className="m-sent" role="status"><Mark size={20} />{s.via === 'copy' ? 'Copiada' : 'Lista en WhatsApp'} a las {time.format(new Date(s.at))}{s.label ? `, para ${s.label}` : ''}.</p>;
}

/** Etiqueta del tipo con su color (CAB, COV, LID…): así se ve de un vistazo qué se está enviando. */
function TypeTag({ type }) {
  return type ? <span className="m-invite__tag">{type.name}</span> : null;
}

/** Título del bloque: «Invitar una cabeza» / «Invitar un líder» para los tipos base; «Invitar COV» para los demás. */
const inviteTitle = (type, role) => {
  if (!type || type.name === (role === 'head' ? 'Cabeza' : 'Líder')) return role === 'head' ? 'Invitar una cabeza' : 'Invitar un líder';
  return `Invitar ${type.name}`;
};

/**
 * Bloque «Invitar una cabeza» (sólo el administrador general): nombre opcional y un toque a WhatsApp.
 * type: un tipo de cabeza concreto (en Invitar hay un bloque por tipo, con su color); sin él, el tipo base.
 */
export function InviteHeadBlock({ hero = true, compact, type: fixedType, id = 'invitar-cabeza' }) {
  const { base: baseType } = useRoleTypes('head');
  const base = fixedType || baseType;
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  // Android (Chrome): «Contacto» abre la agenda; con el celular elegido, WhatsApp abre directo su chat.
  const canPick = typeof navigator !== 'undefined' && !!navigator.contacts?.select;
  const pickContact = async () => {
    try {
      const [c] = await navigator.contacts.select(['name', 'tel'], { multiple: false });
      if (!c) return;
      if (c.name?.[0]) setName(c.name[0].slice(0, 60));
      setPhone(c.tel?.[0] || '');
    } catch { /* cancelado */ }
  };
  const makeText = useCallback(({ url, name: n }) => inviteText({ role: 'head', name: n, url }), []);
  const invite = useOneTimeInvite({ typeId: base?.id, role: 'head', makeText, enabled: !!base });
  const label = name.trim() || undefined;
  const sendLabel = label ? `Enviar a ${label.split(/\s+/)[0]} por WhatsApp` : 'Enviar por WhatsApp';
  return (
    <section className={`m-invite ${hero ? 'm-invite--hero' : ''} ${fixedType ? 'm-invite--type' : ''}`} id={id} aria-labelledby={`${id}-title`}
      style={fixedType ? typeVars(base.color) : undefined}>
      <Mark className="m-invite__mark" />
      {fixedType && <TypeTag type={base} />}
      <h2 className="m-invite__title" id={`${id}-title`}>{inviteTitle(base, 'head')}</h2>
      <p className="m-invite__desc">Tendrá su propio equipo de líderes y personas.</p>
      {!compact && (
        <div className="field">
          <label htmlFor={`${id}-name`}>¿Para quién? <span style={{ fontWeight: 400, opacity: 0.8 }}>(opcional)</span></label>
          <div className="m-name-row">
            <input id={`${id}-name`} className="input" value={name} maxLength={60} enterKeyHint="send" autoComplete="off"
              placeholder="Nombre de la persona" onChange={(e) => { setName(e.target.value); setPhone(''); }} />
            {canPick && <button type="button" className="btn m-contact-btn" onClick={pickContact}><UserRound size={17} />Contacto</button>}
          </div>
        </div>
      )}
      <InviteButton invite={invite} label={label} phone={phone || undefined}>{sendLabel}</InviteButton>
      <InviteAlt invite={invite} label={label} />
      <SentLine role="head" typeId={fixedType ? base.id : undefined} />
      <InviteCounts stats={invite.stats} to={`/enlaces?estado=sin-usar&tipo=${base?.id || ''}`} />
    </section>
  );
}

/** Elegir con qué cabeza queda el líder invitado: fichas con las más usadas y «Ver todas» en una hoja con búsqueda. */
function HeadChips({ heads, value, onChange }) {
  const teams = useTeams();
  const [all, setAll] = useState(false);
  const top = useMemo(() => {
    const sorted = [...heads].sort((a, b) => (b.people || 0) - (a.people || 0));
    const chosen = sorted.find((h) => String(h.id) === String(value));
    const rest = sorted.filter((h) => h !== chosen);
    return chosen ? [chosen, ...rest].slice(0, 6) : rest.slice(0, 6);
  }, [heads, value]);
  return (
    <>
      <Chips label="Cabeza con la que quedará">
        {top.map((h) => (
          <Chip key={h.id} active={String(h.id) === String(value)} onClick={() => onChange(h.id)}>
            <TeamAvatar head={h} size={24} />{teams.short(h)}
          </Chip>
        ))}
        {heads.length > 6 && <Chip onClick={() => setAll(true)}>Ver todas ({heads.length})</Chip>}
      </Chips>
      {all && <HeadPickerSheet heads={heads} value={value} onPick={(id) => { onChange(id); }} onClose={() => setAll(false)} />}
    </>
  );
}

/** Hoja para elegir una cabeza entre todas (con búsqueda). */
export function HeadPickerSheet({ heads, value, onPick, onClose, title = '¿Con qué cabeza quedará?' }) {
  const [q, setQ] = useState('');
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const list = heads.filter((h) => !q || norm(teamName(h)).includes(norm(q)) || norm(h.name).includes(norm(q)));
  return (
    <Sheet title={title} onClose={onClose} size="large">
      {({ close }) => (
        <>
          <input className="input" type="search" placeholder="Buscar cabeza" aria-label="Buscar cabeza" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
          <div className="card list-card m-group">
            {list.map((h) => (
              <button key={h.id} type="button" className="m-row" aria-pressed={String(h.id) === String(value)} onClick={() => { onPick(h.id); close(); }}>
                <span className="m-row__lead"><TeamAvatar head={h} size={40} /></span>
                <span className="m-row__main">
                  <span className="m-row__title">{teamName(h)}</span>
                  <span className="m-row__meta">{h.cabeza_name ? '' : 'Sin cabeza asignada, '}{h.people ?? 0} {h.people === 1 ? 'persona' : 'personas'}</span>
                </span>
                {String(h.id) === String(value) && <span className="m-row__trail" aria-hidden="true">✓</span>}
              </button>
            ))}
            {!list.length && <p className="m-hint">Ninguna cabeza coincide.</p>}
          </div>
        </>
      )}
    </Sheet>
  );
}

/**
 * Bloque «Invitar un líder». Con una sola cabeza posible no pregunta; con varias, fichas para elegir.
 * fixedHead: en la pantalla de una cabeza, la invitación ya es para ella.
 */
export function InviteLeaderBlock({ fixedHead, hero = false, type: fixedType, id = 'invitar-lider' }) {
  const teams = useTeams();
  const roleTypes = useRoleTypes('leader');
  const base = fixedType || roleTypes.base;
  const leaderTypes = fixedType ? [fixedType] : roleTypes.list;
  const heads = teams.manageable;
  const remembered = (() => { try { return localStorage.getItem(`gl:${base?.id}:head`) || ''; } catch { return ''; } })();
  const [headId, setHeadId] = useState(fixedHead?.id || '');
  const [typeId, setTypeId] = useState(null);
  const type = leaderTypes.find((t) => t.id === typeId) || base;
  const only = heads.length === 1 ? heads[0] : null;
  const chosenId = fixedHead?.id || headId || (heads.some((h) => String(h.id) === remembered) ? remembered : '') || only?.id || '';
  const head = fixedHead || heads.find((h) => String(h.id) === String(chosenId)) || null;
  const cabeza = head?.cabeza_name || null;
  const makeText = useCallback(({ url, name }) => inviteText({ role: 'leader', name, cabeza, url }), [cabeza]);
  const invite = useOneTimeInvite({ typeId: type?.id, headId: head?.id, role: 'leader', cabeza, makeText, enabled: !!type && !!head });
  const pick = (id) => { setHeadId(id); try { localStorage.setItem(`gl:${base?.id}:head`, String(id)); } catch { /* */ } };
  return (
    <section className={`m-invite ${hero ? 'm-invite--hero' : ''} ${fixedType ? 'm-invite--type' : ''}`} id={id} aria-labelledby={`${id}-title`} style={typeVars(type?.color)}>
      {fixedType && <TypeTag type={type} />}
      <h2 className="m-invite__title" id={`${id}-title`}>{inviteTitle(type, 'leader')}</h2>
      <p className="m-invite__desc">{head ? (cabeza ? `Quedará en el equipo de ${cabeza}.` : `Quedará en ${head.name}.`) : 'Cada líder suma a su propia gente.'}</p>
      {!fixedHead && heads.length > 1 && (
        <div className="stack" style={{ gap: 8 }}>
          <span className="m-invite__desc" style={{ margin: 0, fontWeight: 600 }}>¿Con qué cabeza quedará?</span>
          <HeadChips heads={heads} value={chosenId} onChange={pick} />
        </div>
      )}
      {leaderTypes.length > 1 && (
        <Chips label="Tipo de líder" className="m-type-chips">
          {leaderTypes.map((t) => <Chip key={t.id} active={t.id === type?.id} onClick={() => setTypeId(t.id)}>{t.name}</Chip>)}
        </Chips>
      )}
      {head ? (
        <>
          <InviteButton invite={invite}>Enviar por WhatsApp</InviteButton>
          <InviteAlt invite={invite} />
          <SentLine role="leader" headId={head.id} typeId={fixedType ? type.id : undefined} />
          <InviteCounts stats={invite.stats} to={`/enlaces?estado=sin-usar&tipo=${type?.id || ''}&cabeza=${head.id}`} />
        </>
      ) : <p className="m-note" style={{ margin: 0 }}>{heads.length ? 'Elija la cabeza con la que quedará.' : 'Aún no hay cabezas activas que usted administre.'}</p>}
    </section>
  );
}

/**
 * Enlace para personas (reutilizable): uno solo para compartir con todos. Se recuerda la última elección
 * (cabeza y de quién cuelgan) en este dispositivo.
 */
export function PersonLinkBlock({ type: fixedType, id = 'invitar-personas' }) {
  const teams = useTeams();
  const toast = useToast();
  const roleTypes = useRoleTypes('person');
  const types = fixedType ? { list: [fixedType], base: fixedType } : roleTypes;
  const heads = teams.manageable;
  const base = types.base;
  const recall = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const [typeId, setTypeId] = useState(null);
  const type = types.list.find((t) => t.id === typeId) || base;
  const [headId, setHeadId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [picking, setPicking] = useState(false);
  const hId = headId || recall(`gl:${type?.id}:head`) || (heads.length === 1 ? String(heads[0].id) : '');
  const head = heads.find((h) => String(h.id) === String(hId)) || null;
  const oId = ownerId || recall(`gl:${type?.id}:owner`) || (head?.cabeza_id ? String(head.cabeza_id) : '');
  const [owner, setOwner] = useState(null);
  useEffect(() => {
    if (!oId || !head) { setOwner(null); return undefined; }
    let alive = true;
    api.get(`/leaders${qs({ head_id: head.id })}`).then((ls) => alive && setOwner(ls.find((l) => String(l.id) === String(oId)) || null)).catch(() => alive && setOwner(null));
    return () => { alive = false; };
  }, [oId, head]);
  const link = useGeneralLink({ typeId: type?.id, headId: head?.id, ownerId: owner?.id });
  const message = link.url ? inviteMessage({ url: link.url, ownerName: owner?.full_name }) : '';
  const save = (h, o) => {
    setHeadId(String(h)); setOwnerId(String(o));
    try { localStorage.setItem(`gl:${type?.id}:head`, String(h)); localStorage.setItem(`gl:${type?.id}:owner`, String(o)); } catch { /* */ }
  };
  const ready = !!link.url;
  return (
    <section className={`m-invite ${fixedType ? 'm-invite--type' : ''}`} id={id} aria-labelledby={`${id}-title`} style={typeVars(type?.color)}>
      {fixedType && <TypeTag type={type} />}
      <h2 className="m-invite__title" id={`${id}-title`}>{!fixedType || type.name === 'Persona' ? 'Enlace para personas' : `Enlace ${type.name}`}</h2>
      <p className="m-invite__desc">Uno solo para compartir con todos. Quienes se registren quedan con quien usted elija.</p>
      <div className="m-pick">
        <span className="m-pick__text">
          {head && owner ? <><b>{head.cabeza_name ? `Equipo de ${teams.short(head)}` : head.name}</b>, cuelgan de <b>{owner.full_name}</b></> : 'Elija el equipo y de quién cuelgan.'}
        </span>
        <button type="button" className="btn btn-sm" onClick={() => setPicking(true)}>{head && owner ? 'Cambiar' : 'Elegir'}</button>
      </div>
      {ready && (
        <>
          <div className="row-wrap" style={{ gap: 8 }}>
            <a className="btn btn-wa" style={{ flex: '1 1 140px', minHeight: 46 }} href={waUrl(message)} {...extLinkProps()}><WhatsAppIcon size={18} />WhatsApp</a>
            <button type="button" className="btn" style={{ flex: '1 1 100px', minHeight: 46 }} onClick={() => copyNow(link.url).then((ok) => toast(ok ? 'Enlace copiado.' : 'No se pudo copiar.', ok ? 'ok' : 'error'))}>
              <Copy size={16} />Copiar
            </button>
            {typeof navigator !== 'undefined' && navigator.share && (
              <button type="button" className="btn" style={{ flex: '1 1 100px', minHeight: 46 }} onClick={() => navigator.share({ text: message }).catch(() => {})}><ShareIcon />Compartir</button>
            )}
          </div>
          <p className="m-note" style={{ margin: 0 }}>{link.link?.uses ? `${link.link.uses} ${link.link.uses === 1 ? 'persona se registró' : 'personas se registraron'} con este enlace.` : 'Aún nadie se ha registrado con este enlace.'}</p>
        </>
      )}
      {link.loading && <p className="m-note" style={{ margin: 0 }}>Preparando enlace…</p>}
      {link.error && <p className="m-note" style={{ margin: 0, color: 'var(--critical-text)' }}>{link.error.message}</p>}
      {picking && <PersonLinkSheet heads={heads} types={types.list} type={type} head={head} ownerId={owner?.id}
        onType={setTypeId} onDone={(h, o) => save(h, o)} onClose={() => setPicking(false)} />}
    </section>
  );
}

/** Pasos del enlace de personas: equipo y de quién cuelgan (la cabeza primero), y el tipo si hay varios. */
function PersonLinkSheet({ heads, types, type, head, ownerId, onType, onDone, onClose }) {
  const teams = useTeams();
  const [h, setH] = useState(head?.id || (heads.length === 1 ? heads[0].id : ''));
  const [leaders, setLeaders] = useState(null);
  useEffect(() => {
    if (!h) { setLeaders(null); return undefined; }
    let alive = true;
    setLeaders(null);
    api.get(`/leaders${qs({ head_id: h })}`).then((ls) => alive && setLeaders(ls.filter((l) => l.status === 'active'))).catch(() => alive && setLeaders([]));
    return () => { alive = false; };
  }, [h]);
  const hh = heads.find((x) => String(x.id) === String(h));
  const ordered = leaders ? [...leaders].sort((a, b) => (b.is_head ? 1 : 0) - (a.is_head ? 1 : 0)) : null;
  return (
    <Sheet title="Enlace para personas" subtitle="¿De qué equipo son y de quién cuelgan?" onClose={onClose} size="large">
      {({ close }) => (
        <div className="stack">
          {types.length > 1 && (
            <Chips label="Tipo de registro" className="m-type-chips">
              {types.map((t) => <Chip key={t.id} active={t.id === type?.id} onClick={() => onType(t.id)}>{t.name}</Chip>)}
            </Chips>
          )}
          {heads.length > 1 && (
            <Chips label="Equipo">
              {heads.map((x) => <Chip key={x.id} active={String(x.id) === String(h)} onClick={() => setH(x.id)}><TeamAvatar head={x} size={24} />{teams.short(x)}</Chip>)}
            </Chips>
          )}
          {h && !ordered && <p className="m-hint">Cargando…</p>}
          {ordered && (
            <div className="card list-card m-group" role="list" aria-label="De quién cuelgan">
              {ordered.map((l) => (
                <button key={l.id} type="button" className="m-row" role="listitem" aria-pressed={String(l.id) === String(ownerId)}
                  onClick={() => { onDone(h, l.id); close(); }}>
                  <span className="m-row__lead"><PersonAvatar name={l.full_name} leader head={l.is_head} /></span>
                  <span className="m-row__main">
                    <span className="m-row__title">{l.is_head ? `Directo con ${l.full_name}` : l.full_name}</span>
                    <span className="m-row__meta">{l.is_head ? 'La cabeza del equipo' : 'Líder'}{hh && !l.is_head ? `, equipo de ${teams.short(hh)}` : ''}</span>
                  </span>
                  {String(l.id) === String(ownerId) && <span className="m-row__trail" aria-hidden="true">✓</span>}
                </button>
              ))}
              {!ordered.length && <p className="m-hint"><UserRound size={16} /> Este equipo aún no tiene líderes activos.</p>}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

/** ¿Es el administrador general? (sólo él invita cabezas). */
export const useCanInviteHeads = () => useAuth().isSuper;

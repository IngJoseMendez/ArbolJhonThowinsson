import { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Ban, Check, CheckCircle2, Copy, Crown, GitBranch, History, KeyRound, Link2, MapPin, MoreHorizontal, MoreVertical, MoveRight,
  Pencil, Phone, Power, RefreshCw, UserCheck, UserPlus, Users, XCircle, ImageOff,
} from 'lucide-react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import PhotoCircle from '../../components/PhotoCircle.jsx';
import { CAMPAIGN, Mark } from '../../brand/Brand.jsx';
import { useCached, invalidate } from '../../lib/cache.js';
import { haptic, osName } from '../../lib/device.js';
import { fmtDate, fmtDateTime, inviteUrl, phoneDisplay, relTime } from '../../lib/format.js';
import { useGo } from '../../lib/nav.js';
import { useRegTypes } from '../../lib/regTypes.js';
import { formatCedula } from '../../lib/validators.js';
import { copyNow, useOneTimeInvite } from '../../lib/invites.js';
import { extLinkProps, inviteText, ownLinkText, panelText, waUrl, normalizePhone57 } from '../../lib/whatsapp.js';
import Screen, { BarButton } from '../../components/m/Screen.jsx';
import Sheet, { ActionSheet } from '../../components/m/Sheet.jsx';
import { Group, Row, Section } from '../../components/m/List.jsx';
import { PersonAvatar } from '../../components/m/Spark.jsx';
import { ConfirmModal, ErrorBox, JohnLink, LocationText, RoleBadge, StatusBadge, inviteMessage, useToast, WhatsAppIcon } from '../../components/ui.jsx';
import { useRoleTypes } from '../../components/invite/InviteBlocks.jsx';
import RegisterPersonModal from '../../components/RegisterPersonModal.jsx';
import { ReasonSheet } from '../../components/invite/LinkRows.jsx';
import {
  HISTORY, SUPPORTS, HistoryDetail, EditModal, LocationModal, MoveModal, LeaderModal, AccountModal,
} from '../../components/person/PersonModals.jsx';
import { panelUrl } from '../../components/PanelLinkBox.jsx';

const nf = new Intl.NumberFormat('es');

/** Dato en una fila: etiqueta a la izquierda, valor a la derecha (y una acción opcional). */
function Kv({ label, children, action }) {
  return <div className="m-kv"><dt>{label}</dt><dd><span className="selectable">{children}</span>{action}</dd></div>;
}

/** Un círculo de acción rápida bajo el nombre (WhatsApp, llamar, enlace, árbol). */
function Quick({ icon: Icon, label, href, onClick, wa, disabled, linkProps }) {
  const inner = <><span>{Icon === 'wa' ? <WhatsAppIcon size={22} /> : <Icon size={22} />}</span>{label}</>;
  if (href && !disabled) return <a className={`m-quick__btn ${wa ? 'is-wa' : ''}`} href={href} {...(linkProps || {})} onClick={onClick}>{inner}</a>;
  return <button type="button" className={`m-quick__btn ${wa ? 'is-wa' : ''}`} onClick={onClick} aria-disabled={disabled ? 'true' : undefined}>{inner}</button>;
}

/** «Invitar líder» en la ficha de una cabeza: la invitación de su equipo, lista. */
function HeadInviteQuick({ p }) {
  const leader = useRoleTypes('leader').base;
  const makeText = useCallback(({ url, name }) => inviteText({ role: 'leader', name, cabeza: p.full_name, url }), [p.full_name]);
  const invite = useOneTimeInvite({ typeId: leader?.id, headId: p.head_id, role: 'leader', cabeza: p.full_name, makeText, enabled: !!leader && p.status === 'active' });
  return <Quick icon={UserPlus} label="Invitar líder" wa href={invite.ready ? waUrl(invite.text()) : undefined} disabled={!invite.ready}
    linkProps={extLinkProps()} onClick={() => invite.ready && invite.onSend()} />;
}

export default function Person() {
  const { id } = useParams();
  const go = useGo();
  const toast = useToast();
  const a = useAuth();
  const types = useRegTypes();
  const { data, error, loading, reload } = useCached(`person:${id}`, () => api.get(`/people/${id}`), { ttl: 15000 });
  const [modal, setModal] = useState(null);
  const [panelToken, setPanelToken] = useState(null);
  const More = osName() === 'android' ? MoreVertical : MoreHorizontal;

  if (error) return <Screen title="Persona" back="/personas" noHero><ErrorBox error={error} /></Screen>;
  if (loading && !data) return <Screen title="" back="/personas" heroTitle={(ref) => <span ref={ref} className="skeleton m-sk-title" />} />;
  const { person: p, head, leader, inviter, invitees, stats, history, links, permissions: perm, names, location } = data;
  const done = (msg) => {
    if (msg) toast(msg);
    reload(); invalidate('dash'); invalidate('heads'); invalidate('counts:'); invalidate('pending:'); invalidate(`head:${p.head_id}`);
  };
  const act = (url, body, msg) => async (reason) => { await api.post(url, { ...body, reason }); haptic('success'); done(msg); };
  const activeLink = links.find((l) => l.status === 'active');
  const canCall = perm.contact && p.phone && !p.phone.includes('*') && normalizePhone57(p.phone);
  const team = head.cabeza ? `Equipo de ${head.cabeza.full_name}` : head.name;
  const type = types.byId[p.reg_type_id];
  const first = p.full_name.split(' ')[0];
  const canRegen = (perm.manage || perm.self) && p.status === 'active' && (p.is_leader || head.person_invites_enabled);

  const header = (ref) => (
    <div className="m-detail">
      <div className="m-detail__top">
        {/* Persona de confianza: la coordinación puede poner o cambiar su foto tocando el círculo. */}
        {p.is_leader && perm.manage && a.photos ? (
          <PhotoCircle photo={p.photo_url} name={p.full_name} size={56} tone={p.is_head ? 'gold' : 'sky'} self={false} label="Poner foto"
            onUpload={async (image) => { const r = await api.post(`/people/${p.id}/photo`, { image }); haptic('success'); done('Foto guardada.'); return r.photo_url; }}
            onError={(e) => toast(e.message, 'error')} />
        ) : <PersonAvatar name={p.full_name} leader={p.is_leader} head={p.is_head} size={56} photo={p.photo_url} />}
        <div className="m-detail__chips">
          <RoleBadge isLeader={p.is_leader} isHead={p.is_head} />
          {p.status !== 'active' && <StatusBadge status={p.status} />}
          {type && !type.builtin && <span className="badge badge-muted">{type.name}</span>}
        </div>
      </div>
      <h1 ref={ref} className="m-detail__name">{p.full_name}</h1>
      <p className="m-detail__line">{p.is_head ? `Cabeza de ${CAMPAIGN}` : team}</p>
      <div className="m-quick">
        <Quick icon="wa" label="WhatsApp" wa href={canCall ? waUrl('', p.phone) : undefined} disabled={!canCall} linkProps={extLinkProps()} />
        <Quick icon={Phone} label="Llamar" href={canCall ? `tel:+${normalizePhone57(p.phone)}` : undefined} disabled={!canCall} />
        {p.is_head && perm.manage ? <HeadInviteQuick p={p} /> : <Quick icon={Link2} label="Su enlace" onClick={() => setModal('link')} disabled={!activeLink && !canRegen} />}
        <Quick icon={GitBranch} label="Árbol" onClick={() => go(`/cabezas/${p.head_id}?tab=arbol&persona=${p.id}`)} />
      </div>
    </div>
  );

  return (
    <Screen title={p.full_name} back="/personas" heroTitle={header}
      actions={(perm.manage || canRegen) && <BarButton icon={More} label="Acciones" onClick={() => setModal('actions')} />}>
      {p.status === 'pending' && perm.manage && (
        <div className="m-band">
          <p>Este registro espera su aprobación.</p>
          <button type="button" className="btn" onClick={() => setModal('reject')}><XCircle size={16} />Rechazar</button>
          <button type="button" className="btn btn-primary" onClick={async () => {
            try { await api.post(`/people/${p.id}/status`, { status: 'active' }); haptic('success'); done(`Registro de ${first} aprobado.`); } catch (e) { toast(e.message, 'error'); }
          }}><CheckCircle2 size={16} />Aprobar</button>
        </div>
      )}

      {(stats.total > 0 || invitees.length > 0) && (
        <Section title="Su red">
          <p className="m-note" style={{ margin: '0 4px 10px' }}>
            {nf.format(stats.total)} en su rama, invitó a {nf.format(invitees.length)}{stats.max_depth ? `, ${stats.max_depth} ${stats.max_depth === 1 ? 'nivel' : 'niveles'}` : ''}
          </p>
          <Group>
            {invitees.slice(-3).reverse().map((i) => (
              <Row key={i.id} lead={<PersonAvatar name={i.full_name} leader={i.is_leader} photo={i.photo_url} />} title={i.full_name} to={`/personas/${i.id}`}
                meta={i.status !== 'active' ? <StatusBadge status={i.status} /> : i.descendant_count ? `${nf.format(i.descendant_count)} en su rama` : null}
                trail={<small>{relTime(i.created_at)}</small>} chevron={false} />
            ))}
            {invitees.length > 3 && <Row lead={<span className="m-today-icon"><Users size={18} /></span>} title={`Ver las ${nf.format(invitees.length)} personas que invitó`} onClick={() => go(`/personas?inviter_id=${p.id}`, { tab: 'personas' })} chevron />}
            {p.is_leader && stats.assigned > 0 && <Row lead={<span className="m-today-icon"><UserCheck size={18} /></span>} title={`A su cargo: ${nf.format(stats.assigned)} ${stats.assigned === 1 ? 'persona' : 'personas'}`} onClick={() => go(`/personas?leader_id=${p.id}`, { tab: 'personas' })} chevron />}
          </Group>
        </Section>
      )}

      <Section title="En la red">
        <dl className="card list-card m-group" style={{ margin: 0 }}>
          <Kv label="Cabeza" action={!p.is_head && head.cabeza ? <button type="button" className="m-link-btn" onClick={() => go(`/cabezas/${head.id}`)}>Ver</button> : null}>
            {p.is_head ? 'Encabeza su equipo' : head.is_direct ? 'Ninguna: directo con John' : head.cabeza ? head.cabeza.full_name : `${head.name} (sin cabeza)`}
          </Kv>
          <Kv label="Llegó con" action={inviter
            ? <button type="button" className="m-link-btn" onClick={() => go(`/personas/${inviter.id}`)}>Ver</button>
            : p.is_head || p.is_direct ? <button type="button" className="m-link-btn" onClick={() => go(`/arbol?persona=${p.id}`)}>Ver</button> : null}>
            {inviter ? inviter.full_name : p.is_head || p.is_direct ? <JohnLink plain /> : 'Directo con la estructura'}
          </Kv>
          {!p.is_head && <Kv label="Líder a cargo" action={leader && leader.id !== inviter?.id ? <button type="button" className="m-link-btn" onClick={() => go(`/personas/${leader.id}`)}>Ver</button> : null}>
            {leader ? leader.full_name : 'Sin líder por encima'}
          </Kv>}
          <Kv label="Registro">{fmtDate(p.created_at)}, {p.registration_method === 'manual' ? `a mano${data.registered_by ? ` por ${data.registered_by.display_name}` : ''}` : 'con enlace'}</Kv>
        </dl>
      </Section>

      <Section title="Datos">
        <dl className="card list-card m-group" style={{ margin: 0 }}>
          <Kv label="Celular" action={canCall ? <button type="button" className="m-icon-btn" aria-label="Copiar celular" onClick={() => copyNow(p.phone).then((ok) => ok && toast('Celular copiado.'))}><Copy size={17} /></button> : null}>
            {phoneDisplay(p.phone)}
          </Kv>
          {perm.contact && <Kv label="Cédula">{p.document_id ? formatCedula(p.document_id) : 'Sin registrar'}</Kv>}
          {perm.contact && p.address && <Kv label="Dirección">{p.address}</Kv>}
          {perm.contact && p.email && <Kv label="Correo">{p.email}</Kv>}
          <Kv label="Ubicación" action={perm.manage ? <button type="button" className="m-link-btn" onClick={() => setModal('location')}>{location?.status === 'pending' ? 'Verificar' : 'Corregir'}</button> : null}>
            <LocationText loc={location} compact />
          </Kv>
          <Kv label="¿Es voto seguro?">{p.secure_vote ? SUPPORTS[p.secure_vote] : 'Sin valorar'}</Kv>
          <Kv label="¿Contamos contigo?">{p.supports ? SUPPORTS[p.supports] : 'Sin respuesta'}</Kv>
          {perm.manage && p.notes && <Kv label="Observaciones">{p.notes}</Kv>}
        </dl>
        {!perm.contact && <p className="m-note">Algunos datos se ocultan según sus permisos.</p>}
      </Section>

      {p.is_leader && perm.manage && (
        <Section title="Panel de gestión">
          <div className="card list-card m-group m-panel-card">
            <p>{p.panel_active ? `Activo${p.panel_viewed_at ? `, abierto ${relTime(p.panel_viewed_at)}` : ', aún no lo ha abierto'}.` : 'Sin panel todavía.'}</p>
            <button type="button" className="m-wa" onClick={() => setModal('panel')}><WhatsAppIcon size={19} />{p.panel_active ? 'Enviarle un panel nuevo' : 'Enviar su panel por WhatsApp'}</button>
          </div>
        </Section>
      )}

      {history.length > 0 && (
        <Section>
          <Group><Row lead={<span className="m-today-icon"><History size={18} /></span>} title={`Historial (${history.length})`} onClick={() => setModal('history')} chevron /></Group>
        </Section>
      )}

      {/* ---- Hojas ---- */}
      {modal === 'actions' && (
        <ActionSheet title={p.full_name} onClose={() => setModal((m) => (m === 'actions' ? null : m))} groups={[
          [
            { label: 'Editar datos', icon: Pencil, hidden: !perm.manage, onSelect: () => setModal('edit') },
            { label: 'Corregir ubicación', icon: MapPin, hidden: !perm.manage, onSelect: () => setModal('location') },
            { label: `Registrar a alguien invitado por ${first}`, icon: UserPlus, hidden: !perm.manage || p.status !== 'active', onSelect: () => setModal('register') },
          ],
          [
            { label: 'Designar como líder', icon: Crown, hidden: !perm.manage || p.status !== 'active' || p.is_leader, onSelect: () => setModal('promote') },
            { label: 'Retirar liderazgo', icon: Crown, hidden: !perm.manage || !p.is_leader || p.is_head, onSelect: () => setModal('demote') },
            { label: 'Cambiar líder a cargo', icon: UserCheck, hidden: !perm.manage || p.is_head, onSelect: () => setModal('leader') },
            { label: 'Mover con su rama', icon: MoveRight, hidden: !perm.manage || p.is_head || p.status === 'rejected', onSelect: () => setModal('move') },
            { label: 'Designar como cabeza', icon: Mark, hidden: !(perm.super && p.is_leader && !p.is_head && !inviter && !head.cabeza && !head.is_direct && p.status === 'active'), onSelect: () => setModal('make-head') },
            { label: 'Quitar como cabeza', icon: Mark, hidden: !(perm.super && p.is_head), onSelect: () => setModal('unmake-head') },
          ],
          [
            { label: activeLink ? 'Regenerar su enlace' : 'Generar su enlace', icon: RefreshCw, hidden: !canRegen, onSelect: () => setModal('regen') },
            { label: 'Crear acceso a la plataforma', icon: KeyRound, hidden: !perm.manage || !!data.account || p.status !== 'active', onSelect: () => setModal('account') },
            { label: 'Quitar su foto', icon: ImageOff, hidden: !perm.manage || !p.photo_url, onSelect: () => setModal('photo-remove') },
            { label: 'Aprobar registro', icon: Check, hidden: !perm.manage || p.status !== 'pending', onSelect: () => setModal('approve') },
          ],
          [
            { label: 'Desactivar', icon: Power, danger: true, hidden: !perm.manage || p.status !== 'active', onSelect: () => setModal('deactivate') },
            { label: 'Reactivar', icon: Power, hidden: !perm.manage || p.status !== 'inactive', onSelect: () => setModal('reactivate') },
            { label: 'Rechazar registro', icon: Ban, danger: true, hidden: !perm.manage || p.status !== 'pending', onSelect: () => setModal('reject') },
          ],
        ]} />
      )}
      {modal === 'link' && (
        <Sheet title={`Enlace de ${first}`} subtitle={activeLink ? `${nf.format(activeLink.uses)} ${activeLink.uses === 1 ? 'persona se registró' : 'personas se registraron'} con él.` : 'Aún no tiene enlace activo.'}
          onClose={() => setModal(null)}>
          {activeLink ? (
            <div className="stack">
              {canCall && <a className="m-wa" href={waUrl(ownLinkText({ name: p.full_name, url: inviteUrl(activeLink.token) }), p.phone)} {...extLinkProps()}><WhatsAppIcon size={19} />Enviárselo a {first}</a>}
              <a className="btn btn-wa" style={{ minHeight: 48 }} href={waUrl(inviteMessage({ url: inviteUrl(activeLink.token), ownerName: p.full_name }))} {...extLinkProps()}><WhatsAppIcon size={17} />Compartirlo con alguien más</a>
              <button type="button" className="btn" style={{ minHeight: 48 }} onClick={() => copyNow(inviteUrl(activeLink.token)).then((ok) => toast(ok ? 'Enlace copiado.' : 'No se pudo copiar.', ok ? 'ok' : 'error'))}><Copy size={16} />Copiar enlace</button>
              <p className="m-note">Quien se registre con él quedará con {first} como quien le invitó.</p>
            </div>
          ) : canRegen ? <button type="button" className="btn btn-primary" onClick={() => setModal('regen')}>Generar su enlace</button> : <p className="m-note">{p.status !== 'active' ? 'Disponible cuando la persona esté activa.' : 'Las invitaciones personales están apagadas en esta cabeza.'}</p>}
        </Sheet>
      )}
      {modal === 'history' && (
        <Sheet title="Historial" onClose={() => setModal(null)} size="large">
          <ul className="timeline">
            {history.map((h) => (
              <li key={h.id}>
                <div style={{ fontWeight: 600 }}>{HISTORY[h.change_type] || h.change_type}</div>
                <div className="small text-2"><HistoryDetail h={h} names={names} /></div>
                {h.reason && <div className="small">Motivo: <i>{h.reason}</i></div>}
                <div className="small muted">{fmtDateTime(h.created_at)}{h.changed_by_name ? `, ${h.changed_by_name}` : ''}</div>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
      {modal === 'panel' && <ConfirmModal title={p.panel_active ? `¿Enviar un panel nuevo a ${first}?` : `Panel de ${first}`} confirmLabel="Generar panel"
        message={p.panel_active ? 'El enlace anterior de su panel dejará de funcionar.' : 'Es privado y de solo lectura: ve su red sin usuario ni contraseña. Se abre con los últimos 4 dígitos de su cédula.'}
        onConfirm={async () => { const r = await api.post(`/people/${p.id}/panel`); setPanelToken(r.token); reload(); }} onClose={() => setModal(null)} />}
      {panelToken && (
        <Sheet title="Panel listo" subtitle="Envíeselo ahora: por seguridad no se vuelve a mostrar." onClose={() => setPanelToken(null)}>
          <div className="stack">
            <a className="m-wa" href={waUrl(panelText({ name: p.full_name, url: panelUrl(panelToken) }), canCall ? p.phone : undefined)} {...extLinkProps()}>
              <WhatsAppIcon size={19} />{canCall ? `Enviar a ${first} por WhatsApp` : 'Enviar por WhatsApp'}
            </a>
            <button type="button" className="btn" style={{ minHeight: 48 }} onClick={() => copyNow(panelUrl(panelToken)).then((ok) => toast(ok ? 'Enlace del panel copiado.' : 'No se pudo copiar.', ok ? 'ok' : 'error'))}><Copy size={16} />Copiar enlace</button>
          </div>
        </Sheet>
      )}
      {modal === 'edit' && <EditModal p={p} types={types.list} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'location' && <LocationModal p={p} location={location} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'move' && <MoveModal p={p} head={head} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'leader' && <LeaderModal p={p} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'account' && <AccountModal p={p} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'register' && <RegisterPersonModal defaultHeadId={p.head_id} onClose={() => setModal(null)} onCreated={() => done('Invitado registrado.')}
        defaultInviter={{ id: p.id, full_name: p.full_name, head_id: p.head_id, is_leader: p.is_leader, code: p.code, leader_code: p.leader_code, leader_name: leader?.full_name, status: p.status }} />}
      {modal === 'photo-remove' && <ConfirmModal title="Quitar la foto" message={`Se quitará la foto de ${first}. Se puede poner otra cuando se quiera.`} confirmLabel="Quitar foto"
        onConfirm={async () => { await api.post(`/people/${p.id}/photo/remove`); done('Foto quitada.'); }} onClose={() => setModal(null)} />}
      {modal === 'promote' && <ConfirmModal title="Designar como líder" reason confirmLabel="Designar líder"
        message="Recibirá su código, su enlace de líder y su panel. Las personas de su rama con líder automático pasarán a tenerle como responsable."
        onConfirm={act(`/people/${p.id}/promote`, {}, 'Designado como líder.')} onClose={() => setModal(null)} />}
      {modal === 'demote' && <ReasonSheet title="Retirar liderazgo" confirmLabel="Retirar liderazgo"
        message="Su enlace de líder se desactivará y sus personas pasarán al líder superior más cercano."
        reasons={['Ya no participa', 'Lo pidió', 'Otro motivo']} onConfirm={act(`/people/${p.id}/demote`, {}, 'Liderazgo retirado.')} onClose={() => setModal(null)} />}
      {modal === 'make-head' && <ConfirmModal title={`Designar a ${first} como cabeza`} reason confirmLabel="Designar cabeza"
        message={`Será la cabeza de ${head.name}. Los demás líderes que cuelgan de la estructura pasarán a colgar de ${first}, con sus ramas.`}
        onConfirm={async (reason) => { const r = await api.post(`/people/${p.id}/head-role`, { is_head: true, reason }); done(r.adopted ? `Ahora es la cabeza: ${r.adopted} líderes cuelgan de ella.` : 'Ahora es la cabeza de la estructura.'); }}
        onClose={() => setModal(null)} />}
      {modal === 'unmake-head' && <ReasonSheet title="Quitar como cabeza" confirmLabel="Quitar como cabeza"
        message={`${first} seguirá como líder raíz con su rama, pero ya no invitará líderes desde su panel.`}
        reasons={['Cambio de cabeza', 'Lo pidió', 'Otro motivo']}
        onConfirm={async (reason) => { await api.post(`/people/${p.id}/head-role`, { is_head: false, reason }); done('Ya no es la cabeza de la estructura.'); }} onClose={() => setModal(null)} />}
      {modal === 'deactivate' && <ReasonSheet title={`Desactivar a ${first}`} confirmLabel="Desactivar"
        message="Sus enlaces dejarán de funcionar. Las relaciones con las personas que invitó se conservan."
        reasons={['Ya no participa', 'Datos incorrectos', 'Registro duplicado', 'Otro motivo']}
        onConfirm={act(`/people/${p.id}/status`, { status: 'inactive' }, 'Persona desactivada.')} onClose={() => setModal(null)} />}
      {modal === 'reactivate' && <ConfirmModal title={`Reactivar a ${first}`} reason confirmLabel="Reactivar"
        onConfirm={act(`/people/${p.id}/status`, { status: 'active' }, 'Persona reactivada.')} onClose={() => setModal(null)} />}
      {modal === 'approve' && <ConfirmModal title={`Aprobar a ${first}`} confirmLabel="Aprobar"
        message={`Quedará activa en ${team} y recibirá su invitación personal.`}
        onConfirm={act(`/people/${p.id}/status`, { status: 'active' }, `Registro de ${first} aprobado.`)} onClose={() => setModal(null)} />}
      {modal === 'reject' && <ReasonSheet title={`Rechazar a ${first}`} confirmLabel="Rechazar registro"
        reasons={['Registro duplicado', 'Datos incorrectos', 'No es de la zona', 'Otro motivo']}
        onConfirm={act(`/people/${p.id}/status`, { status: 'rejected' }, 'Registro rechazado.')} onClose={() => setModal(null)} />}
      {modal === 'regen' && <ConfirmModal title={activeLink ? 'Regenerar su enlace' : 'Generar su enlace'} confirmLabel="Continuar"
        message={activeLink ? 'El enlace actual dejará de funcionar y se creará uno nuevo. Los registros anteriores se conservan.' : 'Se generará un enlace para compartir.'}
        onConfirm={async () => { await api.post(`/people/${p.id}/link`); done('Enlace generado.'); }} onClose={() => setModal(null)} />}
    </Screen>
  );
}

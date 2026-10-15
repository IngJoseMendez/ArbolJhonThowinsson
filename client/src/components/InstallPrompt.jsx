import { useEffect, useState } from 'react';
import { Check, Copy, Download, ExternalLink, Share, SquarePlus, X } from 'lucide-react';
import { Monogram } from '../brand/Brand.jsx';
import { copyText, useToast } from './ui.jsx';
import { useInstall, installSnoozed, snoozeInstall, wasInstalled } from '../lib/pwa.js';

/** Abre el aviso desde cualquier parte (por ejemplo, el botón «Instalar como app» del panel). */
export const openInstallPrompt = () => window.dispatchEvent(new Event('install:open'));

const isDesktop = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 960px)').matches;

/**
 * Aviso para instalar el panel como app. Aparece solo cuando el navegador lo permite, abajo en el celular y arriba a la
 * derecha en el computador, sin tapar la pantalla. «Ahora no» lo esconde unos días.
 * - Android y PC: «Instalar» abre la ventana del sistema que pide permiso y lo pone en la pantalla de inicio.
 * - iPhone y Mac: Apple no deja instalar desde la página; se muestran los dos toques.
 * - Navegador dentro de otra app: se ofrece abrirlo en Chrome o en Safari, donde sí se puede.
 */
export default function InstallPrompt({ appName = 'Mi panel', formal = false }) {
  const inst = useInstall();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState(false);
  const mode = inst.mode;

  useEffect(() => {
    if (!mode || wasInstalled() || installSnoozed()) return undefined;
    // Con el botón del sistema disponible aparece enseguida; en iPhone, Mac o dentro de otra app, tras unos segundos.
    const t = setTimeout(() => setOpen(true), mode === 'prompt' ? 1200 : 3500);
    return () => clearTimeout(t);
  }, [mode]);
  useEffect(() => {
    const fn = () => { setOpen(true); setSteps(mode !== 'prompt'); };
    window.addEventListener('install:open', fn);
    return () => window.removeEventListener('install:open', fn);
  }, [mode]);
  useEffect(() => { if (inst.standalone) setOpen(false); }, [inst.standalone]);

  if (!mode) return null;
  const close = () => setOpen(false);
  const later = () => { snoozeInstall(3); close(); };
  const install = async () => {
    if (await inst.prompt()) { close(); toast(`Listo: ${appName} ya está en ${formal ? 'su' : 'tu'} ${isDesktop() ? 'computador' : 'pantalla de inicio'}`); }
  };
  const openInChrome = () => {
    const { host, pathname, search, href } = window.location;
    window.location.href = `intent://${host}${pathname}${search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(href)};end`;
  };
  const copyLink = async () => { if (await copyText(window.location.href)) toast('Enlace copiado: pégalo en Safari'); };

  // La coordinación habla de usted; los paneles de líderes y cabezas, de tú.
  const text = (formal ? {
    prompt: isDesktop() ? 'Téngalo a mano en su computador, como una app.' : 'Ábralo con un toque desde su pantalla de inicio, como una app.',
    ios: 'Téngalo en su pantalla de inicio, como una app. Son dos toques.',
    mac: 'Téngalo en el Dock de su Mac, como una app.',
    'ios-inapp': 'Para instalarlo, ábralo en Safari.',
    'android-inapp': 'Para instalarlo, ábralo en Chrome.',
  } : {
    prompt: isDesktop() ? 'Tenlo a mano en tu computador, como una app.' : 'Ábrelo con un toque desde tu pantalla de inicio, como una app.',
    ios: 'Tenlo en tu pantalla de inicio, como una app. Son dos toques.',
    mac: 'Tenlo en el Dock de tu Mac, como una app.',
    'ios-inapp': 'Para instalarlo, ábrelo en Safari.',
    'android-inapp': 'Para instalarlo, ábrelo en Chrome.',
  })[mode];

  return (
    <div className={`install-pop ${open ? 'open' : ''}`} role="dialog" aria-modal="false" aria-labelledby="install-pop-title" aria-hidden={!open}>
      <span className="install-icon"><Monogram /></span>
      <div className="install-pop-text">
        <b id="install-pop-title">{formal ? 'Instale' : 'Instala'} {appName}</b>
        <span>{text}</span>
        {steps && mode === 'ios' && (
          <ol className="install-steps">
            <li>{formal ? 'Toque' : 'Toca'} <Share size={15} aria-label="Compartir" /> <b>Compartir</b> (en iPhone reciente está dentro de <b>···</b>).</li>
            <li>{formal ? 'Elija' : 'Elige'} <SquarePlus size={15} aria-hidden="true" /> <b>Agregar a inicio</b> y luego <b>Agregar</b>.</li>
          </ol>
        )}
        {steps && mode === 'mac' && <ol className="install-steps"><li>En la barra de menú {formal ? 'elija' : 'elige'} <b>Archivo › Agregar al Dock</b>.</li></ol>}
        <div className="install-pop-actions">
          {mode === 'prompt' && <button type="button" className="btn btn-sm btn-primary" onClick={install} tabIndex={open ? 0 : -1}><Download size={15} />Instalar</button>}
          {(mode === 'ios' || mode === 'mac') && !steps && <button type="button" className="btn btn-sm btn-primary" onClick={() => setSteps(true)} tabIndex={open ? 0 : -1}><SquarePlus size={15} />Ver cómo</button>}
          {(mode === 'ios' || mode === 'mac') && steps && <button type="button" className="btn btn-sm btn-primary" onClick={() => { snoozeInstall(30); close(); }} tabIndex={open ? 0 : -1}><Check size={15} />Ya lo hice</button>}
          {mode === 'android-inapp' && <button type="button" className="btn btn-sm btn-primary" onClick={openInChrome} tabIndex={open ? 0 : -1}><ExternalLink size={15} />Abrir en Chrome</button>}
          {mode === 'ios-inapp' && <button type="button" className="btn btn-sm btn-primary" onClick={copyLink} tabIndex={open ? 0 : -1}><Copy size={15} />Copiar enlace</button>}
          <button type="button" className="btn btn-sm btn-ghost" onClick={later} tabIndex={open ? 0 : -1}>Ahora no</button>
        </div>
      </div>
      <button type="button" className="btn btn-ghost btn-sm btn-icon install-close" onClick={close} aria-label="Cerrar" tabIndex={open ? 0 : -1}><X size={16} /></button>
    </div>
  );
}

/** Botón discreto para volver a abrir el aviso cuando se cerró. Sólo aparece si en este navegador se puede instalar. */
export function InstallButton({ appName = 'Mi panel' }) {
  const { mode } = useInstall();
  if (!mode) return null;
  return <button type="button" className="btn btn-ghost" onClick={openInstallPrompt}><Download size={16} />Instalar {appName} como app</button>;
}

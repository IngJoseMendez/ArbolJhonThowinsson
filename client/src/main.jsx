import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource/fira-sans/latin-400.css';
import '@fontsource/fira-sans/latin-500.css';
import '@fontsource/fira-sans/latin-600.css';
import '@fontsource/zilla-slab/latin-600.css';
import '@fontsource/zilla-slab/latin-700.css';
import App from './App.jsx';
import { ToastProvider } from './components/ui.jsx';
import { registerServiceWorker, launchToPanel } from './lib/pwa.js';
import './styles.css';

try {
  const t = localStorage.getItem('theme');
  if (t) document.documentElement.dataset.theme = t;
} catch { /* sin almacenamiento */ }

registerServiceWorker();
// La app instalada en el celular de un líder o una cabeza abre directo su panel.
launchToPanel();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);

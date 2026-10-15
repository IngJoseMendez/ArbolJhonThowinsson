import { Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Loading } from './components/ui.jsx';
import { lazyPage } from './lib/lazyPage.js';

// Cada parte se descarga sólo cuando se abre: quien llega a registrarse o a su panel no baja la coordinación.
const Register = lazyPage(() => import('./pages/Register.jsx'));
const Panel = lazyPage(() => import('./pages/Panel.jsx'));
const AdminApp = lazyPage(() => import('./AdminApp.jsx'));

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/registro/:token" element={<Register />} />
        <Route path="/panel/:token" element={<Panel />} />
        <Route path="/*" element={<AdminApp />} />
      </Routes>
    </Suspense>
  );
}

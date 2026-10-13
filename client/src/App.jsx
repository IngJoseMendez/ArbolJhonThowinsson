import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import { Loading } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Heads from './pages/Heads.jsx';
import HeadDetail from './pages/HeadDetail.jsx';
import Leaders from './pages/Leaders.jsx';
import TreeExplorer from './pages/TreeExplorer.jsx';
import People from './pages/People.jsx';
import Person from './pages/Person.jsx';
import Links from './pages/Links.jsx';
import Register from './pages/Register.jsx';
import Users from './pages/Users.jsx';
import Audit from './pages/Audit.jsx';
import Locations from './pages/Locations.jsx';

function Protected({ children, admin, superOnly }) {
  const a = useAuth();
  const loc = useLocation();
  if (a.loading) return <Loading />;
  if (!a.me) return <Navigate to="/login" state={{ from: loc.pathname + loc.search }} replace />;
  if (superOnly && !a.isSuper) return <Navigate to="/" replace />;
  if (admin && !a.isAdmin) return <Navigate to="/" replace />;
  return children;
}

function Home() {
  const a = useAuth();
  if (a.user?.role === 'member' && a.person) return <Navigate to={`/personas/${a.person.id}`} replace />;
  return <Dashboard />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/registro/:token" element={<Register />} />
        <Route element={<Protected><Layout /></Protected>}>
          <Route index element={<Home />} />
          <Route path="cabezas" element={<Heads />} />
          <Route path="cabezas/:id" element={<HeadDetail />} />
          <Route path="lideres" element={<Leaders />} />
          <Route path="arbol" element={<TreeExplorer />} />
          <Route path="personas" element={<People />} />
          <Route path="personas/:id" element={<Person />} />
          <Route path="enlaces" element={<Links />} />
          <Route path="ubicaciones" element={<Locations />} />
          <Route path="usuarios" element={<Protected admin><Users /></Protected>} />
          <Route path="auditoria" element={<Protected superOnly><Audit /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}

import { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import Dashboard from './pages/Dashboard';
import Clients from './pages/Clients';
import ClientDetail from './pages/ClientDetail';
import Leads from './pages/Leads';
import LeadDetail from './pages/LeadDetail';
import Templates from './pages/Templates';
import Protocols from './pages/Protocols';
import Login from './pages/Login';

export default function App() {
  const [authed, setAuthed] = useState(() => !!localStorage.getItem('auth_password'));

  if (!authed) {
    return <Login onLogin={() => setAuthed(true)} />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="clients" element={<Clients />} />
          <Route path="clients/:id" element={<ClientDetail />} />
          <Route path="leads" element={<Leads />} />
          <Route path="leads/:id" element={<LeadDetail />} />
          <Route path="templates" element={<Templates />} />
          <Route path="protocols" element={<Protocols />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

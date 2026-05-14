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
import CalendlySettings from './pages/CalendlySettings';
import FoodBank from './pages/FoodBank';
import MenuEditor from './pages/MenuEditor';
import PublicWeight from './pages/PublicWeight';
import PublicFoodBank from './pages/PublicFoodBank';
import Login from './pages/Login';

export default function App() {
  const [authed, setAuthed] = useState(() => !!localStorage.getItem('auth_password'));

  // Public pages bypass auth entirely
  const isPublicPage =
    window.location.pathname.startsWith('/w/') ||
    window.location.pathname.startsWith('/food/');

  if (!authed && !isPublicPage) {
    return <Login onLogin={() => setAuthed(true)} />;
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Public — no auth, no AppShell */}
        <Route path="/w/:token" element={<PublicWeight />} />
        <Route path="/food/:token" element={<PublicFoodBank />} />

        {/* Protected — requires auth */}
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="clients" element={<Clients />} />
          <Route path="clients/:id" element={<ClientDetail />} />
          <Route path="clients/:clientId/menus/:menuId" element={<MenuEditor />} />
          <Route path="leads" element={<Leads />} />
          <Route path="leads/:id" element={<LeadDetail />} />
          <Route path="templates" element={<Templates />} />
          <Route path="protocols" element={<Protocols />} />
          <Route path="calendly" element={<CalendlySettings />} />
          <Route path="food-bank" element={<FoodBank />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

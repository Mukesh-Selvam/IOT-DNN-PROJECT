import React, { Suspense, lazy, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import Sidebar from './components/Sidebar';
import { useSocketStatus } from './lib/socket';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const IncidentsPage = lazy(() => import('./pages/IncidentsPage'));
const FleetPage = lazy(() => import('./pages/FleetPage'));
const MapPage = lazy(() => import('./pages/MapPage'));
const MLConsolePage = lazy(() => import('./pages/MLConsolePage'));
const SimulatorPage = lazy(() => import('./pages/SimulatorPage'));
const ContactsPage = lazy(() => import('./pages/ContactsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

const PAGES = {
  dashboard: DashboardPage,
  simulator: SimulatorPage,
  incidents: IncidentsPage,
  fleet: FleetPage,
  map: MapPage,
  ml: MLConsolePage,
  contacts: ContactsPage,
  settings: SettingsPage,
};

function AppShell() {
  const { user, loading } = useAuth();
  const [activePage, setActivePage] = useState('dashboard');
  const socketConnected = useSocketStatus();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[rgb(9,9,18)]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600/25 border border-indigo-500/30 flex items-center justify-center text-2xl animate-pulse">
            🚗
          </div>
          <p className="text-slate-500 text-sm">Initialising…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const PageComponent = PAGES[activePage] || DashboardPage;

  return (
    <div className="flex min-h-screen">
      <Sidebar
        activePage={activePage}
        onNavigate={setActivePage}
        socketConnected={socketConnected}
      />
      <main className="flex-1 overflow-y-auto">
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-full min-h-[300px]">
              <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
            </div>
          }
        >
          <PageComponent />
        </Suspense>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}

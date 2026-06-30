import { HashRouter, Routes, Route, Navigate } from 'react-router';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/sonner';
import { CatastroProvider, useCatastro } from '@/context/CatastroContext';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { MobileDrawer } from '@/components/layout/MobileDrawer';
import DashboardPage from '@/pages/DashboardPage';
import MapaCatastralPage from '@/pages/MapaCatastralPage';
import FichaPredioPage from '@/pages/FichaPredioPage';
import PrediosPage from '@/pages/PrediosPage';
import DocumentosPage from '@/pages/DocumentosPage';
import AdminDatosPage from '@/pages/AdminDatosPage';
import LoginPage from '@/pages/LoginPage';

function AppLayout({ children }: { children: React.ReactNode }) {
  const { mobileDrawerOpen, toggleMobileDrawer } = useCatastro();
  return (
    <div className="flex h-screen bg-[#F7F8FA]">
      <Sidebar />
      {mobileDrawerOpen && <MobileDrawer onClose={toggleMobileDrawer} />}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}

function AppRoutes() {
  const { session } = useCatastro();
  if (!session) {
    return <LoginPage />;
  }
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route
        path="/dashboard"
        element={<AppLayout><DashboardPage /></AppLayout>}
      />
      <Route
        path="/mapa"
        element={<AppLayout><MapaCatastralPage /></AppLayout>}
      />
      <Route
        path="/predios"
        element={<AppLayout><PrediosPage /></AppLayout>}
      />
      <Route
        path="/predios/:predioId"
        element={<AppLayout><FichaPredioPage /></AppLayout>}
      />
      <Route
        path="/documentos"
        element={<AppLayout><DocumentosPage /></AppLayout>}
      />
      <Route
        path="/admin/datos"
        element={<AppLayout><AdminDatosPage /></AppLayout>}
      />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <HashRouter>
        <CatastroProvider>
          <AppRoutes />
          <Toaster position="top-right" richColors closeButton />
        </CatastroProvider>
      </HashRouter>
    </ThemeProvider>
  );
}

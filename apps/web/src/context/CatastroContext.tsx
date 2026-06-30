import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { DashboardKpis } from '@/types/catastro';
import { getSourceStatus } from '@/lib/catastroClient';

export interface SessionInfo {
  usuario: string;
  oficina: string;
  municipio: string;
}

interface CatastroState {
  sidebarCollapsed: boolean;
  mobileDrawerOpen: boolean;
  /** Último predio seleccionado (para highlight en mapa) */
  selectedPredioId: string | null;
  /** KPIs en memoria para invalidar el dashboard tras mutaciones */
  dashboardOverride: DashboardKpis | null;
  /** 'real' | 'demo' — detectado desde /api/source-status al arrancar */
  sourceMode: 'real' | 'demo';
  /** Sesión cosmética (login demo). null = no autenticado */
  session: SessionInfo | null;
  login: (info: SessionInfo) => void;
  logout: () => void;
  toggleSidebar: () => void;
  toggleMobileDrawer: () => void;
  setSelectedPredioId: (id: string | null) => void;
  setDashboardOverride: (kpis: DashboardKpis | null) => void;
  invalidateDashboard: () => void;
  dashboardVersion: number;
}

const CatastroContext = createContext<CatastroState | null>(null);

export function CatastroProvider({ children }: { children: ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [selectedPredioId, setSelectedPredioId] = useState<string | null>(null);
  const [dashboardOverride, setDashboardOverride] = useState<DashboardKpis | null>(null);
  const [dashboardVersion, setDashboardVersion] = useState(0);
  const [sourceMode, setSourceMode] = useState<'real' | 'demo'>('demo');
  const [session, setSession] = useState<SessionInfo | null>(() => {
    try {
      const raw = sessionStorage.getItem('catastro_session');
      return raw ? (JSON.parse(raw) as SessionInfo) : null;
    } catch { return null; }
  });

  // Detectar fuente al arrancar — una sola vez
  useEffect(() => {
    getSourceStatus()
      .then(s => {
        if ((s as Record<string, unknown>)?.source === 'real') setSourceMode('real');
      })
      .catch(() => { /* fallback demo */ });
  }, []);

  const toggleSidebar = useCallback(() => setSidebarCollapsed(p => !p), []);
  const toggleMobileDrawer = useCallback(() => setMobileDrawerOpen(p => !p), []);
  const invalidateDashboard = useCallback(() => setDashboardVersion(v => v + 1), []);

  const login = useCallback((info: SessionInfo) => {
    setSession(info);
    try { sessionStorage.setItem('catastro_session', JSON.stringify(info)); } catch { /* ignore */ }
  }, []);

  const logout = useCallback(() => {
    setSession(null);
    try { sessionStorage.removeItem('catastro_session'); } catch { /* ignore */ }
  }, []);

  return (
    <CatastroContext.Provider
      value={{
        sidebarCollapsed,
        mobileDrawerOpen,
        selectedPredioId,
        dashboardOverride,
        sourceMode,
        session,
        login,
        logout,
        toggleSidebar,
        toggleMobileDrawer,
        setSelectedPredioId,
        setDashboardOverride,
        invalidateDashboard,
        dashboardVersion,
      }}
    >
      {children}
    </CatastroContext.Provider>
  );
}

export function useCatastro() {
  const ctx = useContext(CatastroContext);
  if (!ctx) throw new Error('useCatastro must be used inside CatastroProvider');
  return ctx;
}

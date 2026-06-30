import { useLocation } from 'react-router';
import { useCatastro } from '@/context/CatastroContext';
import { Menu, LandPlot, LogOut, UserCircle2 } from 'lucide-react';

const ROUTE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard Ejecutivo',
  '/mapa': 'Mapa Catastral 2D',
  '/predios': 'Predios',
  '/documentos': 'Administración de documentos',
};

export function TopBar() {
  const { toggleMobileDrawer, sourceMode, session, logout } = useCatastro();
  const location = useLocation();

  const title =
    Object.entries(ROUTE_TITLES).find(([path]) =>
      location.pathname === path || location.pathname.startsWith(path + '/')
    )?.[1] ?? 'Katastik';

  return (
    <header className="sticky top-0 z-30 h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-3 shadow-sm">
      {/* Mobile menu toggle */}
      <button
        onClick={toggleMobileDrawer}
        className="lg:hidden text-gray-500 hover:text-gray-800"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile brand */}
      <div className="lg:hidden flex items-center gap-2">
        <LandPlot className="w-5 h-5 text-[#1B3A5C]" />
        <span className="text-sm font-bold text-[#1B3A5C]">Katastik</span>
      </div>

      <span className="hidden lg:block text-sm font-semibold text-gray-800">{title}</span>

      <div className="ml-auto flex items-center gap-3">
        {sourceMode === 'real' ? (
          <span className="text-[11px] text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-0.5 font-medium flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
            API REAL — municipio 078
          </span>
        ) : (
          <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5 font-medium">
            DATOS DEMO — no es catastro real
          </span>
        )}

        {session && (
          <div className="flex items-center gap-2 pl-3 border-l border-gray-200">
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-gray-600">
              <UserCircle2 className="w-4 h-4 text-gray-400" />
              <div className="leading-tight">
                <div className="font-medium text-gray-800">{session.usuario}</div>
                <div className="text-[10px] text-gray-400">{session.oficina}</div>
              </div>
            </div>
            <button
              onClick={logout}
              title="Cerrar sesión"
              className="text-gray-400 hover:text-red-600 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

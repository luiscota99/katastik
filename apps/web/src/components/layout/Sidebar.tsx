import { NavLink, useLocation } from 'react-router';
import { useCatastro } from '@/context/CatastroContext';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Map,
  FileText,
  ChevronLeft,
  ChevronRight,
  LandPlot,
  FileSearch,
} from 'lucide-react';

const MENU = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/mapa', label: 'Mapa Catastral', icon: Map },
  { path: '/predios', label: 'Predios / Predial', icon: FileText },
  { path: '/documentos', label: 'Documentos', icon: FileSearch },
];

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, sourceMode } = useCatastro();
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === '/dashboard') return location.pathname === '/dashboard';
    if (path === '/predios') return location.pathname.startsWith('/predios');
    return location.pathname.startsWith(path);
  };

  return (
    <aside
      className={cn(
        'hidden lg:flex flex-col bg-[#1B3A5C] text-white transition-all duration-300 ease-in-out h-screen flex-shrink-0 sticky top-0 self-start',
        sidebarCollapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Branding */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        {!sidebarCollapsed && (
          <div className="flex items-center gap-2">
            <LandPlot className="w-7 h-7 text-[#E8913A]" />
            <div>
              <div className="text-sm font-bold tracking-wide">KATASTIK</div>
              <div className="text-[10px] text-white/60">Gestión Catastral Digital</div>
            </div>
          </div>
        )}
        {sidebarCollapsed && <LandPlot className="w-7 h-7 text-[#E8913A] mx-auto" />}
        <button
          onClick={toggleSidebar}
          className="text-white/60 hover:text-white transition-colors"
        >
          {sidebarCollapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Badge fuente */}
      {!sidebarCollapsed && (
        <div className="px-4 py-2">
          {sourceMode === 'real' ? (
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-green-500/20">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[10px] font-medium text-green-300">API REAL — mun. 078</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-[#E8913A]/20">
              <span className="w-2 h-2 rounded-full bg-[#E8913A] animate-pulse" />
              <span className="text-[10px] font-medium text-white/90">DEMO — datos ficticios</span>
            </div>
          )}
        </div>
      )}

      {/* Navegacion */}
      <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto">
        {MENU.map(({ path, label, icon: Icon }) => {
          const active = isActive(path);
          return (
            <NavLink
              key={path}
              to={path}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150',
                active
                  ? 'bg-white/15 border-l-2 border-[#E8913A] text-white'
                  : 'text-white/70 hover:bg-white/8 hover:text-white'
              )}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {!sidebarCollapsed && <span className="text-sm font-medium">{label}</span>}
            </NavLink>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-white/10">
        {!sidebarCollapsed && (
          <div className="text-[10px] text-white/40 text-center leading-tight">
            GovTech Labs · MVP 2026
            <br />
            Katastik
          </div>
        )}
      </div>
    </aside>
  );
}

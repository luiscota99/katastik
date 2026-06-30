import { NavLink } from 'react-router';
import { cn } from '@/lib/utils';
import { LayoutDashboard, Map, FileText, LandPlot, X, FileSearch } from 'lucide-react';

const MENU = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/mapa', label: 'Mapa Catastral', icon: Map },
  { path: '/predios', label: 'Predios / Predial', icon: FileText },
  { path: '/documentos', label: 'Documentos', icon: FileSearch },
];

export function MobileDrawer({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="absolute left-0 top-0 h-full w-64 bg-[#1B3A5C] text-white flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <LandPlot className="w-6 h-6 text-[#E8913A]" />
            <div>
              <div className="text-sm font-bold">KATASTIK</div>
              <div className="text-[10px] text-white/60">Gestión Catastral Digital</div>
            </div>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <nav className="flex-1 py-2 px-2 space-y-0.5">
          {MENU.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              onClick={onClose}
              className={({ isActive }: { isActive: boolean }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all',
                  isActive
                    ? 'bg-white/15 border-l-2 border-[#E8913A] text-white'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                )
              }
            >
              <Icon className="w-5 h-5" />
              <span className="text-sm font-medium">{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-white/10">
          <div className="text-[10px] text-white/40 text-center">
            GovTech Labs · MVP 2026
          </div>
        </div>
      </aside>
    </div>
  );
}

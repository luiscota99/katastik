import { useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { searchProperties, getSourceStatus } from '@/lib/catastroClient';
import { formatCurrency } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Search, Wifi, Database, AlertTriangle, Info } from 'lucide-react';
import type { Predio } from '@/types/catastro';

type PredioExt = Predio & {
  adeudoMXN?: number;
  baseGravableMXN?: number;
  sinValorCatastral?: boolean;
};

type Tab = 'todos' | 'adeudo' | 'exentos' | 'auditoria';

/** Discrepancia relativa entre valor catastral y base gravable */
function discrepancia(p: PredioExt): number | null {
  const val = p.valorCatastralMXN ?? 0;
  const base = p.baseGravableMXN ?? 0;
  if (base === 0) return null;
  return Math.abs(val - base) / base;
}

/** Clasifica el motivo de discrepancia */
function motivoDiscrepancia(p: PredioExt): string {
  if (p.sinValorCatastral) return 'Sin avalúo catastral asignado';
  const pct = discrepancia(p);
  if (pct === null) return 'Sin base gravable';
  if (pct > 0.5) return 'Diferencia mayor al 50%';
  if (pct > 0.2) return 'Diferencia mayor al 20%';
  return 'Diferencia leve (>5%)';
}

/** true si el string parece una CCO válida (15 o 16 dígitos, con o sin guiones) */
function looksLikeCCO(s: string) {
  return /^\d{15,16}$/.test(s.replace(/-/g, '').trim());
}

function PredioRow({ p, highlight }: { p: PredioExt; highlight?: boolean }) {
  const navigate = useNavigate();
  const adeudo = p.adeudoMXN ?? 0;
  const isExento = p.estadoPredio === 'exento';
  const hasAdeudo = adeudo > 0;
  const sinValor = !!p.sinValorCatastral;
  const baseGravable = p.baseGravableMXN ?? 0;
  const pct = discrepancia(p);

  return (
    <button
      className={`w-full text-left px-5 py-3.5 hover:bg-gray-50 transition-colors flex items-center gap-4 ${highlight ? 'bg-amber-50/40' : ''}`}
      onClick={() => navigate(`/predios/${p.id}`)}
    >
      {/* Left */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-[#1B3A5C]">{p.claveCatastral || p.id}</span>
          {p.fuente === 'API real municipio 078' && (
            <span className="text-[11px] text-green-700 bg-green-50 border border-green-200 rounded-full px-1.5 py-0.5">real</span>
          )}
          {isExento && (
            <span className="text-[11px] text-purple-700 bg-purple-50 border border-purple-200 rounded-full px-1.5 py-0.5">exento</span>
          )}
          {!isExento && hasAdeudo && (
            <span className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-full px-1.5 py-0.5">
              adeudo {formatCurrency(adeudo)}
            </span>
          )}
          {!isExento && !hasAdeudo && (
            <span className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5">al corriente</span>
          )}
          {highlight && sinValor && (
            <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5 flex items-center gap-0.5">
              <AlertTriangle className="w-2.5 h-2.5" /> sin avalúo
            </span>
          )}
          {highlight && !sinValor && pct !== null && (
            <span className="text-[11px] text-orange-700 bg-orange-50 border border-orange-200 rounded-full px-1.5 py-0.5">
              Δ {(pct * 100).toFixed(0)}%
            </span>
          )}
        </div>
        <div className="text-sm text-gray-600 truncate mt-0.5">{p.domicilio || '—'}</div>
        {highlight && (
          <div className="text-xs text-amber-600 mt-0.5">{motivoDiscrepancia(p)}</div>
        )}
        {!highlight && (
          <div className="text-xs text-gray-400 mt-0.5">
            {[p.usoSuelo, p.zona].filter(Boolean).join(' · ') || ''}
          </div>
        )}
      </div>

      {/* Right */}
      <div className="text-right flex-shrink-0 space-y-0.5 min-w-[110px]">
        <div className="text-xs text-gray-400">Valor catastral</div>
        <div className={`text-sm font-bold ${sinValor ? 'text-amber-600' : 'text-gray-800'}`}>
          {sinValor ? 'Sin avalúo' : (p.valorCatastralMXN ? formatCurrency(p.valorCatastralMXN) : '—')}
        </div>
        {baseGravable > 0 && (
          <div className={`text-[10px] ${highlight && pct !== null && pct > 0.05 ? 'text-orange-500 font-medium' : 'text-gray-400'}`}>
            Base grav. {formatCurrency(baseGravable)}
          </div>
        )}
        <div className="text-xs text-gray-400 truncate max-w-36">{p.propietario || '—'}</div>
      </div>
    </button>
  );
}

export default function PrediosPage() {
  const [list, setList] = useState<PredioExt[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [sourceMode, setSourceMode] = useState<'demo' | 'real' | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('todos');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getSourceStatus()
      .then(s => setSourceMode((s?.source as string) === 'real' ? 'real' : 'demo'))
      .catch(() => setSourceMode('demo'));
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (sourceMode === 'real' && query && !looksLikeCCO(query)) {
      setHint('Ingresa la Clave Catastral (CCO) de 15–16 dígitos para buscar en la API real. Ej: 0078000101001002');
      setList([]);
      return;
    }
    setHint(null);

    debounceRef.current = setTimeout(() => {
      setLoading(true);
      searchProperties(query || undefined)
        .then(res => {
          if (Array.isArray(res)) {
            setList(res as PredioExt[]);
          } else {
            const typed = res as { data?: PredioExt[]; hint?: string };
            setList(typed.data ?? []);
            if (typed.hint) setHint(typed.hint);
          }
        })
        .catch(() => setList([]))
        .finally(() => setLoading(false));
    }, sourceMode === 'real' ? 0 : 300);
  }, [query, sourceMode]);

  // Auditoría: predios con discrepancia > 5% entre valor catastral y base gravable
  const auditoriaList = useMemo(() =>
    list.filter(p => {
      if (p.sinValorCatastral) return true;
      const pct = discrepancia(p);
      return pct !== null && pct > 0.05;
    }),
    [list]
  );

  const tabs: { id: Tab; label: string; count: number; color?: string }[] = [
    { id: 'todos',     label: 'Todos',     count: list.length },
    { id: 'adeudo',    label: 'Con adeudo', count: list.filter(p => (p.adeudoMXN ?? 0) > 0).length, color: 'red' },
    { id: 'exentos',   label: 'Exentos',   count: list.filter(p => p.estadoPredio === 'exento').length, color: 'purple' },
    { id: 'auditoria', label: 'Auditoría catastral', count: auditoriaList.length, color: 'amber' },
  ];

  const visibleList = useMemo(() => {
    if (tab === 'adeudo')    return list.filter(p => (p.adeudoMXN ?? 0) > 0);
    if (tab === 'exentos')   return list.filter(p => p.estadoPredio === 'exento');
    if (tab === 'auditoria') return auditoriaList;
    return list;
  }, [tab, list, auditoriaList]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-[#1B3A5C]">Predios</h1>
        <div className="flex items-center gap-2">
          {sourceMode === 'real' ? (
            <span className="flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-1">
              <Wifi className="w-3 h-3" /> API real · Municipio 078
            </span>
          ) : sourceMode === 'demo' ? (
            <span className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
              <Database className="w-3 h-3" /> Datos demo
            </span>
          ) : null}
        </div>
      </div>

      {sourceMode === 'real' && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 text-sm text-blue-800">
          Modo API real activo. Busca por <strong>Clave Catastral (CCO)</strong> de 15 dígitos sin guiones.
          Ejemplo: <code className="bg-blue-100 rounded px-1 text-xs font-mono">078000101001001</code>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
        <Input
          placeholder={sourceMode === 'real'
            ? 'Clave Catastral (CCO) — 15 dígitos, ej: 078000101001001'
            : 'Buscar por clave, cuenta, propietario, colonia…'}
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {hint && (
        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{hint}</p>
      )}

      {/* Tabs */}
      {list.length > 0 && (
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {tabs.map(t => {
            const active = tab === t.id;
            const colorMap: Record<string, string> = {
              red:    active ? 'bg-white text-red-700 shadow-sm'    : 'text-red-500 hover:text-red-700',
              purple: active ? 'bg-white text-purple-700 shadow-sm' : 'text-purple-500 hover:text-purple-700',
              amber:  active ? 'bg-white text-amber-700 shadow-sm'  : 'text-amber-500 hover:text-amber-700',
            };
            const cls = t.color
              ? colorMap[t.color]
              : active ? 'bg-white text-[#1B3A5C] shadow-sm' : 'text-gray-500 hover:text-gray-700';
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${cls}`}
              >
                {t.id === 'auditoria' && <AlertTriangle className="w-3 h-3" />}
                {t.label}
                {t.count > 0 && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    active
                      ? t.color === 'amber'  ? 'bg-amber-100 text-amber-700'
                      : t.color === 'red'    ? 'bg-red-100 text-red-700'
                      : t.color === 'purple' ? 'bg-purple-100 text-purple-700'
                      : 'bg-blue-100 text-blue-700'
                      : 'bg-gray-200 text-gray-600'
                  }`}>
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Auditoría header */}
      {tab === 'auditoria' && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <strong>Auditoría catastral</strong> — predios donde el valor catastral no coincide con la base gravable (diferencia {'>'} 5%), o que carecen de avalúo formal.
            Estos predios son candidatos a revisión: posible avalúo desactualizado, alta por subdivisión sin valuación, o inconsistencia fiscal.
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-[#1B3A5C]" />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="divide-y divide-gray-100">
            {visibleList.map(p => (
              <PredioRow key={p.id} p={p} highlight={tab === 'auditoria'} />
            ))}
            {visibleList.length === 0 && !loading && !hint && (
              <div className="p-8 text-center text-sm text-gray-400">
                {tab === 'auditoria'
                  ? 'No se detectaron discrepancias entre valor catastral y base gravable.'
                  : sourceMode === 'real'
                    ? 'Ingresa una CCO de 15 dígitos para consultar el predio en la API real.'
                    : 'Sin resultados'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

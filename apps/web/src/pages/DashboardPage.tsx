import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { getDashboard, resetDemo, getGeoJSON } from '@/lib/catastroClient';
import { useCatastro } from '@/context/CatastroContext';
import { MapaCatastral } from '@/components/mapa/MapaCatastral';
import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';
import type { DashboardKpis, PredioFeatureCollection } from '@/types/catastro';
import {
  Building2, CreditCard, FileText, Briefcase, RotateCcw, CheckCircle2, AlertCircle
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

const KPI_CARDS = [
  { key: 'totalPredios', label: 'Predios Registrados', icon: Building2, color: '#1B3A5C', suffix: '' },
  { key: 'adeudoTotalMXN', label: 'Adeudo Pendiente', icon: CreditCard, color: '#E8913A', isCurrency: true },
  { key: 'pagosSimulados', label: 'Pagos Simulados', icon: CheckCircle2, color: '#38A169', suffix: '' },
  { key: 'documentosNom151', label: 'Docs NOM-151', icon: FileText, color: '#0D7377', suffix: '' },
  { key: 'tramitesAbiertos', label: 'Trámites Abiertos', icon: Briefcase, color: '#805AD5', suffix: '' },
  { key: 'documentos', label: 'Documentos Totales', icon: FileText, color: '#3182CE', suffix: '' },
];

export default function DashboardPage() {
  const navigate = useNavigate();
  const { dashboardVersion, invalidateDashboard, sourceMode } = useCatastro();
  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [geojson, setGeojson] = useState<PredioFeatureCollection | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [k, g] = await Promise.all([getDashboard(), getGeoJSON()]);
      setKpis(k);
      setGeojson(g);
    } catch (e) {
      toast.error('Error cargando datos del dashboard');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, dashboardVersion]);

  const handleReset = async () => {
    try {
      await resetDemo();
      invalidateDashboard();
      toast.success('Demo reiniciada desde datos originales');
    } catch {
      toast.error('No se pudo reiniciar (verifica que el API esté corriendo)');
    }
  };

  // Datos para mini-gráfica de distribución
  const chartData = kpis
    ? [
        { name: 'Pendiente', value: kpis.totalPredios - kpis.pagosSimulados, fill: '#E8913A' },
        { name: 'Pagado', value: kpis.pagosSimulados, fill: '#38A169' },
        { name: 'NOM-151', value: kpis.documentosNom151, fill: '#0D7377' },
        { name: 'Trámites', value: kpis.tramitesAbiertos, fill: '#805AD5' },
      ]
    : [];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1B3A5C]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#1B3A5C]">Dashboard Ejecutivo</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {kpis?.totalPredios ?? 0} predios activos
            {(kpis as (typeof kpis & { _real?: boolean }))?._real
              ? <span className="ml-1.5 text-[11px] text-green-600 font-medium">· API real</span>
              : null}
            {kpis?.generatedAt && (
              <span className="ml-2 text-[11px] text-gray-400">
                Actualizado: {new Date(kpis.generatedAt).toLocaleTimeString('es-MX')}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={handleReset}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:border-red-300 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reiniciar demo
        </button>
      </div>

      {/* Banner fuente */}
      {(kpis as (typeof kpis & { _real?: boolean }))?._real ? (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>
            <strong>API REAL</strong> — municipio 078 · KPIs y adeudos calculados desde datos en vivo.
            Acciones de pago/firma son simuladas.
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>
            <strong>DATOS DEMO</strong> — información ficticia generada para presentación.
          </span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {KPI_CARDS.map(({ key, label, icon: Icon, color, isCurrency }) => {
          const val = kpis ? (kpis as unknown as Record<string, number>)[key] : 0;
          return (
            <div
              key={key}
              className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: color + '15' }}>
                  <Icon className="w-4 h-4" style={{ color }} />
                </div>
              </div>
              <div className="text-2xl font-bold text-gray-900">
                {isCurrency ? formatCurrency(val ?? 0) : (val ?? 0).toLocaleString('es-MX')}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{label}</div>
            </div>
          );
        })}
      </div>

      {/* Gráfica + Mapa */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Gráfica */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Distribución</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} barSize={28}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(v: number) => [v, '']}
                contentStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Mini-mapa */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            Mapa catastral —{' '}
            <button
              className="text-[#1B3A5C] underline underline-offset-2"
              onClick={() => navigate('/mapa')}
            >
              ver completo
            </button>
          </h2>
          <MapaCatastral geojson={geojson} height="260px" isReal={sourceMode === 'real'} />
        </div>
      </div>

      <p className="text-[10px] text-gray-400 text-center">
        {kpis?.fuente}
      </p>
    </div>
  );
}

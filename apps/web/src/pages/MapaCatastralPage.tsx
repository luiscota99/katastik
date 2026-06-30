import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { searchProperties, getAllGeometries, getSourceStatus } from '@/lib/catastroClient';
import { useCatastro } from '@/context/CatastroContext';
import { MapaCatastral } from '@/components/mapa/MapaCatastral';
import { toast } from 'sonner';
import type { PredioFeatureCollection, Predio } from '@/types/catastro';

export default function MapaCatastralPage() {
  const navigate = useNavigate();
  const { selectedPredioId, setSelectedPredioId } = useCatastro();
  const [geojson, setGeojson] = useState<PredioFeatureCollection | null>(null);
  const [prediosList, setPrediosList] = useState<Predio[]>([]);
  const [loading, setLoading] = useState(true);
  const [isReal, setIsReal] = useState(false);
  const [loadingGeom, setLoadingGeom] = useState(false);

  useEffect(() => {
    Promise.all([searchProperties(), getSourceStatus()])
      .then(([list, status]) => {
        setPrediosList(list as Predio[]);
        const real = (status as Record<string, unknown>)?.source === 'real';
        setIsReal(real);
        // Cargar TODOS los polígonos de una vez
        setLoadingGeom(true);
        return getAllGeometries().finally(() => setLoadingGeom(false));
      })
      .then(fc => setGeojson(fc as unknown as PredioFeatureCollection))
      .catch(() => toast.error('Error cargando el mapa'))
      .finally(() => setLoading(false));
  }, []);

  const handlePredioClick = (id: string) => {
    setSelectedPredioId(id);
    navigate(`/predios/${id}`);
  };

  const handleListItemClick = (id: string) => {
    setSelectedPredioId(id);
    navigate(`/predios/${id}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1B3A5C]" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#1B3A5C]">Mapa Catastral 2D</h1>
          <p className="text-sm text-gray-500">
            {isReal
              ? `${prediosList.length} predios reales · municipio 078 San Cristóbal de las Casas`
              : `${geojson?.features?.length ?? 0} predios demo · click en un polígono para ver la ficha`}
            {loadingGeom && ' · cargando geometría…'}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <MapaCatastral
          geojson={geojson}
          onPredioClick={handlePredioClick}
          selectedId={selectedPredioId}
          height="560px"
          isReal={isReal}
        />
      </div>

      {/* Lista de predios */}
      {prediosList.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">
              {isReal ? 'Predios con adeudo — municipio 078' : 'Lista de predios demo'}
            </h2>
          </div>
          <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
            {prediosList.slice(0, 25).map(p => (
              <button
                key={p.id}
                className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors flex items-center justify-between"
                onClick={() => handleListItemClick(p.id)}
              >
                <div>
                  <span className="text-sm font-medium text-gray-800">{p.id}</span>
                  <span className="ml-2 text-xs text-gray-500">
                    {isReal ? p.domicilio : `${p.colonia} · ${p.usoSuelo}`}
                  </span>
                </div>
                <span className="text-xs text-gray-400">
                  {isReal && (p as Predio & { adeudoMXN?: number }).adeudoMXN
                    ? `$${((p as Predio & { adeudoMXN?: number }).adeudoMXN ?? 0).toLocaleString('es-MX', { maximumFractionDigits: 0 })}`
                    : p.propietario}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

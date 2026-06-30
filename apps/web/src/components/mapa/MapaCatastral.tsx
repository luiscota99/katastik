import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { MapContainer, TileLayer, GeoJSON, Marker, Polyline, Polygon as LeafletPolygon, CircleMarker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import type { Layer, PathOptions, StyleFunction } from 'leaflet';
import type { Feature, Polygon, MultiPolygon, Geometry, FeatureCollection, GeoJsonObject } from 'geojson';
import type { PredioProperties, PredioFeatureCollection } from '@/types/catastro';
import { Search, MapPin, Satellite, Layers, Hash, Ruler, X } from 'lucide-react';
import { Input } from '@/components/ui/input';

// ── Fix Leaflet default icon (evita 404 con bundlers) ────────────
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png?url';
import markerIcon from 'leaflet/dist/images/marker-icon.png?url';
import markerShadow from 'leaflet/dist/images/marker-shadow.png?url';

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

// ── Constantes ───────────────────────────────────────────────────
const PUEBLA_CENTER: [number, number] = [19.041, -98.206];
const SAN_CRISTOBAL_CENTER: [number, number] = [16.737, -92.637]; // municipio 078
const DEFAULT_ZOOM = 15;

const USO_SUELO_COLORS: Record<string, string> = {
  'Habitacional': '#38A169',
  'Habitacional mixto': '#4299E1',
  'Comercial': '#E8913A',
  'Industrial': '#805AD5',
  'Servicios': '#0D7377',
  'Equipamiento urbano': '#D69E2E',
  'Mixto': '#3182CE',
};

function getFeatureColor(usoSuelo: string): string {
  const key = Object.keys(USO_SUELO_COLORS).find(k =>
    usoSuelo?.toLowerCase().includes(k.toLowerCase())
  );
  return key ? USO_SUELO_COLORS[key] : '#718096';
}

// ── Mapas temáticos ──────────────────────────────────────────────
type ThematicMode = 'none' | 'adeudo' | 'valor' | 'estado';

// Paleta secuencial (4 rangos): verde → amarillo → naranja → rojo
const THEMATIC_COLORS = ['#2E7D32', '#FBC02D', '#EF6C00', '#C62828'];
const ESTADO_AL_CORRIENTE = '#2E7D32';
const ESTADO_CON_ADEUDO = '#C62828';

// 3 puntos de corte → 4 rangos
const DEFAULT_BREAKS: Record<'adeudo' | 'valor', number[]> = {
  adeudo: [1000, 10000, 50000],
  valor: [200000, 500000, 1000000],
};

function bucketIndex(value: number, breaks: number[]): number {
  for (let i = 0; i < breaks.length; i++) {
    if (value <= breaks[i]) return i;
  }
  return breaks.length; // último bucket
}

function fmtMXN(n: number): string {
  return `$${Math.round(n).toLocaleString('es-MX')}`;
}

function rangeLabels(breaks: number[]): string[] {
  const labels: string[] = [];
  for (let i = 0; i <= breaks.length; i++) {
    if (i === 0) labels.push(`≤ ${fmtMXN(breaks[0])}`);
    else if (i === breaks.length) labels.push(`> ${fmtMXN(breaks[breaks.length - 1])}`);
    else labels.push(`${fmtMXN(breaks[i - 1])} – ${fmtMXN(breaks[i])}`);
  }
  return labels;
}

// ── Mediciones (distancia / área) ────────────────────────────────
type LatLngTuple = [number, number];

function totalDistanceM(points: LatLngTuple[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) {
    d += L.latLng(points[i - 1]).distanceTo(L.latLng(points[i]));
  }
  return d;
}

// Área geodésica esférica (m²) — fórmula de excedente esférico
function polygonAreaM2(points: LatLngTuple[]): number {
  if (points.length < 3) return 0;
  const R = 6378137; // radio terrestre WGS84
  const rad = Math.PI / 180;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [lat1, lng1] = points[i];
    const [lat2, lng2] = points[(i + 1) % points.length];
    area += (lng2 - lng1) * rad * (2 + Math.sin(lat1 * rad) + Math.sin(lat2 * rad));
  }
  return Math.abs((area * R * R) / 2);
}

function fmtDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(1)} m`;
}

function fmtArea(m2: number): string {
  if (m2 >= 10000) return `${(m2 / 10000).toFixed(2)} ha (${Math.round(m2).toLocaleString('es-MX')} m²)`;
  return `${Math.round(m2).toLocaleString('es-MX')} m²`;
}

// Capa de medición: captura clics, aplica cursor crosshair y bloquea
// la interacción con los polígonos del mapa cuando está activa.
function MeasureLayer({
  active,
  points,
  setPoints,
}: {
  active: boolean;
  points: LatLngTuple[];
  setPoints: React.Dispatch<React.SetStateAction<LatLngTuple[]>>;
}) {
  const map = useMapEvents({
    click(e) {
      if (!active) return;
      // Evitar que el clic llegue a los polígonos subyacentes
      L.DomEvent.stopPropagation(e.originalEvent);
      setPoints(prev => [...prev, [e.latlng.lat, e.latlng.lng]]);
    },
  });

  // Aplicar/quitar cursor crosshair en el contenedor del mapa
  useEffect(() => {
    const container = map.getContainer();
    if (active) {
      container.style.cursor = 'crosshair';
    } else {
      container.style.cursor = '';
    }
    return () => { container.style.cursor = ''; };
  }, [active, map]);

  if (points.length === 0) return null;
  return (
    <>
      {points.length >= 3 && (
        <LeafletPolygon positions={points} pathOptions={{ color: '#1B3A5C', weight: 1, fillColor: '#1B3A5C', fillOpacity: 0.1, interactive: false }} />
      )}
      <Polyline positions={points} pathOptions={{ color: '#1B3A5C', weight: 3, dashArray: '6 6', interactive: false }} />
      {points.map((pt, i) => (
        <CircleMarker key={i} center={pt} radius={4} pathOptions={{ color: '#fff', weight: 2, fillColor: '#E8913A', fillOpacity: 1, interactive: false }} />
      ))}
    </>
  );
}

// ── Sub-componente: Buscador que mueve el mapa ───────────────────
function MapSearchControl({
  geojson,
  query,
  setQuery,
}: {
  geojson: PredioFeatureCollection | FeatureCollection | null;
  query: string;
  setQuery: (q: string) => void;
}) {
  const map = useMap();

  const flyToPredioid = (id: string) => {
    if (!geojson) return;
    const feature = geojson.features.find(f => f.properties.id === id);
    if (!feature) return;
    try {
      const layer = L.geoJSON(feature);
      const bounds = layer.getBounds();
      if (bounds.isValid()) map.flyToBounds(bounds, { maxZoom: 18, duration: 0.8 });
    } catch { /* ignore */ }
  };

  const results = useMemo(() => {
    if (!query || !geojson) return [];
    const lq = query.toLowerCase();
    return geojson.features
      .filter(f =>
        f.properties.id?.toLowerCase().includes(lq) ||
        f.properties.claveCatastral?.toLowerCase().includes(lq) ||
        f.properties.colonia?.toLowerCase().includes(lq) ||
        f.properties.usoSuelo?.toLowerCase().includes(lq)
      )
      .slice(0, 5);
  }, [query, geojson]);

  return (
    <div className="absolute top-3 left-3 z-[1000] w-72">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
        <Input
          placeholder="Buscar predio, clave, colonia…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="pl-8 bg-white shadow-md text-sm h-9"
        />
      </div>
      {results.length > 0 && (
        <div className="mt-1 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden">
          {results.map(f => (
            <button
              key={f.properties.id}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm border-b border-gray-100 last:border-0"
              onClick={() => {
                setQuery('');
                flyToPredioid(f.properties.id);
              }}
            >
              <div className="font-medium text-gray-800">{f.properties.id}</div>
              <div className="text-xs text-gray-500">
                {[f.properties.colonia ?? f.properties.domicilio, f.properties.usoSuelo].filter(Boolean).join(' · ') || f.properties.propietario || ''}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sub-componente: FitBounds al cargar ──────────────────────────
// Re-ajusta siempre que cambia el geojson (necesario cuando los datos reales
// llegan después de que el mapa ya está montado).
function FitBounds({ geojson }: { geojson: PredioFeatureCollection | FeatureCollection | null }) {
  const map = useMap();
  const prevKey = useRef<string | null>(null);
  useEffect(() => {
    if (!geojson) return;
    // Identificador único basado en número de features para detectar cambios
    const key = String(geojson.features?.length ?? 0) + (geojson.features?.[0]?.properties?.id ?? '');
    if (key === prevKey.current) return;
    prevKey.current = key;
    try {
      const layer = L.geoJSON(geojson as GeoJsonObject);
      const bounds = layer.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [32, 32], maxZoom: 17 });
      }
    } catch { /* ignore */ }
  }, [geojson, map]);
  return null;
}

// ── Sub-componente: centra mapa en un feature real ───────────────
// Vuela cada vez que cambia el feature (sin bloqueo "done")
function FlyToFeature({ feature }: { feature: Feature | null }) {
  const map = useMap();
  useEffect(() => {
    if (!feature) return;
    try {
      const layer = L.geoJSON(feature);
      const bounds = layer.getBounds();
      if (bounds.isValid()) {
        map.flyToBounds(bounds, { maxZoom: 18, duration: 0.8, padding: [60, 60] });
      }
    } catch { /* ignore */ }
  }, [feature, map]);
  return null;
}

// ── Sub-componente: marcadores numerados ─────────────────────────
function NumberedMarkers({
  geojson,
  onClick,
}: {
  geojson: PredioFeatureCollection | FeatureCollection | null;
  onClick: (id: string) => void;
}) {
  const markers = useMemo(() => {
    if (!geojson?.features) return [];
    return geojson.features.map((f, i) => {
      try {
        const center = L.geoJSON(f as GeoJsonObject).getBounds().getCenter();
        const id = String((f.properties as Record<string, unknown>)?.id ?? (f.properties as Record<string, unknown>)?.cco ?? '');
        return { n: i + 1, lat: center.lat, lng: center.lng, id };
      } catch {
        return null;
      }
    }).filter(Boolean) as { n: number; lat: number; lng: number; id: string }[];
  }, [geojson]);

  return (
    <>
      {markers.map(m => {
        const icon = L.divIcon({
          className: '',
          html: `<div style="background:#1B3A5C;color:#fff;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">${m.n}</div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });
        return (
          <Marker
            key={`${m.n}-${m.id}`}
            position={[m.lat, m.lng]}
            icon={icon}
            eventHandlers={{ click: () => { if (m.id) onClick(m.id); } }}
          />
        );
      })}
    </>
  );
}

// ── Componente principal ─────────────────────────────────────────
interface MapaCatastralProps {
  geojson: PredioFeatureCollection | FeatureCollection | null;
  onPredioClick?: (id: string) => void;
  selectedId?: string | null;
  height?: string;
  /** true cuando el modo es API real */
  isReal?: boolean;
}

export function MapaCatastral({
  geojson,
  onPredioClick,
  selectedId,
  height = '480px',
  isReal = false,
}: MapaCatastralProps) {
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState('');
  const [satellite, setSatellite] = useState(false);
  const [showMarkers, setShowMarkers] = useState(false);
  const [thematic, setThematic] = useState<ThematicMode>('none');
  const [breaks, setBreaks] = useState<Record<'adeudo' | 'valor', number[]>>(DEFAULT_BREAKS);
  const [measuring, setMeasuring] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<LatLngTuple[]>([]);

  const measureDistance = useMemo(() => totalDistanceM(measurePoints), [measurePoints]);
  const measureArea = useMemo(() => polygonAreaM2(measurePoints), [measurePoints]);

  useEffect(() => { setMounted(true); }, []);

  const handleClick = onPredioClick ?? ((id: string) => navigate(`/predios/${id}`));

  // Color temático según el modo activo
  const thematicColor = (props: Record<string, unknown>): string => {
    // Exentos siempre en gris violáceo, independiente del modo temático
    if (props.estadoPredio === 'exento') return '#9F7AEA';
    if (thematic === 'estado') {
      return (props.estadoPredio === 'con_adeudo' || Number(props.adeudoMXN) > 0)
        ? ESTADO_CON_ADEUDO : ESTADO_AL_CORRIENTE;
    }
    if (thematic === 'adeudo' || thematic === 'valor') {
      const value = Number(thematic === 'adeudo' ? props.adeudoMXN : props.valorCatastralMXN) || 0;
      return THEMATIC_COLORS[bucketIndex(value, breaks[thematic])];
    }
    return '#E8913A';
  };

  const onEachFeature = (
    feature: Feature<Polygon | MultiPolygon, PredioProperties>,
    layer: Layer
  ) => {
    const props = feature.properties;
    const colonia = props.colonia ?? props.domicilio ?? '';
    const uso = props.usoSuelo ?? '';
    layer.bindTooltip(
      `<div style="font-size:12px"><b>${props.id}</b>${colonia ? `<br/>${colonia}` : ''}${uso ? `<br/>${uso}` : ''}</div>`,
      { sticky: true }
    );
    layer.on('click', () => handleClick(props.id));
  };

  const styleFeature: StyleFunction<PredioProperties> = (feature?: Feature<Geometry, PredioProperties>): PathOptions => {
    if (!feature) return {};
    const props = feature.properties as PredioProperties;
    const isSelected = props.id === selectedId;
    const color = getFeatureColor(props.usoSuelo);
    return {
      color: isSelected ? '#E8913A' : '#fff',
      weight: isSelected ? 3 : 1.5,
      fillColor: color,
      fillOpacity: isSelected ? 0.85 : 0.65,
    };
  };

  if (!mounted) {
    return (
      <div
        className="w-full rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center text-sm text-gray-500"
        style={{ height }}
      >
        Cargando mapa…
      </div>
    );
  }

  const featureCount = geojson?.features?.length ?? 0;
  const mapCenter = isReal ? SAN_CRISTOBAL_CENTER : PUEBLA_CENTER;

  // Estilo para polígonos reales (con recoloreo temático)
  const realStyle = (feature?: Feature<Geometry, PredioProperties>): PathOptions => {
    const props = (feature?.properties ?? {}) as Record<string, unknown>;
    const isSelected = props.id === selectedId || props.cco === selectedId;
    const fill = thematicColor(props);
    return {
      color: isSelected ? '#1B3A5C' : fill,
      weight: isSelected ? 3.5 : (thematic === 'none' ? 2 : 1),
      fillColor: fill,
      fillOpacity: isSelected ? 0.75 : (thematic === 'none' ? 0.4 : 0.6),
    };
  };

  // Popup "Información del predio" con datos de valor (value-on-plan)
  const buildPredioPopup = (props: Record<string, unknown>): HTMLElement => {
    const id = String(props.id ?? props.cco ?? '');
    const adeudo = Number(props.adeudoMXN) || 0;
    const valor = Number(props.valorCatastralMXN) || 0;
    const precioM2 = Number(props.precioPorM2) || 0;
    const supM2 = Number(props.superficieM2) || 0;
    const isExento = props.estadoPredio === 'exento';
    const conAdeudo = !isExento && (props.estadoPredio === 'con_adeudo' || adeudo > 0);
    const statusColor = isExento ? '#7C3AED' : (conAdeudo ? '#C62828' : '#2E7D32');
    const statusLabel = isExento ? 'Exento de predial' : (conAdeudo ? 'Con adeudo' : 'Al corriente');
    const el = document.createElement('div');
    el.style.cssText = 'font-size:12px;line-height:1.5;min-width:200px';
    el.innerHTML = `
      <div style="font-weight:700;color:#1B3A5C;margin-bottom:4px">Información del predio</div>
      <div><span style="color:#888">Clave catastral:</span> <b>${id}</b></div>
      ${props.domicilio ? `<div><span style="color:#888">Domicilio:</span> ${props.domicilio}</div>` : ''}
      ${supM2 ? `<div><span style="color:#888">Superficie:</span> ${supM2.toLocaleString('es-MX')} m²</div>` : ''}
      ${valor ? `<div><span style="color:#888">Valor catastral:</span> ${fmtMXN(valor)}</div>` : ''}
      ${precioM2 ? `<div><span style="color:#888">Precio por m²:</span> ${fmtMXN(precioM2)}</div>` : ''}
      ${!isExento ? `<div><span style="color:#888">Adeudo:</span> <b style="color:${statusColor}">${fmtMXN(adeudo)}</b></div>` : ''}
      <div style="margin-top:2px"><span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;color:#fff;background:${statusColor}">${statusLabel}</span></div>
    `;
    const btn = document.createElement('button');
    btn.textContent = 'Ver ficha completa →';
    btn.style.cssText = 'margin-top:8px;width:100%;padding:5px;border:none;border-radius:6px;background:#1B3A5C;color:#fff;font-size:11px;font-weight:600;cursor:pointer';
    btn.addEventListener('click', () => { if (id) handleClick(id); });
    el.appendChild(btn);
    return el;
  };

  return (
    <div className="space-y-2">
      {/* Leyenda */}
      <div className="flex flex-wrap gap-3 text-[11px] text-gray-600">
        {isReal ? (
          <span className="inline-flex items-center gap-1 text-orange-600 font-medium">
            <Satellite className="w-3.5 h-3.5" />
            Polígono real — municipio 078 San Cristóbal de las Casas
          </span>
        ) : null}
        {isReal && (
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => {
                setMeasuring(m => {
                  if (m) setMeasurePoints([]);
                  return !m;
                });
              }}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                measuring
                  ? 'bg-[#E8913A] text-white border-[#E8913A]'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Ruler className="w-3 h-3" />
              {measuring ? 'Midiendo…' : 'Medir'}
            </button>
            <button
              onClick={() => setShowMarkers(s => !s)}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                showMarkers
                  ? 'bg-[#1B3A5C] text-white border-[#1B3A5C]'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Hash className="w-3 h-3" />
              {showMarkers ? 'Marcadores activos' : 'Numerar predios'}
            </button>
            <button
              onClick={() => setSatellite(s => !s)}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                satellite
                  ? 'bg-gray-800 text-white border-gray-700'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Satellite className="w-3 h-3" />
              {satellite ? 'Satélite activo' : 'Ver satélite'}
            </button>
          </div>
        )}
        <span className="inline-flex items-center gap-1">
          <MapPin className="w-3.5 h-3.5 text-[#1B3A5C]" />
          {featureCount} predio{featureCount !== 1 ? 's' : ''}{!isReal ? ' demo' : ' · API real'}
        </span>
        {!isReal && (
          <span className="flex gap-2 ml-auto flex-wrap">
            {Object.entries(USO_SUELO_COLORS).slice(0, 4).map(([label, color]) => (
              <span key={label} className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
                {label}
              </span>
            ))}
          </span>
        )}
      </div>

      {/* Panel de Mapas temáticos (solo modo real) */}
      {isReal && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#1B3A5C]">
              <Layers className="w-4 h-4" /> Mapas temáticos
            </span>
            {([
              ['none', 'Ninguno'],
              ['adeudo', 'Por adeudo'],
              ['valor', 'Por valor catastral'],
              ['estado', 'Por estado'],
            ] as [ThematicMode, string][]).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => setThematic(mode)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                  thematic === mode
                    ? 'bg-[#1B3A5C] text-white border-[#1B3A5C]'
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Definición de rangos (máx. 4) + leyenda */}
          {(thematic === 'adeudo' || thematic === 'valor') && (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
                <span className="font-medium">Definición de rangos (máx. 4):</span>
                {breaks[thematic].map((b, i) => (
                  <input
                    key={i}
                    type="number"
                    value={b}
                    onChange={e => {
                      const v = Number(e.target.value);
                      setBreaks(prev => {
                        const arr = [...prev[thematic]];
                        arr[i] = v;
                        return { ...prev, [thematic]: arr };
                      });
                    }}
                    className="w-24 px-2 py-1 rounded border border-gray-300 text-xs"
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-3 text-[11px] text-gray-700">
                {rangeLabels(breaks[thematic]).map((label, i) => (
                  <span key={i} className="inline-flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: THEMATIC_COLORS[i] }} />
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}
          {thematic === 'estado' && (
            <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-gray-700">
              <span className="inline-flex items-center gap-1">
                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: ESTADO_AL_CORRIENTE }} />
                Al corriente
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: ESTADO_CON_ADEUDO }} />
                Con adeudo
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#9F7AEA' }} />
                Exento
              </span>
            </div>
          )}
        </div>
      )}

      {/* Mapa */}
      <div
        className="w-full rounded-lg overflow-hidden border border-gray-200 relative"
        style={{ height }}
      >
        <MapContainer
          center={mapCenter}
          zoom={DEFAULT_ZOOM}
          scrollWheelZoom
          style={{ height: '100%', width: '100%' }}
        >
          {satellite ? (
            <TileLayer
              attribution='Imagery &copy; <a href="https://www.esri.com">Esri</a>'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maxZoom={19}
            />
          ) : (
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          )}
          {/* Todos los polígonos (real o demo) */}
          {geojson && (
            <>
              <FitBounds geojson={geojson as PredioFeatureCollection} />
              <GeoJSON
                key={`${isReal ? 'real' : 'demo'}-${selectedId ?? 'none'}-${featureCount}-${thematic}-${breaks.adeudo.join()}-${breaks.valor.join()}-${measuring ? 'meas' : ''}`}
                data={geojson}
                style={isReal ? realStyle : styleFeature}
                onEachFeature={isReal
                  ? (feat, layer) => {
                      const props = feat.properties as Record<string, string | number>;
                      const id = (props.id ?? props.cco ?? '') as string;
                      const adeudo = props.adeudoMXN
                        ? ` · ${fmtMXN(Number(props.adeudoMXN))}`
                        : '';
                      if (!measuring) {
                        layer.bindTooltip(
                          `<div style="font-size:12px;line-height:1.4">
                            <b>${id}</b>${adeudo}<br/>
                            <span style="color:#888;font-size:10px">Click para ver detalle</span>
                          </div>`,
                          { sticky: true }
                        );
                        layer.bindPopup(() => buildPredioPopup(props), { maxWidth: 260 });
                        layer.on('mouseover', () => (layer as L.Path).setStyle({ weight: 3 }));
                        layer.on('mouseout', () => (layer as L.Path).setStyle({ weight: thematic === 'none' ? 2 : 1 }));
                      } else {
                        // En modo medición: sin tooltip, sin popup, sin click
                        (layer as L.Path).options.interactive = false;
                      }
                    }
                  : (feat, layer) => {
                      if (!measuring) onEachFeature(feat as Parameters<typeof onEachFeature>[0], layer);
                      else (layer as L.Path).options.interactive = false;
                    }
                }
              />
              {showMarkers && (
                <NumberedMarkers geojson={geojson} onClick={handleClick} />
              )}
            </>
          )}
          <MeasureLayer active={measuring} points={measurePoints} setPoints={setMeasurePoints} />
          <MapSearchControl
            geojson={geojson}
            query={query}
            setQuery={setQuery}
          />
        </MapContainer>

        {/* Panel de medición */}
        {measuring && (
          <div className="absolute bottom-3 left-3 z-[1000] bg-white rounded-lg shadow-lg border border-gray-200 p-3 text-xs w-56">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-semibold text-[#1B3A5C] inline-flex items-center gap-1">
                <Ruler className="w-3.5 h-3.5" /> Medición
              </span>
              <button
                onClick={() => setMeasurePoints([])}
                className="text-gray-400 hover:text-gray-700 inline-flex items-center gap-0.5"
                title="Limpiar"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {measurePoints.length < 2 ? (
              <p className="text-gray-500">Haz clic en el mapa para agregar puntos.</p>
            ) : (
              <div className="space-y-1 text-gray-700">
                <div className="flex justify-between">
                  <span className="text-gray-500">Distancia:</span>
                  <b>{fmtDistance(measureDistance)}</b>
                </div>
                {measurePoints.length >= 3 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Área:</span>
                    <b>{fmtArea(measureArea)}</b>
                  </div>
                )}
                <div className="text-[10px] text-gray-400 pt-0.5">{measurePoints.length} puntos</div>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="text-[10px] text-gray-400 text-center">
        {isReal
          ? 'Polígono catastral real · Fuente: API municipio 078 · Solo lectura'
          : 'Polígonos ficticios — Katastik MVP · no usar como referencia legal'}
      </p>
    </div>
  );
}

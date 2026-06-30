/**
 * PredioMapaWidget
 * Visor 2D / 3D / Croquis para la ficha de un predio real.
 *
 * Tabs:
 *   "2d"     – mini Leaflet con el polígono + satélite toggle
 *   "3d"     – Three.js ExtrudeGeometry desde datos Q3D reales + orbit drag
 *   "croquis"– PNG oficial vía proxy
 */
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import * as THREE from 'three';
import { Map, Box, Image, Satellite, Maximize2, Loader2, RotateCcw } from 'lucide-react';
import { getPropertyGeometry, getCroquisUrl } from '@/lib/catastroClient';

// ── Types ──────────────────────────────────────────────────────────────────
type Tab = '2d' | '3d' | 'croquis';

interface ThreeDData {
  cco: string;
  ring: [number, number][];      // scene-unit offsets from baseExtent center
  baseExtent: [number, number, number, number];
  areaDeclaredM2: number | null;
  zExaggeration: number;
  color: string;                 // e.g. "0x7ebcd8"
}

interface Props {
  predioId: string;
  area?: string;
}

// ── Fetch 3D data ──────────────────────────────────────────────────────────
async function fetch3DData(id: string): Promise<ThreeDData> {
  const res = await fetch(`/api/properties/${encodeURIComponent(id)}/3d-data`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<ThreeDData>;
}

// ── Three.js viewer ────────────────────────────────────────────────────────
function build3DScene(canvas: HTMLCanvasElement, data: ThreeDData): () => void {
  const W = canvas.clientWidth  || canvas.offsetWidth  || 480;
  const H = canvas.clientHeight || canvas.offsetHeight || 280;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setSize(W, H, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0xf5f7fa);
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 2000);

  // ── Scale the ring to real-world metres ───────────────────────────────
  const ring = data.ring;
  let scaleCorrection = 1;
  if (data.areaDeclaredM2 && data.areaDeclaredM2 > 0) {
    let rawArea = 0;
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      rawArea += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
    }
    rawArea = Math.abs(rawArea / 2);
    scaleCorrection = Math.sqrt(rawArea / data.areaDeclaredM2);
  }
  const pts2D = ring.map(([dx, dy]) => [dx / scaleCorrection, dy / scaleCorrection] as [number, number]);

  // Centre the shape at origin
  const cx = pts2D.reduce((s, p) => s + p[0], 0) / pts2D.length;
  const cy = pts2D.reduce((s, p) => s + p[1], 0) / pts2D.length;

  const shape = new THREE.Shape();
  pts2D.forEach(([x, y], i) => {
    if (i === 0) shape.moveTo(x - cx, y - cy);
    else shape.lineTo(x - cx, y - cy);
  });
  shape.closePath();

  // Building height: ~3.5 m per floor, 1 floor minimum
  const floorH = Math.max(3.5, Math.sqrt(data.areaDeclaredM2 ?? 100) * 0.12);
  const extrudeH = floorH * data.zExaggeration;

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: extrudeH,
    bevelEnabled: false,
  });
  geo.rotateX(-Math.PI / 2); // lay flat on XZ
  geo.computeVertexNormals();

  const colorHex = parseInt(data.color.replace('0x', ''), 16);
  const mat = new THREE.MeshLambertMaterial({ color: colorHex });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  // Wireframe outline
  const edges = new THREE.EdgesGeometry(geo);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x1b3a5c, linewidth: 1 });
  scene.add(new THREE.LineSegments(edges, lineMat));

  // Ground plane
  const box = new THREE.Box3().setFromObject(mesh);
  const size = new THREE.Vector3();
  box.getSize(size);
  const groundGeo = new THREE.PlaneGeometry(size.x * 4, size.z * 4);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0xdde8d0 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  scene.add(ground);

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const sun = new THREE.DirectionalLight(0xfff5e0, 1.2);
  sun.position.set(size.x * 2, size.y * 4, size.z * 2);
  sun.castShadow = true;
  scene.add(sun);

  // Camera initial position: oblique top-down from south-east
  const dist = Math.max(size.x, size.z) * 2.2;
  camera.position.set(dist, dist * 0.8, dist);
  camera.lookAt(0, extrudeH / 2, 0);

  // ── Orbit controls (manual, no import) ─────────────────────────────────
  let isDragging = false;
  let prevMouse = { x: 0, y: 0 };
  let spherical = { theta: Math.PI / 4, phi: Math.PI / 3, radius: dist * 1.5 };

  const updateCamera = () => {
    camera.position.set(
      spherical.radius * Math.sin(spherical.phi) * Math.sin(spherical.theta),
      spherical.radius * Math.cos(spherical.phi),
      spherical.radius * Math.sin(spherical.phi) * Math.cos(spherical.theta)
    );
    camera.lookAt(0, extrudeH / 2, 0);
  };
  updateCamera();

  const onMouseDown = (e: MouseEvent) => { isDragging = true; prevMouse = { x: e.clientX, y: e.clientY }; };
  const onMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - prevMouse.x;
    const dy = e.clientY - prevMouse.y;
    spherical.theta -= dx * 0.01;
    spherical.phi = Math.max(0.1, Math.min(Math.PI / 2, spherical.phi + dy * 0.01));
    prevMouse = { x: e.clientX, y: e.clientY };
    updateCamera();
  };
  const onMouseUp = () => { isDragging = false; };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    spherical.radius = Math.max(size.x * 0.8, Math.min(size.x * 8, spherical.radius + e.deltaY * 0.15));
    updateCamera();
  };
  // Touch support
  let prevTouch: Touch | null = null;
  const onTouchStart = (e: TouchEvent) => { prevTouch = e.touches[0]; };
  const onTouchMove = (e: TouchEvent) => {
    if (!prevTouch) return;
    const t = e.touches[0];
    const dx = t.clientX - prevTouch.clientX;
    const dy = t.clientY - prevTouch.clientY;
    spherical.theta -= dx * 0.01;
    spherical.phi = Math.max(0.1, Math.min(Math.PI / 2, spherical.phi + dy * 0.01));
    prevTouch = t;
    updateCamera();
  };

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('touchstart', onTouchStart);
  canvas.addEventListener('touchmove', onTouchMove);

  // ── Render loop ─────────────────────────────────────────────────────────
  let frameId = 0;
  const render = () => {
    frameId = requestAnimationFrame(render);
    renderer.render(scene, camera);
  };
  render();

  // ── Cleanup ──────────────────────────────────────────────────────────────
  return () => {
    cancelAnimationFrame(frameId);
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('touchstart', onTouchStart);
    canvas.removeEventListener('touchmove', onTouchMove);
    renderer.dispose();
    geo.dispose();
    mat.dispose();
    edges.dispose();
    lineMat.dispose();
    groundGeo.dispose();
    groundMat.dispose();
  };
}

// ── Component ────────────────────────────────────────────────────────────────
export function PredioMapaWidget({ predioId, area }: Props) {
  const [tab, setTab] = useState<Tab>('2d');
  const [satellite, setSatellite] = useState(false);
  const [loading2d, setLoading2d] = useState(true);
  const [error2d, setError2d] = useState<string | null>(null);
  const [loading3d, setLoading3d] = useState(false);
  const [error3d, setError3d] = useState<string | null>(null);
  const [threeData, setThreeData] = useState<ThreeDData | null>(null);
  const [croquisOk, setCroquisOk] = useState(true);

  // 2D Leaflet refs
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const geojsonLayerRef = useRef<L.GeoJSON | null>(null);

  // 3D canvas ref
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const threeCleanupRef = useRef<(() => void) | null>(null);

  // ── Init Leaflet map ───────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || leafletRef.current) return;
    const map = L.map(mapRef.current, { zoomControl: true, attributionControl: false });
    leafletRef.current = map;
    const tile = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20 }).addTo(map);
    tileRef.current = tile;

    // Load geometry with one automatic retry (in case the API cache is still warming)
    const loadGeometry = (attempt = 0) => {
      getPropertyGeometry(predioId)
        .then(feat => {
          if (!feat) {
            if (attempt === 0) { setTimeout(() => loadGeometry(1), 4000); return; }
            setError2d('Sin geometría disponible');
            setLoading2d(false);
            return;
          }
          const layer = L.geoJSON(feat as GeoJSON.GeoJsonObject, {
            style: { color: '#E8913A', weight: 3, fillColor: '#E8913A', fillOpacity: 0.3 },
          }).addTo(map);
          geojsonLayerRef.current = layer;
          const b = layer.getBounds();
          if (b.isValid()) map.fitBounds(b, { padding: [32, 32], maxZoom: 19 });
          setLoading2d(false);
        })
        .catch(() => {
          if (attempt === 0) { setTimeout(() => loadGeometry(1), 4000); return; }
          setError2d('Error cargando geometría');
          setLoading2d(false);
        });
    };
    loadGeometry();

    return () => { map.remove(); leafletRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [predioId]);

  // ── Satellite toggle ───────────────────────────────────────────────────
  useEffect(() => {
    const map = leafletRef.current;
    if (!map || !tileRef.current) return;
    tileRef.current.remove();
    const url = satellite
      ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
      : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    tileRef.current = L.tileLayer(url, { maxZoom: 20 }).addTo(map);
    geojsonLayerRef.current?.bringToFront();
  }, [satellite]);

  // ── Fetch 3D data when tab switches to '3d' ────────────────────────────
  useEffect(() => {
    if (tab !== '3d' || threeData) return;
    setLoading3d(true);
    setError3d(null);
    fetch3DData(predioId)
      .then(d => { setThreeData(d); setLoading3d(false); })
      .catch(() => { setError3d('Error cargando datos 3D'); setLoading3d(false); });
  }, [tab, predioId, threeData]);

  // ── Init Three.js scene once data + canvas are ready ──────────────────
  useEffect(() => {
    if (tab !== '3d' || !threeData || !canvasRef.current) return;
    threeCleanupRef.current?.();
    threeCleanupRef.current = build3DScene(canvasRef.current, threeData);
    return () => { threeCleanupRef.current?.(); threeCleanupRef.current = null; };
  }, [tab, threeData]);

  const resetCamera = () => {
    // Re-mount Three.js scene to reset orbit
    if (!threeData || !canvasRef.current) return;
    threeCleanupRef.current?.();
    threeCleanupRef.current = build3DScene(canvasRef.current, threeData);
  };

  const TABS: [Tab, React.ReactNode, string][] = [
    ['2d',     <Map className="w-3.5 h-3.5" />,  'Plano 2D'],
    ['3d',     <Box className="w-3.5 h-3.5" />,  'Vista 3D'],
    ['croquis',<Image className="w-3.5 h-3.5" />, 'Croquis'],
  ];

  return (
    <div className="mt-5 pt-5 border-t border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Cartografía del predio
        </h3>
        {area && <span className="text-xs text-gray-400">{area}</span>}
      </div>

      {/* Tab selector */}
      <div className="flex gap-1 mb-3">
        {TABS.map(([t, icon, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
              tab === t
                ? 'bg-[#1B3A5C] text-white border-[#1B3A5C]'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {/* ── 2D panel ─────────────────────────────────────────────────── */}
      <div className={tab === '2d' ? 'block' : 'hidden'}>
        <div className="relative rounded-lg overflow-hidden border border-gray-200" style={{ height: 280 }}>
          {loading2d && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-50">
              <Loader2 className="w-6 h-6 animate-spin text-[#1B3A5C]" />
            </div>
          )}
          {error2d && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-50 text-sm text-gray-400">
              {error2d}
            </div>
          )}
          <div ref={mapRef} style={{ height: '100%', width: '100%' }} />
          {!loading2d && !error2d && (
            <div className="absolute top-2 right-2 z-[1000] flex flex-col gap-1">
              <button
                onClick={() => setSatellite(s => !s)}
                title={satellite ? 'Ver mapa base' : 'Ver satélite'}
                className={`p-1.5 rounded shadow border transition-colors ${
                  satellite ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-600 border-gray-300'
                }`}
              >
                <Satellite className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => mapRef.current?.requestFullscreen?.()}
                title="Pantalla completa"
                className="p-1.5 rounded shadow bg-white text-gray-600 border border-gray-300"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
        <p className="text-[10px] text-gray-400 mt-1.5">
          Polígono catastral real · EPSG:32615 → WGS84 · Solo lectura
        </p>
      </div>

      {/* ── 3D panel ─────────────────────────────────────────────────── */}
      <div className={tab === '3d' ? 'block' : 'hidden'}>
        <div className="relative rounded-lg overflow-hidden border border-gray-200 bg-[#f5f7fa]" style={{ height: 280 }}>
          {loading3d && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#f5f7fa]">
              <Loader2 className="w-6 h-6 animate-spin text-[#1B3A5C]" />
            </div>
          )}
          {error3d && (
            <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-gray-400">
              {error3d}
            </div>
          )}
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: '100%', display: 'block', cursor: 'grab' }}
          />
          {!loading3d && !error3d && threeData && (
            <div className="absolute top-2 right-2 z-10 flex flex-col gap-1">
              <button
                onClick={resetCamera}
                title="Restablecer cámara"
                className="p-1.5 rounded shadow bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => canvasRef.current?.requestFullscreen?.()}
                title="Pantalla completa"
                className="p-1.5 rounded shadow bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {!loading3d && !error3d && (
            <div className="absolute bottom-2 left-2 text-[10px] text-gray-400 pointer-events-none">
              Arrastra para rotar · Scroll para zoom
            </div>
          )}
        </div>
        <p className="text-[10px] text-gray-400 mt-1.5">
          Vista 3D extruida · Datos Q3D reales · Fuente: API municipio 078
        </p>
      </div>

      {/* ── Croquis panel ────────────────────────────────────────────── */}
      <div className={tab === 'croquis' ? 'block' : 'hidden'}>
        {croquisOk ? (
          <div className="rounded-lg border border-gray-200 overflow-hidden bg-white flex items-center justify-center" style={{ minHeight: 200 }}>
            <img
              src={getCroquisUrl(predioId)}
              alt={`Croquis catastral ${predioId}`}
              className="w-full object-contain"
              style={{ maxHeight: 300 }}
              onError={() => setCroquisOk(false)}
            />
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center text-sm text-gray-400" style={{ height: 160 }}>
            Croquis no disponible para este predio
          </div>
        )}
        <p className="text-[10px] text-gray-400 mt-1.5">
          Croquis oficial · Fuente: API municipio 078
        </p>
      </div>
    </div>
  );
}

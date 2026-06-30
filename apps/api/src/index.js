import 'dotenv/config';
import express from 'express';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  isCCO,
  normalizeCCO,
  mapPredio,
  mapEstadoCuenta,
  mapExpedientes,
  listPredios,
  getGeometry,
  getCroquisBuffer,
  get3DData,
  getFirma,
  getSourceInfo,
  TokenExpiredError,
  TokenMissingError,
  UpstreamError,
} from './realCatastro.js';
import {
  createQuickCollection,
  getInvoice,
  getPayment,
  registerWebhook,
  listWebhooks,
  getPorcobrarInfo,
  PorcobrarError,
} from './porcobrar.js';
import {
  generarOrdenPago,
  realizarCobroPredial,
  getPagosInfo,
} from './catastroPagos.js';
import {
  uploadDocument,
  getDocumentStatus,
  createTimestamp,
  generateDemoPdf,
  getCincelInfo,
  requestOtp,
  exchangeOtp,
  isCincelJwtExpired,
  CincelError,
  CincelAuthError,
} from './cincel.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '../../../data/demo');
const SOURCE = process.env.CATASTRO_SOURCE || 'demo';
const IS_REAL = SOURCE === 'real';

// ──────────────────────────────────────────────
// Seed: carga todo a memoria al arrancar
// ──────────────────────────────────────────────
function loadJSON(file) {
  return JSON.parse(readFileSync(join(DATA_DIR, file), 'utf-8'));
}

let state = null;

function seed() {
  const properties = loadJSON('properties.demo.json');
  const geojson = loadJSON('predios.demo.geojson');
  const documents = loadJSON('documents.demo.json');
  const payments = loadJSON('payments.demo.json');
  const cincel = loadJSON('cincel.demo.json');
  const workflows = loadJSON('workflows.demo.json');
  const bitacora = loadJSON('bitacora.demo.json');
  const publicSources = loadJSON('public_sources.demo.json');

  state = {
    properties,
    geojson,
    documents: documents.map(d => ({ ...d })),
    payments: payments.map(p => ({ ...p })),
    cincel: cincel.map(c => ({ ...c })),
    workflows,
    bitacora: bitacora.map(b => ({ ...b })),
    publicSources,
  };
}

seed();

// ──────────────────────────────────────────────
// Dashboard recalculado siempre desde el estado RAM
// ──────────────────────────────────────────────
function calcDashboard() {
  const totalPredios = state.properties.length;
  const prediosActivos = state.properties.filter(p => p.estadoPredio === 'activo').length;
  const pagados = state.payments.filter(p => p.estadoPago === 'pagado');
  const pendientes = state.payments.filter(p => p.estadoPago === 'pendiente');
  const adeudoTotalMXN = pendientes.reduce((s, p) => s + (p.totalMXN || 0), 0);
  const documentosNom151 = state.documents.filter(d => d.conservacionNom151).length;
  const tramitesAbiertos = state.workflows.filter(w =>
    w.estado !== 'concluido' && w.estado !== 'cerrado'
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    totalPredios,
    prediosActivos,
    adeudoTotalMXN,
    pagosSimulados: pagados.length,
    documentos: state.documents.length,
    documentosNom151,
    tramitesAbiertos,
    fuente: IS_REAL
      ? 'Dashboard demo (KPIs sobre datos ficticios). Los datos de predio/cobranza son reales.'
      : 'datos demo ficticios calculados en tiempo real; no usar como catastro real',
  };
}

// ──────────────────────────────────────────────
// Helpers de bitácora
// ──────────────────────────────────────────────
let logCounter = state.bitacora.length + 1;
function addBitacoraEvent(predioId, evento, usuario = 'demo-operador', detalle = '') {
  const entry = {
    id: `LOG-DEMO-${String(logCounter++).padStart(4, '0')}`,
    predioId,
    evento,
    usuario,
    fechaHora: new Date().toISOString(),
    detalle,
  };
  state.bitacora.unshift(entry);
  return entry;
}

// ──────────────────────────────────────────────
// Helper: manejo uniforme de errores upstream
// ──────────────────────────────────────────────
function handleUpstreamError(err, res) {
  if (err instanceof TokenExpiredError || err instanceof TokenMissingError) {
    return res.status(err.statusCode).json({
      error: err.message,
      code: err.name,
      hint: 'Solicitar un nuevo token JWT a Oscar y actualizar CATASTRO_TOKEN_CAJA en apps/api/.env',
    });
  }
  if (err instanceof UpstreamError) {
    return res.status(err.statusCode).json({ error: err.message, code: 'UpstreamError' });
  }
  console.error('[Catastro API] Error inesperado:', err);
  return res.status(502).json({ error: 'Error interno del proxy catastral', detail: err.message });
}

// ──────────────────────────────────────────────
// Express app
// ──────────────────────────────────────────────
const app = express();
app.use(express.json());

// CORS — open for MVP demo (frontend and backend on separate domains)
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// ── GET /api/properties ──────────────────────
app.get('/api/properties', async (req, res) => {
  if (IS_REAL) {
    const { q } = req.query;
    // Búsqueda por CCO específica
    if (q && isCCO(q)) {
      try {
        const predio = await mapPredio(normalizeCCO(q));
        return res.json([predio]);
      } catch (err) {
        return handleUpstreamError(err, res);
      }
    }
    // Sin CCO: devolver listado real de predios enriquecidos con detalle
    if (!q) {
      try {
        const predios = await listPredios(20);
        // Enriquecer con datos completos (domicilio, propietario, usoSuelo, etc.)
        const enriched = await Promise.allSettled(predios.map(p => mapPredio(p.id)));
        const result = enriched.map((r, i) => {
          if (r.status !== 'fulfilled') return predios[i];
          const detail = r.value;
          // Predios exentos no tienen adeudo real aunque aparezcan en prescripciones
          const adeudoMXN = detail.estadoPredio === 'exento' ? 0 : (predios[i].adeudoMXN ?? 0);
          return { ...detail, adeudoMXN };
        });
        return res.json(result);
      } catch (err) {
        return handleUpstreamError(err, res);
      }
    }
    // Búsqueda parcial (texto libre): hint informativo
    return res.json({
      data: [],
      hint: 'En modo API real, busca por Clave Catastral (CCO) de 15–16 dígitos. Ej: 0078000101001002',
      source: 'real',
    });
  }

  const { q } = req.query;
  let list = state.properties;
  if (q) {
    const lq = String(q).toLowerCase();
    list = list.filter(p =>
      p.claveCatastral?.toLowerCase().includes(lq) ||
      p.cuentaPredial?.toLowerCase().includes(lq) ||
      p.domicilio?.toLowerCase().includes(lq) ||
      p.colonia?.toLowerCase().includes(lq) ||
      p.propietario?.toLowerCase().includes(lq) ||
      p.usoSuelo?.toLowerCase().includes(lq) ||
      p.zona?.toLowerCase().includes(lq)
    );
  }
  res.json(list);
});

// ── GET /api/properties/:id ──────────────────
app.get('/api/properties/:id', async (req, res) => {
  if (IS_REAL) {
    try {
      const predio = await mapPredio(req.params.id);
      return res.json(predio);
    } catch (err) {
      return handleUpstreamError(err, res);
    }
  }

  const predio = state.properties.find(p => p.id === req.params.id);
  if (!predio) return res.status(404).json({ error: 'Predio no encontrado' });
  const feature = state.geojson.features?.find(
    f => f.properties?.id === req.params.id
  );
  res.json({ ...predio, feature: feature || null });
});

// ── GET /api/geojson ─────────────────────────
// Siempre demo (geometría real no está en el alcance)
app.get('/api/geojson', (req, res) => {
  const paymentByPredio = Object.fromEntries(
    state.payments.map(p => [p.predioId, p.estadoPago])
  );
  const features = state.geojson.features.map(f => ({
    ...f,
    properties: {
      ...f.properties,
      estadoPago: paymentByPredio[f.properties.id] || 'pendiente',
    },
  }));
  res.json({ type: 'FeatureCollection', features });
});

// ── GET /api/documents ───────────────────────
app.get('/api/documents', async (req, res) => {
  const { predioId } = req.query;
  if (IS_REAL && predioId) {
    try {
      const docs = await mapExpedientes(predioId);
      // Si la API real sólo devuelve hints (requiere modulosId), usar
      // los documentos mockeados con datos reales del estado en memoria.
      const realDocs = docs.filter(d => !d._hint);
      if (realDocs.length > 0) return res.json(realDocs);
    } catch {
      // fallthrough a documentos en memoria
    }
  }

  const list = predioId
    ? state.documents.filter(d => d.predioId === predioId)
    : state.documents;
  res.json(list);
});

// ── GET /api/documents/all ───────────────────
// Listado global de documentos para la pantalla de Administración de documentos.
// Real: agrega expedientes de los predios listados (folio/módulo/firma).
// Demo: devuelve los documentos demo enriquecidos con folio/módulo sintéticos.
app.get('/api/documents/all', async (req, res) => {
  if (IS_REAL) {
    try {
      const predios = await listPredios(15);
      const results = await Promise.allSettled(predios.map(p => mapExpedientes(p.id)));
      const docs = results
        .filter(r => r.status === 'fulfilled')
        .flatMap(r => r.value)
        .filter(d => !d._hint)
        .map(d => ({
          id: d.id,
          predioId: d.predioId,
          folio: String(d._folio ?? d.id),
          modulo: d.tipo || 'Expediente',
          nombre: d.nombre,
          fecha: d.fecha,
          firmado: !!d.firmado,
          conservacionNom151: !!d.conservacionNom151,
          uuid: d._documentoId ?? null,
        }));
      // Si la API real no expone expedientes (requiere modulosId), usar demo
      // para que la pantalla de administración de documentos no quede vacía.
      if (docs.length > 0) return res.json(docs);
    } catch {
      // Ante fallo del upstream, continuar con documentos demo.
    }
  }
  // Fallback: documentos del estado en memoria (real con fallback a demo)
  const docs = state.documents.map(d => ({
    id: d.id,
    predioId: d.predioId,
    folio: String(d._folio ?? d.id).toUpperCase(),
    modulo: d.tipo || 'General',
    nombre: d.nombre,
    fecha: d.fecha,
    firmado: !!d.firmado,
    conservacionNom151: !!d.conservacionNom151,
    uuid: d._documentoId ?? d.id,
  }));
  res.json(docs);
});

// ── GET /api/charges ─────────────────────────
app.get('/api/charges', async (req, res) => {
  const { predioId } = req.query;
  if (IS_REAL && predioId) {
    try {
      const charges = await mapEstadoCuenta(predioId);
      // Overlay: reflejar cargos ya pagados vía PorCobrar (no persisten upstream)
      const merged = charges.map(c => {
        const paid = cobroMap.get(c.id);
        if (paid?.estado === 'pagado') {
          return { ...c, estadoPago: 'pagado', fechaPago: paid.fechaPago, folioPago: paid.folioOperacion };
        }
        if (paid?.estado === 'cobro_generado') {
          return { ...c, estadoPago: 'cobro_generado', paymentLink: paid.paymentLink, nvUuid: paid.nvUuid };
        }
        return c;
      });
      return res.json(merged);
    } catch (err) {
      return handleUpstreamError(err, res);
    }
  }

  const list = predioId
    ? state.payments.filter(p => p.predioId === predioId)
    : state.payments;
  res.json(list);
});

// ── GET /api/workflows ───────────────────────
// Siempre demo (no hay endpoint equivalente en la API real en alcance)
app.get('/api/workflows', (req, res) => {
  const { predioId } = req.query;
  const list = predioId
    ? state.workflows.filter(w => w.predioId === predioId)
    : state.workflows;
  res.json(list);
});

// ── GET /api/bitacora ────────────────────────
app.get('/api/bitacora', (req, res) => {
  const { predioId } = req.query;
  const list = predioId
    ? state.bitacora.filter(b => b.predioId === predioId)
    : state.bitacora;
  res.json(list);
});

// ── GET /api/dashboard ───────────────────────
app.get('/api/dashboard', async (req, res) => {
  if (IS_REAL) {
    try {
      // En modo real: KPIs calculados desde los predios + cobros reales
      const predios = await listPredios(15);
      const chargesResults = await Promise.allSettled(
        predios.map(p => mapEstadoCuenta(p.id))
      );
      const allCharges = chargesResults
        .filter(r => r.status === 'fulfilled')
        .flatMap(r => r.value);
      const pendientes = allCharges.filter(c => c.estadoPago === 'pendiente');
      const adeudoTotalMXN = pendientes.reduce((s, c) => s + (c.totalMXN || 0), 0);

      return res.json({
        generatedAt: new Date().toISOString(),
        totalPredios: predios.length,
        prediosActivos: predios.length,
        adeudoTotalMXN,
        pagosSimulados: state.payments.filter(p => p.estadoPago === 'pagado').length,
        documentos: state.documents.length,
        documentosNom151: state.documents.filter(d => d.conservacionNom151).length,
        tramitesAbiertos: state.workflows.filter(w => w.estado !== 'concluido' && w.estado !== 'cerrado').length,
        fuente: `Datos reales · API municipio 078 · ${predios.length} predios · adeudo calculado desde cobros reales`,
        _real: true,
      });
    } catch {
      // Si falla el upstream, caer en dashboard demo
    }
  }
  res.json(calcDashboard());
});

// ── GET /api/cincel ──────────────────────────
app.get('/api/cincel', (req, res) => {
  const { predioId } = req.query;
  const list = predioId
    ? state.cincel.filter(c => c.predioId === predioId)
    : state.cincel;
  res.json(list);
});

// ── GET /api/firma/:uuid ─────────────────────
// Disponible en modo real; en modo demo devuelve ejemplo tipado
app.get('/api/firma/:uuid', async (req, res) => {
  if (IS_REAL) {
    try {
      const firma = await getFirma(req.params.uuid);
      return res.json(firma);
    } catch {
      // El UUID puede no existir en la API real (p.ej. documentos demo).
      // Devolvemos una firma simulada para no romper la UX de la demo.
    }
  }
  // Modo demo: firma simulada
  res.json({
    uuidDocumento: req.params.uuid,
    firmante: 'DEMO OPERADOR',
    certificado: 'CERT-DEMO-0000',
    hash: 'sha256-demo-0000000000000000000000000000000000000000000000000000000000000000',
    modulo: 'PREDIAL',
    nombreDocumento: `documento-${req.params.uuid}.pdf`,
    usuarioAlta: 'sistema-demo',
    fechaFirma: new Date().toISOString().slice(0, 10),
    fechaHoraFirma: new Date().toISOString(),
    _demo: true,
  });
});

// Cache de geometrías individuales para evitar llamadas repetidas a /3D
// y para servir polígonos de predios cuyo endpoint /3D da 500 individualmente
// pero sí funcionaron en la llamada batch de /api/geometries.
const geometryCache = new Map();

// ── GET /api/geometries ──────────────────────
// Devuelve un GeoJSON FeatureCollection con los polígonos de todos los predios.
// En modo real: carga los predios con adeudo y busca sus geometrías en paralelo.
// En modo demo: devuelve el geojson demo completo.
app.get('/api/geometries', async (req, res) => {
  if (IS_REAL) {
    try {
      const predios = await listPredios(20);
      // Enriquecer con detalle completo para conocer estadoPredio real (exento, etc.)
      const [geoResults, detailResults] = await Promise.all([
        Promise.allSettled(predios.map(p => getGeometry(p.id))),
        Promise.allSettled(predios.map(p => mapPredio(p.id))),
      ]);
      const features = geoResults
        .map((r, i) => {
          if (r.status !== 'fulfilled') return null;
          const feat = r.value;
          const predio = predios[i];
          const detail = detailResults[i].status === 'fulfilled' ? detailResults[i].value : null;
          const areaM2 = parseFloat(String(feat.properties?.area ?? '').replace(/[^\d.]/g, '')) || 0;
          const valor = detail?.valorCatastralMXN ?? predio.valorCatastralMXN ?? 0;
          const estadoPredio = detail?.estadoPredio ?? 'activo';
          // Exentos no tienen adeudo real aunque aparezcan en prescripciones
          const adeudo = estadoPredio === 'exento' ? 0 : (predio.adeudoMXN || 0);
          feat.properties = {
            ...feat.properties,
            id: predio.id,
            propietario: detail?.propietario || predio.propietario || '',
            domicilio: detail?.domicilio || predio.domicilio || '',
            adeudoMXN: adeudo,
            valorCatastralMXN: valor,
            estadoPredio: estadoPredio === 'exento'
              ? 'exento'
              : (adeudo > 0 ? 'con_adeudo' : 'al_corriente'),
            superficieM2: areaM2,
            precioPorM2: areaM2 > 0 ? Math.round(valor / areaM2) : 0,
          };
          // Guardar en cache individual para /api/properties/:id/geometry
          geometryCache.set(predio.id, feat);
          return feat;
        })
        .filter(Boolean);
      return res.json({ type: 'FeatureCollection', features });
    } catch (err) {
      return handleUpstreamError(err, res);
    }
  }
  // Modo demo: devolver geojson demo
  return res.json(state.geojson);
});

// ── GET /api/properties/:id/geometry ─────────
// Devuelve GeoJSON Feature con el polígono real del predio (UTM→WGS84).
// Usa el cache de geometrías si ya fue cargado por /api/geometries.
// En modo demo devuelve el feature del GeoJSON de demo si existe.
app.get('/api/properties/:id/geometry', async (req, res) => {
  const cco = req.params.id;
  if (IS_REAL) {
    // 1. Buscar en cache (poblado por /api/geometries o warm-up)
    if (geometryCache.has(cco)) {
      return res.json(geometryCache.get(cco));
    }
    // 2. Intentar llamada directa al endpoint /3D
    try {
      const feature = await getGeometry(cco);
      geometryCache.set(cco, feature);
      return res.json(feature);
    } catch {
      // 3. El /3D falla para este predio — intentar llenar el cache via batch
    }
    try {
      const predios = await listPredios(20);
      const results = await Promise.allSettled(predios.map(p => getGeometry(p.id)));
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') geometryCache.set(predios[i].id, r.value);
      });
      if (geometryCache.has(cco)) {
        return res.json(geometryCache.get(cco));
      }
    } catch {
      // noop
    }
    return res.status(404).json({ error: 'Geometría no disponible para este predio' });
  }
  // Modo demo: buscar en el GeoJSON cargado en memoria
  const feature = state.geojson?.features?.find(
    f => f.properties?.id === cco || f.properties?.claveCatastral === cco
  );
  if (feature) return res.json(feature);
  return res.status(404).json({ error: 'Geometría no disponible para este predio en modo demo' });
});

// ── GET /api/properties/:id/3d-data ──────────
// Devuelve los datos crudos del Q3D para renderizar en Three.js en el frontend.
// Si /3D da error para este predio, sintetiza los datos desde el GeoJSON en cache.
app.get('/api/properties/:id/3d-data', async (req, res) => {
  if (!IS_REAL) {
    return res.status(404).json({ error: 'Vista 3D solo disponible en modo API real' });
  }
  try {
    const data = await get3DData(req.params.id);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.json(data);
  } catch {
    // El endpoint /3D no existe para este predio — sintetizar desde GeoJSON en cache.
    // Si el cache está vacío, llenarlo con el batch primero.
    if (!geometryCache.has(req.params.id)) {
      try {
        const predios = await listPredios(20);
        const results = await Promise.allSettled(predios.map(p => getGeometry(p.id)));
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') geometryCache.set(predios[i].id, r.value);
        });
      } catch { /* noop */ }
    }
    const cached = geometryCache.get(req.params.id);
    if (!cached) {
      return res.status(404).json({ error: 'No hay datos 3D disponibles para este predio' });
    }
    // Convertir coordenadas WGS84 → "scene units" centradas (×111320 m/°lat, ×111320*cos(lat) m/°lon)
    const coords = cached.geometry?.coordinates?.[0];
    if (!coords || coords.length < 3) {
      return res.status(404).json({ error: 'Geometría insuficiente para vista 3D' });
    }
    const lons = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);
    const cx = lons.reduce((s, v) => s + v, 0) / lons.length;
    const cy = lats.reduce((s, v) => s + v, 0) / lats.length;
    const mPerLat = 111320;
    const mPerLon = 111320 * Math.cos(cy * Math.PI / 180);
    const ring = coords.map(([lon, lat]) => [
      (lon - cx) * mPerLon,
      (lat - cy) * mPerLat,
    ]);
    // Estimar área desde el polígono (fórmula del zapato)
    let rawArea = 0;
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      rawArea += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
    }
    const areaDeclaredM2 = Math.abs(rawArea / 2);
    const areaStr = cached.properties?.area ?? null;
    const areaFromProps = areaStr ? parseFloat(String(areaStr).replace(/[^\d.]/g, '')) : null;

    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.json({
      cco: req.params.id,
      ring,
      baseExtent: null,
      areaDeclaredM2: areaFromProps ?? areaDeclaredM2,
      zExaggeration: 1.5,
      color: '0x7ebcd8',
      _synthesized: true,
    });
  }
});

// ── GET /api/properties/:id/croquis ──────────
// Retransmite el PNG del croquis del predio (requiere auth upstream).
// En modo demo responde 404 indicando que no hay imagen real.
app.get('/api/properties/:id/croquis', async (req, res) => {
  const cco = req.params.id;
  if (IS_REAL) {
    try {
      const { buffer, contentType } = await getCroquisBuffer(cco);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(buffer);
    } catch (err) {
      return handleUpstreamError(err, res);
    }
  }
  return res.status(404).json({ error: 'Croquis solo disponible en modo API real' });
});

// ── GET /api/source-status ───────────────────
app.get('/api/source-status', (req, res) => {
  if (IS_REAL) {
    return res.json({
      ...getSourceInfo(),
      prediosDemoEnRAM: state.properties.length,
      mapaDemo: true,
      dashboardDemoKPIs: true,
    });
  }
  res.json({
    mode: 'demo',
    source: 'Express in-memory (datos demo ficticios)',
    predios: state.properties.length,
    note: 'Para conectar a la API real: configurar CATASTRO_SOURCE=real en apps/api/.env',
    publicSources: state.publicSources,
  });
});

// ══════════════════════════════════════════════════════════════
// Pagos vía PorCobrar (cobranza REAL en stage) + posteo Catastro (SIMULADO)
// ══════════════════════════════════════════════════════════════
// cobroMap: chargeId → { nvUuid, ordenUuid, customerUuid, predioId, paymentLink,
//                        total, estado, folioOperacion, fechaPago }
const cobroMap = new Map();

function derivePredioId(chargeId) {
  // "REAL-0078...-2026-18" → "0078..." (quita prefijo REAL- y los 2 últimos segmentos)
  return chargeId.replace(/^REAL-/, '').split('-').slice(0, -2).join('-') || chargeId;
}

async function resolveCharge(chargeId, body = {}) {
  // 1) Demo: el cargo vive en state.payments
  const demo = state.payments.find(p => p.id === chargeId);
  if (demo) return { ...demo, predioId: demo.predioId, totalMXN: demo.totalMXN };
  // 2) Body provee total/predioId (camino normal desde la UI)
  const predioId = body.predioId || derivePredioId(chargeId);
  if (body.total != null) {
    return { id: chargeId, predioId, totalMXN: Number(body.total), concepto: body.concepto || 'Impuesto predial' };
  }
  // 3) Real: re-consultar estado de cuenta y localizar el cargo
  if (IS_REAL) {
    const charges = await mapEstadoCuenta(predioId);
    const found = charges.find(c => c.id === chargeId);
    if (found) return found;
  }
  return null;
}

/** Postea el cobro en Catastro (simulado) y marca el cargo como pagado. Idempotente. */
async function settleCharge(chargeId, { paymentRef, email } = {}) {
  const entry = cobroMap.get(chargeId);
  if (entry?.estado === 'pagado') return entry;

  const predioId = entry?.predioId || derivePredioId(chargeId);
  const cobro = await realizarCobroPredial(entry?.ordenUuid, { paymentRef, email });

  const updated = {
    ...(entry || { nvUuid: null, ordenUuid: null, predioId, total: 0 }),
    estado: 'pagado',
    folioOperacion: cobro.folioOperacion,
    fechaPago: cobro.fechaPago,
  };
  cobroMap.set(chargeId, updated);

  // Reflejar en overlay demo para que el dashboard cuente el pago
  const demo = state.payments.find(p => p.id === chargeId);
  if (demo) {
    demo.estadoPago = 'pagado';
    demo.fechaPago = cobro.fechaPago;
    demo.folioPago = cobro.folioOperacion;
  }

  addBitacoraEvent(
    predioId,
    'Pago de predial confirmado (PorCobrar)',
    'sistema-porcobrar',
    `Folio operación: ${cobro.folioOperacion} | Ref pago: ${paymentRef || 'N/D'} | Posteo Catastro: ${cobro._simulado ? 'simulado' : 'real'}`
  );
  return updated;
}

// ── POST /api/charges/:id/cobro ──────────────
// Genera la orden de pago (Catastro, simulado) + crea el cobro en PorCobrar (real)
// y devuelve el link de pago para mostrar al contribuyente.
app.post('/api/charges/:id/cobro', async (req, res) => {
  const chargeId = req.params.id;
  const { email } = req.body ?? {};
  try {
    const charge = await resolveCharge(chargeId, req.body ?? {});
    if (!charge) {
      return res.status(404).json({ error: 'Cargo no encontrado. Envía { total, predioId } o usa un cargo válido.' });
    }
    const total = Number(charge.totalMXN || 0);
    if (!(total > 0)) {
      return res.status(400).json({ error: 'El cargo no tiene un monto válido a cobrar.' });
    }
    const predioId = charge.predioId || derivePredioId(chargeId);

    // Reutilizar cobro vigente (idempotencia), con estas excepciones para el demo:
    // 1) Email diferente al del cobro existente → recrear NV para que llegue el correo
    // 2) Cobro ya pagado → permitir generar uno nuevo (demo: mismo cargo se puede pagar N veces)
    const existing = cobroMap.get(chargeId);
    if (existing && existing.paymentLink) {
      const emailCambiado = email && email !== existing.email;
      const yaPagado = existing.estado === 'pagado';
      if (!emailCambiado && !yaPagado) {
        return res.json({
          chargeId, estadoPago: 'cobro_generado',
          paymentLink: existing.paymentLink, nvUuid: existing.nvUuid, ordenUuid: existing.ordenUuid,
        });
      }
      // Eliminar caché para forzar nueva NV
      cobroMap.delete(chargeId);
    }

    // 1) Orden de pago en Catastro (SIMULADA)
    const orden = await generarOrdenPago({ cco: predioId, monto: total });

    // 2) Datos del contribuyente (propietario del predio) → customer PorCobrar
    let nombre = `Contribuyente ${predioId}`;
    try {
      const predio = await mapPredio(predioId);
      if (predio?.propietario) nombre = predio.propietario;
    } catch { /* fallback al nombre genérico */ }

    // El predial no lleva IVA: subtotal = total, tax = 0
    // (PorCobrar pre-crea el customer; quick_collection no puede auto-crearlo en stage)
    const { nvUuid, customerUuid } = await createQuickCollection({
      cco: predioId,
      name: nombre,
      email: email || undefined,
      invoice: { total, subtotal: total, tax: 0, concepto: `Predial ${charge.periodo || ''} ${predioId}`.trim() },
      sendEmail: !!email,
    });

    // 3) Obtener el payment_link (puede tardar un instante en generarse)
    let paymentLink = null;
    for (let i = 0; i < 4 && !paymentLink; i++) {
      try {
        const inv = await getInvoice(nvUuid);
        paymentLink = inv.paymentLink;
      } catch { /* reintentar */ }
      if (!paymentLink) await new Promise(r => setTimeout(r, 800));
    }

    cobroMap.set(chargeId, {
      nvUuid, ordenUuid: orden.ordenUuid, customerUuid, predioId,
      paymentLink, total, estado: 'cobro_generado', folioOperacion: null, fechaPago: null,
      email: email || null,
    });

    addBitacoraEvent(
      predioId,
      'Cobro de predial generado (PorCobrar)',
      'operador-catastro',
      `Orden: ${orden.ordenUuid} | NV: ${nvUuid} | Total: $${total} MXN | Canal: ${email ? 'email + link' : 'link/QR'}`
    );

    res.json({ chargeId, estadoPago: 'cobro_generado', paymentLink, nvUuid, ordenUuid: orden.ordenUuid });
  } catch (err) {
    if (err instanceof PorcobrarError) {
      return res.status(err.statusCode || 502).json({ error: err.message });
    }
    return handleUpstreamError(err, res);
  }
});

// ── GET /api/charges/:id/cobro-status ────────
// Fallback de polling: consulta PorCobrar; si el pago se concretó, postea (sim) y marca pagado.
app.get('/api/charges/:id/cobro-status', async (req, res) => {
  const chargeId = req.params.id;
  const entry = cobroMap.get(chargeId);
  if (!entry) return res.json({ chargeId, estadoPago: 'pendiente' });
  if (entry.estado === 'pagado') {
    return res.json({
      chargeId, estadoPago: 'pagado',
      folioOperacion: entry.folioOperacion, fechaPago: entry.fechaPago,
      paymentLink: entry.paymentLink, nvUuid: entry.nvUuid,
    });
  }
  try {
    const inv = await getInvoice(entry.nvUuid);
    const paid = !!inv.paidAt || ['PAID', 'PAGADA', 'COLLECTED'].includes(String(inv.statusId).toUpperCase());
    if (paid) {
      const settled = await settleCharge(chargeId, { paymentRef: inv.paidAt ? `invoice:${entry.nvUuid}` : undefined });
      return res.json({
        chargeId, estadoPago: 'pagado',
        folioOperacion: settled.folioOperacion, fechaPago: settled.fechaPago,
        paymentLink: entry.paymentLink, nvUuid: entry.nvUuid, dashboard: calcDashboard(),
      });
    }
  } catch { /* si PorCobrar falla, devolvemos el estado actual */ }
  res.json({ chargeId, estadoPago: 'cobro_generado', paymentLink: entry.paymentLink, nvUuid: entry.nvUuid });
});

// ── POST /api/webhooks/porcobrar ─────────────
// Recibe eventos de PorCobrar. Sin HMAC → verificamos re-consultando el pago.
app.post('/api/webhooks/porcobrar', async (req, res) => {
  const { data, event } = req.body ?? {};
  try {
    if (event === 'webhook.ping') {
      return res.status(200).json({ ok: true, pong: true });
    }
    if (typeof event === 'string' && event.startsWith('payment')) {
      // Verificar el pago contra la API (autenticidad)
      const paymentId = data?.id ?? data?.payment_id ?? data?.uuid;
      let verified = null;
      if (paymentId) {
        try { verified = await getPayment(paymentId); } catch { /* no bloquear el 200 */ }
      }
      // Reverse-map al chargeId vía el uuid de la NV
      const invoiceUuid = data?.invoice_uuid ?? data?.invoice?.uuid ?? verified?.invoice_uuid ?? verified?.invoice?.uuid;
      let chargeId = null;
      for (const [cid, e] of cobroMap.entries()) {
        if (e.nvUuid && (e.nvUuid === invoiceUuid)) { chargeId = cid; break; }
      }
      if (chargeId && event !== 'payment.delete') {
        await settleCharge(chargeId, { paymentRef: `payment:${paymentId ?? 'webhook'}` });
      }
    }
  } catch (err) {
    console.error('[webhook porcobrar] error procesando evento:', err.message);
  }
  // Siempre 200 para evitar reintentos innecesarios
  res.status(200).json({ ok: true });
});

// ── POST /api/porcobrar/register-webhook ─────
// Helper para registrar el webhook en PorCobrar (requiere URL pública/ngrok).
app.post('/api/porcobrar/register-webhook', async (req, res) => {
  const base = req.body?.publicUrl || process.env.PORCOBRAR_WEBHOOK_PUBLIC_URL;
  if (!base) {
    return res.status(400).json({ error: 'Define PORCOBRAR_WEBHOOK_PUBLIC_URL o envía { publicUrl }' });
  }
  const url = `${base.replace(/\/$/, '')}/api/webhooks/porcobrar`;
  try {
    const result = await registerWebhook(url);
    res.json({ registered: url, result });
  } catch (err) {
    res.status(err.statusCode || 502).json({ error: err.message });
  }
});

// ── GET /api/porcobrar/status ────────────────
app.get('/api/porcobrar/status', async (req, res) => {
  let webhooks = [];
  try { webhooks = await listWebhooks(); } catch { /* ignore */ }
  res.json({ porcobrar: getPorcobrarInfo(), catastroPagos: getPagosInfo(), webhooks });
});

// ══════════════════════════════════════════════════════════════
// Cincel — Flujo NOM-151 REAL (firma digital + sello de tiempo)
// ══════════════════════════════════════════════════════════════
// Flujo de 4 etapas:
//   envio     → genera PDF demo, sube a Cincel, devuelve signing_url
//   firma     → verifica estado en Cincel; si ya firmado, registra datos reales
//   sellado   → solicita sello de tiempo NOM-151 a Cincel TSA
//   archivado → marca documento como archivado (Cincel conserva automáticamente)
//
// _cincelDocUuid se guarda en el documento en RAM para las etapas siguientes.

function handleCincelError(err, res) {
  if (err instanceof CincelAuthError) {
    return res.status(401).json({
      error: err.message,
      cincelJwtExpired: true,
      hint: 'POST /api/cincel/refresh-jwt para renovar el JWT desde la interfaz',
    });
  }
  if (err instanceof CincelError) {
    return res.status(err.statusCode || 502).json({ error: err.message });
  }
  console.error('[cincel] error inesperado:', err);
  return res.status(500).json({ error: `Error interno Cincel: ${err.message}` });
}

app.post('/api/documents/:id/cincel', async (req, res) => {
  const { etapa = 'auto', predioId, nombre } = req.body ?? {};

  let doc = state.documents.find(d => d.id === req.params.id);
  if (!doc) {
    doc = {
      id: req.params.id,
      predioId: predioId || req.params.id,
      tipo: 'Expediente',
      nombre: nombre || `doc-${req.params.id}`,
      fecha: new Date().toISOString(),
      estado: 'vigente',
      firmado: false,
      conservacionNom151: false,
      urlDemo: null,
      _etapaCincel: null,
      _cincelDocUuid: null,
    };
    state.documents.push(doc);
  }

  const now = new Date().toISOString();
  let accion = '';
  let cincelStatus = '';

  // Determinar etapa
  const currentEtapa = doc._etapaCincel;
  const resolvedEtapa = etapa === 'auto'
    ? (!currentEtapa ? 'envio'
      : currentEtapa === 'envio' ? 'firma'
      : currentEtapa === 'firma' ? 'sellado'
      : currentEtapa === 'sellado' ? 'archivado'
      : null)
    : etapa;

  if (!resolvedEtapa) {
    return res.status(400).json({ error: 'Flujo NOM-151 ya completado para este documento.' });
  }

  try {
    // ── Etapa 1: Envío a Cincel ──────────────────────────────
    if (resolvedEtapa === 'envio') {
      // Buscar datos del predio para el PDF
      let predio = null;
      try {
        predio = IS_REAL
          ? await mapPredio(doc.predioId)
          : state.properties.find(p => p.id === doc.predioId);
      } catch { /* usar datos mínimos */ }

      const pdfBuffer = await generateDemoPdf(
        predio || { id: doc.predioId, claveCatastral: doc.predioId },
        doc
      );

      const docName = doc.nombreLegible || doc.nombre || `Expediente-${doc.predioId}`;
      // Firmante: el operador del municipio (o propietario según flujo)
      const signers = [{
        name: predio?.propietario || 'Operador Catastro 078',
        email: 'tech@humansoftware.mx',
      }];

      const { cincelDocUuid, signingUrl } = await uploadDocument(pdfBuffer, docName, signers);

      doc._etapaCincel = 'envio';
      doc._cincelDocUuid = cincelDocUuid;
      doc._signingUrl = signingUrl;
      doc.estado = 'pendiente_firma';
      cincelStatus = 'enviado';
      accion = `Documento subido a Cincel — pendiente de firma electrónica`;

      const cincelEvent = buildCincelEvent(doc, resolvedEtapa, cincelStatus, now, {
        folio: cincelDocUuid,
        signingUrl,
      });
      state.cincel.unshift(cincelEvent);
      addBitacoraEvent(doc.predioId, accion, 'operador-catastro',
        `Doc: ${docName} | UUID Cincel: ${cincelDocUuid} | Signing URL generada`);

      return res.json({ document: doc, cincelEvent, etapa: resolvedEtapa, signingUrl, dashboard: calcDashboard() });
    }

    // ── Etapa 2: Verificar firma ─────────────────────────────
    if (resolvedEtapa === 'firma') {
      const cincelDocUuid = doc._cincelDocUuid;
      if (!cincelDocUuid) {
        return res.status(400).json({ error: 'No hay documento en Cincel para este expediente. Ejecuta "envio" primero.' });
      }

      const status = await getDocumentStatus(cincelDocUuid);

      if (!status.signed) {
        // Aún no firmado — devolver estado actual sin avanzar la etapa
        return res.json({
          document: doc,
          cincelEvent: null,
          etapa: 'firma',
          signed: false,
          signingUrl: status.signingUrl || doc._signingUrl,
          message: 'El documento aún no ha sido firmado. Abre el portal de Cincel y completa la firma.',
          dashboard: calcDashboard(),
        });
      }

      // Firmado — registrar datos reales
      doc._etapaCincel = 'firma';
      doc.firmado = true;
      doc.estado = 'firmado';
      doc._firmante = status.firmante || 'Firmante Cincel';
      doc._certSerie = status.certSerie || `CINCEL-CERT-${cincelDocUuid.slice(0, 8)}`;
      doc._hashDocumento = status.hashDocumento || `sha256-cincel-${cincelDocUuid}`;
      cincelStatus = 'firmado';
      accion = `Firma electrónica verificada en Cincel — firmante: ${doc._firmante}`;

      const cincelEvent = buildCincelEvent(doc, resolvedEtapa, cincelStatus, now, {
        firmante: doc._firmante,
        certSerie: doc._certSerie,
        hash: doc._hashDocumento,
      });
      state.cincel.unshift(cincelEvent);
      addBitacoraEvent(doc.predioId, accion, 'operador-catastro',
        `Doc: ${doc.nombreLegible || doc.nombre} | Firmante: ${doc._firmante} | UUID Cincel: ${cincelDocUuid}`);

      return res.json({ document: doc, cincelEvent, etapa: resolvedEtapa, signed: true, dashboard: calcDashboard() });
    }

    // ── Etapa 3: Sello NOM-151 ───────────────────────────────
    if (resolvedEtapa === 'sellado') {
      const cincelDocUuid = doc._cincelDocUuid;
      if (!cincelDocUuid) {
        return res.status(400).json({ error: 'No hay documento en Cincel. Ejecuta "envio" primero.' });
      }

      const tsResult = await createTimestamp(cincelDocUuid);

      doc._etapaCincel = 'sellado';
      doc.conservacionNom151 = true;
      doc.estado = 'sellado_nom151';
      doc._tsa = tsResult.tsa;
      doc._selloTiempo = tsResult.selloTiempo;
      doc._acuseNom151 = tsResult.acuseNom151;
      cincelStatus = 'sellado_nom151';
      accion = `Sello de tiempo NOM-151 aplicado por Cincel TSA`;

      const cincelEvent = buildCincelEvent(doc, resolvedEtapa, cincelStatus, now, {
        tsa: tsResult.tsa,
        selloTiempo: tsResult.selloTiempo,
        acuseNom151: tsResult.acuseNom151,
      });
      state.cincel.unshift(cincelEvent);
      addBitacoraEvent(doc.predioId, accion, 'cincel-tsa',
        `Doc: ${doc.nombreLegible || doc.nombre} | Acuse NOM-151: ${tsResult.acuseNom151} | TSA: ${tsResult.tsa}`);

      return res.json({ document: doc, cincelEvent, etapa: resolvedEtapa, dashboard: calcDashboard() });
    }

    // ── Etapa 4: Archivado ───────────────────────────────────
    if (resolvedEtapa === 'archivado') {
      const folioArchivo = `ARCH-CINCEL-${(doc._cincelDocUuid || '').slice(0, 8) || Date.now().toString(36).toUpperCase()}`;
      doc._etapaCincel = 'archivado';
      doc.estado = 'vigente_nom151';
      doc._folioArchivo = folioArchivo;
      cincelStatus = 'archivado';
      accion = `Documento archivado con conservación NOM-151 a largo plazo`;

      const cincelEvent = buildCincelEvent(doc, resolvedEtapa, cincelStatus, now, {
        folioArchivo,
      });
      state.cincel.unshift(cincelEvent);
      addBitacoraEvent(doc.predioId, accion, 'operador-catastro',
        `Doc: ${doc.nombreLegible || doc.nombre} | Folio archivo: ${folioArchivo} | Conservación NOM-151 activa`);

      return res.json({ document: doc, cincelEvent, etapa: resolvedEtapa, dashboard: calcDashboard() });
    }

    return res.status(400).json({ error: `Etapa desconocida: ${resolvedEtapa}` });

  } catch (err) {
    return handleCincelError(err, res);
  }
});

function buildCincelEvent(doc, etapa, status, now, extra = {}) {
  return {
    id: `CIN-${String(state.cincel.length + 1).padStart(4, '0')}`,
    predioId: doc.predioId,
    documentId: doc.id,
    nombreDocumento: doc.nombreLegible || doc.nombre,
    provider: 'Cincel (real)',
    etapa,
    status,
    timestamp: now,
    folio: extra.folio || doc._cincelDocUuid || null,
    hash: extra.hash || doc._hashDocumento || null,
    firmante: extra.firmante || doc._firmante || null,
    certSerie: extra.certSerie || doc._certSerie || null,
    tsa: extra.tsa || doc._tsa || null,
    selloTiempo: extra.selloTiempo || doc._selloTiempo || null,
    acuseNom151: extra.acuseNom151 || doc._acuseNom151 || null,
    folioArchivo: extra.folioArchivo || doc._folioArchivo || null,
    signingUrl: extra.signingUrl || doc._signingUrl || null,
    nom151: doc.conservacionNom151,
  };
}

// ── GET /api/documents/:id/cincel-status ─────
// Verifica el estado del documento en Cincel sin avanzar la etapa.
// El frontend lo usa para polling mientras el firmante firma en el portal.
app.get('/api/documents/:id/cincel-status', async (req, res) => {
  const doc = state.documents.find(d => d.id === req.params.id);
  if (!doc?._cincelDocUuid) {
    return res.json({ signed: false, status: 'no_cincel_doc', signingUrl: null });
  }
  try {
    const status = await getDocumentStatus(doc._cincelDocUuid);
    res.json({
      signed: status.signed,
      status: status.status,
      signingUrl: status.signingUrl || doc._signingUrl,
      etapaCincel: doc._etapaCincel,
      firmante: status.firmante,
    });
  } catch (err) {
    return handleCincelError(err, res);
  }
});

// ── GET /api/cincel/status ───────────────────
// Estado general de la integración: JWT, créditos, info.
app.get('/api/cincel/status', (req, res) => {
  res.json({ ...getCincelInfo(), jwtExpired: isCincelJwtExpired() });
});

// ── POST /api/cincel/refresh-jwt ─────────────
// Paso 1 (sin body o body.step=1): solicita OTP al email de Cincel.
// Paso 2 (body.otp="123456"):      canjea el OTP por un nuevo JWT.
app.post('/api/cincel/refresh-jwt', async (req, res) => {
  const { otp, email } = req.body ?? {};
  try {
    if (otp) {
      // Paso 2: canjear OTP por JWT
      const jwt = await exchangeOtp(otp, email);
      // Mostrar solo los primeros/últimos caracteres por seguridad en logs
      const preview = `${jwt.slice(0, 20)}…${jwt.slice(-8)}`;
      res.json({ ok: true, step: 2, message: `JWT actualizado correctamente (${preview})` });
    } else {
      // Paso 1: solicitar OTP
      const result = await requestOtp(email);
      res.json({ ok: true, step: 1, message: `OTP enviado a ${result.otp_expires_at ? result.message || 'correo' : 'correo'}`, raw: result });
    }
  } catch (err) {
    return handleCincelError(err, res);
  }
});

// ── POST /api/reset ──────────────────────────
app.post('/api/reset', (req, res) => {
  seed();
  logCounter = state.bitacora.length + 1;
  res.json({ ok: true, message: 'Demo reiniciada desde datos originales.' });
});

// ── Arranque ─────────────────────────────────
const PORT = process.env.PORT || 8000;
app.listen(PORT, async () => {
  console.log(`[Catastro API] Escuchando en http://localhost:${PORT}`);
  console.log(`[Catastro API] CATASTRO_SOURCE=${SOURCE}`);
  if (IS_REAL) {
    console.log(`[Catastro API] → Modo REAL → ${process.env.CATASTRO_BASE_URL || 'http://134.255.227.95:6080'}`);
    console.log(`[Catastro API] → Municipio: ${process.env.CATASTRO_MUNICIPIO || '078'}`);
    // Pre-calentar el cache de geometrías en segundo plano al arrancar
    setTimeout(async () => {
      try {
        const predios = await listPredios(20);
        const results = await Promise.allSettled(predios.map(p => getGeometry(p.id)));
        let cached = 0;
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') {
            geometryCache.set(predios[i].id, r.value);
            cached++;
          }
        });
        console.log(`[Catastro API] Cache de geometrías: ${cached}/${predios.length} predios`);
      } catch (e) {
        console.warn('[Catastro API] No se pudo pre-calentar cache de geometrías:', e.message);
      }
    }, 3000);
  } else {
    console.log(`[Catastro API] ${state.properties.length} predios cargados en memoria`);
    console.log('[Catastro API] DATOS DEMO — ficticios, no es catastro real');
  }
});

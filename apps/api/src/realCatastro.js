/**
 * realCatastro.js
 * Cliente upstream hacia la API real del municipio 078.
 * Solo se usa cuando CATASTRO_SOURCE=real.
 *
 * Todos los adaptadores devuelven los shapes que el MVP ya conoce
 * (Predio, Adeudo[], Documento[], FirmaDigital) para que index.js
 * no necesite saber nada de la API de Oscar.
 */
import proj4 from 'proj4';

// Registrar proyección UTM zona 15N (EPSG:32615)
proj4.defs('EPSG:32615', '+proj=utm +zone=15 +datum=WGS84 +units=m +no_defs');

const BASE_URL = process.env.CATASTRO_BASE_URL || 'http://134.255.227.95:6080';
const MUNICIPIO = process.env.CATASTRO_MUNICIPIO || '078';
const TOKEN_CAJA = process.env.CATASTRO_TOKEN_CAJA || '';
const TOKEN_NOTARIO = process.env.CATASTRO_TOKEN_NOTARIO || '';

// ── Helpers ───────────────────────────────────────────────────

/**
 * Normaliza una CCO quitando guiones y espacios.
 * "078-0001-01-001-001" → "078000101001001" (15 dígitos)
 * "0078000101001002"    → "0078000101001002" (16 dígitos, formato real de la API)
 * "078000101001001"     → "078000101001001"
 */
export function normalizeCCO(raw) {
  return String(raw).replace(/-/g, '').trim();
}

/** true si el string parece una CCO válida (15 o 16 dígitos) */
export function isCCO(s) {
  const n = normalizeCCO(s);
  return /^\d{15,16}$/.test(n);
}

async function upstream(path, token) {
  const tok = token || TOKEN_CAJA;
  if (!tok) {
    throw new TokenMissingError('CATASTRO_TOKEN_CAJA no configurado en .env');
  }
  const url = `${BASE_URL}${path}`;
  let res;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${tok}`,
        'Content-Type': 'application/json',
      },
      // timeout via AbortController (Node 20)
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new UpstreamError(504, `Timeout conectando a la API catastro: ${url}`);
    }
    throw new UpstreamError(502, `Error de red hacia API catastro: ${err.message}`);
  }

  if (res.status === 401 || res.status === 403) {
    throw new TokenExpiredError(
      'El token JWT de catastro está vencido o no tiene permisos. ' +
      'Solicita un nuevo token a Oscar y actualiza .env -> CATASTRO_TOKEN_CAJA.'
    );
  }
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch { /* ignore */ }
    throw new UpstreamError(res.status, `API catastro respondió ${res.status}: ${body.slice(0, 200)}`);
  }
  const ct = res.headers.get('content-type') || '';
  // El endpoint /3D devuelve text/plain con JS, no JSON
  if (ct.includes('text/') || ct.includes('javascript')) return res.text();
  return res.json();
}

// ── Errores tipados ───────────────────────────────────────────

export class TokenMissingError extends Error {
  constructor(msg) { super(msg); this.name = 'TokenMissingError'; this.statusCode = 503; }
}
export class TokenExpiredError extends Error {
  constructor(msg) { super(msg); this.name = 'TokenExpiredError'; this.statusCode = 401; }
}
export class UpstreamError extends Error {
  constructor(status, msg) { super(msg); this.name = 'UpstreamError'; this.statusCode = status; }
}

// ── Adaptador: Predio ─────────────────────────────────────────

/**
 * Combina /api/predial/{cco} (informacion general)
 * con /api/predios/{cco}/domicilio (colonia/asentamiento)
 * y devuelve el shape Predio del MVP.
 */
export async function mapPredio(cco) {
  const raw = normalizeCCO(cco);

  const [predialData, domicilioData] = await Promise.allSettled([
    upstream(`/api/predial/${raw}`),
    upstream(`/api/predios/${raw}/domicilio`),
  ]);

  const dom = domicilioData.status === 'fulfilled' ? (domicilioData.value ?? {}) : {};

  // Predios exentos de pago devuelven 400 en /predial — construir ficha mínima
  // desde /domicilio si predialData falla
  if (predialData.status === 'rejected') {
    if (domicilioData.status === 'rejected') throw predialData.reason;
    const domDesc = dom.descripcion || '';
    return {
      id: raw,
      claveCatastral: raw,
      cuentaPredial: raw,
      domicilio: domDesc,
      colonia: domDesc,
      zona: '',
      propietario: '',
      usoSuelo: 'URBANO',
      superficieTerrenoM2: 0,
      superficieConstruccionM2: 0,
      valorCatastralMXN: 0,
      estadoPredio: 'exento',
      fuente: 'API real municipio 078',
      nota: 'Predio exento de pago de predial',
      feature: null,
    };
  }

  const info = predialData.value?.informacion ?? {};

  const colonia =
    dom.asentamiento?.nombreCompleto ||
    dom.asentamiento?.nombre ||
    info.domicilio ||
    '';

  const propietarios = predialData.value?.propietarios ?? [];
  const propietarioPrincipal = propietarios.find(p => p.titular !== false) ?? propietarios[0] ?? {};
  const nombrePropietario = propietarioPrincipal.nombre_completo || info.nombre_completo ||
    [info.nombre, info.apellido_paterno, info.apellido_materno].filter(Boolean).join(' ') || '';

  return {
    id: raw,
    claveCatastral: info.cve_cat_ori || raw,
    cuentaPredial: info.cve_cat_est || raw,
    domicilio: info.domicilio || dom.descripcion || '',
    colonia: colonia || dom.descripcion || '',
    zona: info.capa || '',
    propietario: nombrePropietario,
    usoSuelo: info.tipo_predio || 'URBANO',
    superficieTerrenoM2: info.sup_terr_total_aplicada || info.sup_terr_total || 0,
    superficieConstruccionM2: info.sup_cons_total_aplicada || info.sup_cons_total || 0,
    valorCatastralMXN: info.valor_catastral ?? 0,
    // Base gravable: valor usado para calcular el impuesto predial (puede diferir del valor catastral)
    baseGravableMXN: info.base_gravable ?? 0,
    // Flag: el valor_catastral del registro es $0 (pendiente de avalúo formal)
    sinValorCatastral: !(info.valor_catastral > 0),
    estadoPredio: info.estatus_bloqueado ? 'bloqueado' : 'activo',
    fuente: 'API real municipio 078',
    nota: null,
    feature: null,
  };
}

// ── Adaptador: Estado de cuenta / Cobranza ─────────────────────

/**
 * GET /api/predial/{cco}/estado-cuenta
 * Devuelve Adeudo[] con un registro por bimestre pendiente.
 */
export async function mapEstadoCuenta(cco) {
  const raw = normalizeCCO(cco);
  let data;
  try {
    data = await upstream(`/api/predial/${raw}/estado-cuenta`);
  } catch (err) {
    // Predios exentos devuelven 400 — no tienen cobros
    if (err instanceof UpstreamError && err.statusCode === 400) return [];
    throw err;
  }

  const predialRows = data?.predial ?? [];
  const resumen = data?.resumen_pago ?? {};
  const datosg = data?.datos_generales ?? {};

  return predialRows.map((row, i) => {
    const multas = row.multas ?? row.multa ?? 0;
    const total = row.total ?? (
      (row.impuesto_bimestral ?? 0) +
      (row.recargos ?? 0) +
      multas -
      (row.descuento_total ?? 0)
    );
    const bimLabel = `${row.anio ?? '?'} Bim ${row.bimestre ?? '?'}`;
    return {
      id: `REAL-${raw}-${row.anio ?? 0}-${row.bimestre ?? i}`,
      predioId: raw,
      concepto: `Predial ${bimLabel}`,
      periodo: bimLabel,
      anio: row.anio ?? null,
      bimestre: row.bimestre ?? null,
      montoBaseMXN: row.impuesto_bimestral ?? 0,
      recargosMXN: row.recargos ?? 0,
      gastosEjecucionMXN: row.gastos_ejecucion ?? 0,
      descuentosMXN: (row.descuento_recargos ?? 0) + (row.descuento_predial ?? 0) + (row.descuento_total ?? 0),
      multasMXN: multas,
      factorActualizacion: row.fact_actualizacion ?? 0,
      totalMXN: total,
      referencia: null,
      estadoPago: 'pendiente',
      fechaLimite: resumen.vigencia || null,
      fechaPago: null,
    };
  });
}

// ── Adaptador: Expedientes ────────────────────────────────────

/**
 * GET /api/v1/expedientes?cveCatOri={cco}&modulosId=...
 * modulosId es requerido; si no se conoce aún, intentamos sin él y
 * capturamos el error para devolver lista vacía con aviso.
 *
 * Devuelve Documento[].
 */
export async function mapExpedientes(cco) {
  const raw = normalizeCCO(cco);
  let data;
  try {
    // Intentamos sin modulosId primero (algunos deployments lo aceptan)
    data = await upstream(`/api/v1/expedientes?cveCatOri=${raw}&size=50`);
  } catch (err) {
    // Si falla con 400/422 por modulosId faltante, devolvemos lista vacía con nota
    if (err instanceof UpstreamError && (err.statusCode === 400 || err.statusCode === 422)) {
      return [{
        id: `EXP-HINT-${raw}`,
        predioId: raw,
        tipo: 'aviso',
        nombre: 'El endpoint de expedientes requiere modulosId. Consultar con Oscar qué módulos habilitar.',
        fecha: new Date().toISOString(),
        estado: 'requiere_configuracion',
        firmado: false,
        conservacionNom151: false,
        urlDemo: null,
        _hint: true,
      }];
    }
    throw err;
  }

  const rows = data?.data ?? (Array.isArray(data) ? data : []);
  return rows.map(exp => ({
    id: String(exp.id ?? exp.documentoId ?? `EXP-${raw}-${Math.random()}`),
    predioId: raw,
    tipo: exp.modulo?.nombre || exp.posicion || 'Expediente',
    nombre: exp.nombre ? `${exp.nombre}.${exp.extension ?? ''}`.replace(/\.$/, '') : `Doc-${exp.id}`,
    fecha: exp.ultimoAnio
      ? `${exp.ultimoAnio}-01-01`
      : new Date().toISOString(),
    estado: 'vigente',
    firmado: false,
    conservacionNom151: false,
    urlDemo: null,
    _documentoId: exp.documentoId,
    _folio: exp.folio,
    _moduloId: exp.modulo?.id,
  }));
}

// ── Adaptador: Firma digital ──────────────────────────────────

/**
 * GET /api/firma-digital/{uuid}
 * Devuelve el objeto tal como lo da la API (no necesita mapeo adicional).
 */
export async function getFirma(uuid) {
  // Firma usa token notario si está configurado, caja si no
  const tok = TOKEN_NOTARIO || TOKEN_CAJA;
  const data = await upstream(`/api/firma-digital/${uuid}`, tok);
  return {
    uuidDocumento: data.uuidDocumento,
    firmante: data.firmanteDocumento,
    certificado: data.certificadoFirmante,
    hash: data.hashDocumento,
    modulo: data.modulo,
    nombreDocumento: data.nombreDocumento,
    usuarioAlta: data.usuarioAlta,
    fechaFirma: data.fechaFirma,
    fechaHoraFirma: data.fechaHoraFirma,
  };
}

// ── Listado de predios (sin CCO) ─────────────────────────────

/**
 * Obtiene una lista de predios reales usando el endpoint de prescripciones,
 * que devuelve predios con adeudos sin requerir CCO específica.
 * Mapea cada entrada al shape Predio mínimo para el listado del MVP.
 */
export async function listPredios(limit = 20) {
  const data = await upstream(`/api/prescripciones/por-pagar?offset=0&nextr=${limit}`);
  const rows = data?.datos ?? [];
  return rows.map(row => {
    const cco = normalizeCCO(row.cve_cat_ori ?? '');
    return {
      id: cco,
      claveCatastral: cco,
      cuentaPredial: cco,
      domicilio: row.domicilio || '',
      colonia: row.colonia || '',
      zona: '',
      propietario: row.propietario || '',
      usoSuelo: '',
      superficieTerrenoM2: 0,
      superficieConstruccionM2: 0,
      valorCatastralMXN: row.total_base_gravable ?? 0,
      estadoPredio: 'activo',
      adeudoMXN: row.total_pago ?? 0,
      fuente: 'API real municipio 078',
      nota: null,
      feature: null,
    };
  });
}

// ── Geometría: UTM → WGS84 + GeoJSON ────────────────────────

/**
 * Convierte coordenadas UTM zona 15N (EPSG:32615) a [lat, lng] WGS84
 * usando proj4 para mayor precisión.
 */
function utm15nToWgs84(E, N) {
  const [lng, lat] = proj4('EPSG:32615', 'WGS84', [E, N]);
  return [lat, lng]; // [lat, lng]
}

/**
 * Descarga el endpoint /api/predios/{cco}/3D, extrae el polígono en coordenadas
 * UTM relativas al centro del extent, lo convierte a WGS84 y devuelve un GeoJSON Feature.
 */
export async function getGeometry(cco) {
  const raw = normalizeCCO(cco);
  const jsCode = await upstream(`/api/predios/${raw}/3D`);

  if (typeof jsCode !== 'string') {
    throw new UpstreamError(502, 'El endpoint /3D no devolvió texto JS esperado');
  }

  // Extraer baseExtent (EPSG:32615 UTM). El centro del extent es el centro real del predio.
  const extentMatch = jsCode.match(/baseExtent:\[([^\]]+)\]/);
  if (!extentMatch) throw new UpstreamError(502, 'No se encontró baseExtent en respuesta 3D');
  const [minX, minY, maxX, maxY] = extentMatch[1].split(',').map(Number);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // Q3D scene width parameter (default 100 scene units = extentWidth real metres)
  const widthMatch = jsCode.match(/width:([\d.]+)/);
  const sceneWidth = widthMatch ? parseFloat(widthMatch[1]) : 100;
  // Escala base: scene units → UTM metres (isotropic — mismo factor para X e Y)
  const baseScale = (maxX - minX) / sceneWidth;

  // Extraer polígono en unidades de escena Q3D
  const polyMatch = jsCode.match(/polygons:(\[\[.+?\]\]),\s*zs:/s);
  if (!polyMatch) throw new UpstreamError(502, 'No se encontró polígono en respuesta 3D');
  const ring = JSON.parse(polyMatch[1])[0][0]; // [[dx,dy], ...]

  // Extraer área declarada (m²)
  const areaMatch = jsCode.match(/'([\d.]+)\s*m<sup>2<\/sup>'/);
  const areaDeclaredM2 = areaMatch ? parseFloat(areaMatch[1]) : null;
  const area = areaDeclaredM2 ? `${areaDeclaredM2} m²` : null;

  // Paso 1: convertir scene units → UTM aproximado con escala base
  // Paso 2: calcular área del polígono escalado y derivar factor de corrección
  // para que el área final sea exactamente areaDeclaredM2.
  // Esto garantiza la forma correcta del polígono a escala real.
  let finalScale = baseScale;
  if (areaDeclaredM2 && areaDeclaredM2 > 0) {
    const scaledRing = ring.map(([dx, dy]) => [dx * baseScale, dy * baseScale]);
    let rawArea = 0;
    const n = scaledRing.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      rawArea += scaledRing[i][0] * scaledRing[j][1] - scaledRing[j][0] * scaledRing[i][1];
    }
    rawArea = Math.abs(rawArea / 2);
    if (rawArea > 0) finalScale = baseScale / Math.sqrt(rawArea / areaDeclaredM2);
  }

  // Aplicar escala final: scene units → UTM metros corregidos → WGS84
  const coordinates = ring.map(([dx, dy]) => {
    const E = cx + dx * finalScale;
    const N = cy + dy * finalScale;
    const [lat, lng] = utm15nToWgs84(E, N);
    return [lng, lat];
  });

  return {
    type: 'Feature',
    properties: {
      cco: raw,
      area,
      source: '3D API municipio 078',
      epsg_original: 'EPSG:32615',
    },
    geometry: {
      type: 'Polygon',
      coordinates: [coordinates],
    },
  };
}

/**
 * Devuelve los datos crudos del endpoint /3D en formato JSON estructurado
 * para que el frontend pueda renderizar una vista 3D con Three.js:
 * - ring: [[dx, dy], ...] en unidades de escena Q3D
 * - baseExtent: [minX, minY, maxX, maxY] en UTM EPSG:32615
 * - area: número en m²
 * - zExaggeration, color, title
 */
export async function get3DData(cco) {
  const raw = normalizeCCO(cco);
  const jsCode = await upstream(`/api/predios/${raw}/3D`);
  if (typeof jsCode !== 'string') throw new UpstreamError(502, 'El endpoint /3D no devolvió texto JS');

  const extentMatch = jsCode.match(/baseExtent:\[([^\]]+)\]/);
  if (!extentMatch) throw new UpstreamError(502, 'No se encontró baseExtent en respuesta 3D');
  const baseExtent = extentMatch[1].split(',').map(Number);

  const polyMatch = jsCode.match(/polygons:(\[\[.+?\]\]),\s*zs:/s);
  if (!polyMatch) throw new UpstreamError(502, 'No se encontró polígono en respuesta 3D');
  const ring = JSON.parse(polyMatch[1])[0][0]; // [[dx,dy], ...]

  const areaMatch = jsCode.match(/'([\d.]+)\s*m<sup>2<\/sup>'/);
  const areaDeclaredM2 = areaMatch ? parseFloat(areaMatch[1]) : null;

  const zExagMatch = jsCode.match(/zExaggeration:([\d.]+)/);
  const zExaggeration = zExagMatch ? parseFloat(zExagMatch[1]) : 1.5;

  const colorMatch = jsCode.match(/c:(0x[0-9a-fA-F]+)/);
  const color = colorMatch ? colorMatch[1] : '0x7ebcd8';

  const ccoMatch = jsCode.match(/'(\d{15,16})'/);
  const ccoLabel = ccoMatch ? ccoMatch[1] : raw;

  return {
    cco: ccoLabel,
    ring,            // [[dx,dy], ...] scene units
    baseExtent,      // [minX,minY,maxX,maxY] UTM 32615
    areaDeclaredM2,
    zExaggeration,
    color,
  };
}

/**
 * Devuelve el PNG del croquis como Buffer para ser retransmitido al cliente.
 */
export async function getCroquisBuffer(cco) {
  const raw = normalizeCCO(cco);
  const tok = TOKEN_CAJA;
  if (!tok) throw new TokenMissingError('CATASTRO_TOKEN_CAJA no configurado en .env');

  const url = `${BASE_URL}/api/predios/${raw}/croquis`;
  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${tok}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new UpstreamError(502, `Error de red al obtener croquis: ${err.message}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new TokenExpiredError('Token vencido o sin permisos al obtener croquis');
  }
  if (!res.ok) {
    throw new UpstreamError(res.status, `Croquis API respondió ${res.status}`);
  }
  const contentType = res.headers.get('content-type') || 'image/png';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType };
}

// ── Source status ────────────────────────────────────────────

export function getSourceInfo() {
  // Decodifica el token sin verificar firma para extraer expiración
  let expInfo = 'desconocida';
  try {
    const payload = JSON.parse(
      Buffer.from(TOKEN_CAJA.split('.')[1], 'base64url').toString()
    );
    if (payload.exp) {
      const d = new Date(payload.exp * 1000);
      const now = Date.now();
      const vencido = now > payload.exp * 1000;
      expInfo = `${d.toISOString().slice(0, 10)} ${vencido ? '(VENCIDO)' : '(vigente)'}`;
    }
  } catch { /* token malformado o vacío */ }

  return {
    source: 'real',
    baseUrl: BASE_URL,
    municipio: MUNICIPIO,
    tokenCajaConfigured: TOKEN_CAJA.length > 0,
    tokenNotarioConfigured: TOKEN_NOTARIO.length > 0,
    tokenExpiracion: expInfo,
    note: 'Modo API real — datos del municipio 078. Las acciones de pago/firma siguen simuladas.',
  };
}

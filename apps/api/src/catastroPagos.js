/**
 * catastroPagos.js
 * Posteo de pagos al padrón municipal (subsistema "pagos en línea" de Catastro).
 *
 * IMPORTANTE: por defecto este módulo está SIMULADO (CATASTRO_POST_PAYMENT=false)
 * para NO afectar datos reales del municipio. Replica EXACTAMENTE el contrato de
 * los endpoints reales de pagos-linea (mismos nombres de campo y shapes), de modo
 * que el flujo de la demo sea idéntico al de producción.
 *
 * Flujo real espejado:
 *   POST /api/v2/pagos-linea/predial                       -> generarOrdenPago
 *   POST /api/v2/pagos-linea/predial/{uuid}/realizar-cobro -> realizarCobroPredial
 *   GET  /api/v2/predial/recibo-pago-pdf/{folioOperacion}  -> recibo oficial
 *
 * Para activar el posteo REAL: poner CATASTRO_POST_PAYMENT=true y proveer el
 * contrato del campo `encoded` que espera realizar-cobro (pendiente del equipo
 * de Catastro). Las firmas de las funciones no cambian.
 */
import { randomUUID } from 'crypto';

const POST_REAL = String(process.env.CATASTRO_POST_PAYMENT || 'false').toLowerCase() === 'true';
const MUNICIPIO = process.env.CATASTRO_MUNICIPIO || '078';

// Overlay en memoria de órdenes de pago generadas (simulación).
const ordenes = new Map();
let folioSeq = 1;

/**
 * Genera una orden de pago para un predio. Mismo shape que la respuesta real.
 * @param {{cco:string, monto:number, gastosEjecucion?:boolean, gastosEmbargo?:boolean}} p
 */
export async function generarOrdenPago({ cco, monto, gastosEjecucion = false, gastosEmbargo = false }) {
  if (POST_REAL) {
    return generarOrdenPagoReal({ cco, gastosEjecucion, gastosEmbargo });
  }
  const ordenUuid = randomUUID();
  const orden = {
    ordenUuid,
    cveCatOri: cco,
    numMunicipio: MUNICIPIO,
    monto: round2(monto),
    gastosEjecucion,
    gastosEmbargo,
    estado: 'generada',
    creadaEn: new Date().toISOString(),
    folioOperacion: null,
    _simulado: true,
  };
  ordenes.set(ordenUuid, orden);
  return orden;
}

/**
 * Registra (postea) el cobro contra la orden de pago. Devuelve folioOperacion.
 * En real recibiría `encoded` (confirmación de pasarela). Aquí lo aceptamos como
 * metadato de trazabilidad pero generamos un folio simulado.
 * @param {string} ordenUuid
 * @param {{paymentRef?:string, email?:string, encoded?:string}} datos
 */
export async function realizarCobroPredial(ordenUuid, { paymentRef, email, encoded } = {}) {
  if (POST_REAL) {
    return realizarCobroPredialReal(ordenUuid, { email, encoded });
  }
  const orden = ordenes.get(ordenUuid) || { cveCatOri: 'desconocida' };
  const year = new Date().getFullYear();
  const folioOperacion = `PRD-${MUNICIPIO}-${year}-${String(folioSeq++).padStart(6, '0')}`;
  orden.estado = 'cobrada';
  orden.folioOperacion = folioOperacion;
  orden.cobradaEn = new Date().toISOString();
  orden.paymentRef = paymentRef ?? null;
  if (ordenUuid) ordenes.set(ordenUuid, orden);
  return {
    folioOperacion,
    ordenUuid,
    cveCatOri: orden.cveCatOri,
    fechaPago: orden.cobradaEn,
    email: email ?? null,
    _simulado: true,
  };
}

/** Devuelve los metadatos del recibo oficial (el PDF real se sustituye por ReciboPredial en la UI). */
export async function getReciboInfo(folioOperacion) {
  return {
    folioOperacion,
    municipio: MUNICIPIO,
    emisor: 'Tesorería Municipal',
    tipo: 'Recibo de pago de impuesto predial',
    _simulado: !POST_REAL,
  };
}

export function getPagosInfo() {
  return {
    postPayment: POST_REAL,
    modo: POST_REAL ? 'real (escribe al padrón municipal)' : 'simulado (no afecta datos reales)',
    municipio: MUNICIPIO,
    ordenesEnMemoria: ordenes.size,
  };
}

// ── Implementaciones reales (placeholder, requieren contrato `encoded`) ────────

async function generarOrdenPagoReal() {
  throw new Error(
    'CATASTRO_POST_PAYMENT=true pero el posteo real aún no está habilitado: ' +
    'falta integrar POST /api/v2/pagos-linea/predial (generarOrdenPago) en realCatastro.js.'
  );
}

async function realizarCobroPredialReal() {
  throw new Error(
    'CATASTRO_POST_PAYMENT=true pero el posteo real aún no está habilitado: ' +
    'falta el contrato del campo `encoded` para POST /api/v2/pagos-linea/predial/{uuid}/realizar-cobro.'
  );
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

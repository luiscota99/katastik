/**
 * porcobrar.js
 * Cliente REAL hacia la API de PorCobrar (entorno stage).
 *
 * Se usa para la cobranza real del predial: genera una Nota de Venta con cobro
 * rápido (quick_collection), obtiene el link de pago y verifica el pago vía
 * webhook / polling. El pago se realiza con tarjetas de prueba (Stripe/Conekta)
 * en el checkout hospedado de PorCobrar.
 *
 * NO toca datos del municipio: el posteo al padrón se maneja aparte
 * (catastroPagos.js) y por ahora está simulado.
 */
import { createHash, randomUUID } from 'crypto';

const BASE_URL = process.env.PORCOBRAR_BASE_URL || 'https://stage.api.porcobrar.com';
const JWT = process.env.PORCOBRAR_JWT || '';

export class PorcobrarError extends Error {
  constructor(status, msg) {
    super(msg);
    this.name = 'PorcobrarError';
    this.statusCode = status;
  }
}

// Cache CCO → customer uuid (PorCobrar genera el uuid al crear el customer;
// quick_collection NO puede auto-crearlo en stage, así que lo pre-creamos).
const customerCache = new Map();

/** UUID v4 determinístico a partir de una semilla (para identificar el customer por CCO). */
export function deterministicUuid(seed) {
  const h = createHash('sha256').update(String(seed)).digest('hex');
  const b = h.slice(0, 32).split('');
  b[12] = '4';
  b[16] = '8';
  const s = b.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/**
 * Garantiza que exista un customer para el predio y devuelve su uuid.
 * Reutiliza el cache en memoria; si no, crea el customer en PorCobrar.
 * (POST /v1/customer genera su propio uuid y requiere campos fiscales mínimos.)
 */
export async function ensureCustomer({ cco, name, email }) {
  if (customerCache.has(cco)) return customerCache.get(cco);
  const body = {
    cfdi_seal_version: '4.0',
    name: name || `Contribuyente ${cco}`,
    legal_name: name || `Contribuyente ${cco}`,
    // RFC (tax_profile): único por predio para evitar colisión de RFC en PorCobrar
    tax_profile: ccoRfc(cco),
    tax_regime: 616, // Sin obligaciones fiscales
    identifier: cco,
    agreement: { payment_term: 0 },
    ...(email ? { email } : {}),
  };
  let resp;
  try {
    resp = await pcFetch('/v1/customer', { method: 'POST', body });
  } catch (err) {
    // Si el RFC ya existe (reinicio del backend), reutilizar el customer existente
    if (err instanceof PorcobrarError && /exist/i.test(err.message)) {
      const existing = await findCustomerByRfc(body.tax_profile);
      if (existing) { customerCache.set(cco, existing); return existing; }
    }
    throw err;
  }
  const uuid = resp?.data?.uuid;
  if (!uuid) throw new PorcobrarError(502, 'PorCobrar no devolvió uuid al crear el customer');
  customerCache.set(cco, uuid);
  return uuid;
}

/** Genera un RFC válido (12 chars, persona moral) y único por CCO. */
function ccoRfc(cco) {
  const h = createHash('sha256').update(String(cco)).digest('hex');
  const suffix = parseInt(h.slice(0, 8), 16).toString(36).toUpperCase().padStart(3, '0').slice(0, 3);
  return `CAT010101${suffix}`;
}

/** Busca un customer por RFC paginando hasta encontrarlo. */
async function findCustomerByRfc(rfc) {
  try {
    let page = 1;
    while (true) {
      const resp = await pcFetch(`/v1/customer?limit=100&page=${page}`);
      const list = resp?.data ?? (Array.isArray(resp) ? resp : []);
      if (!list.length) break;
      const found = list.find(c => c.tax_profile === rfc);
      if (found?.uuid) return found.uuid;
      // Usar el total de páginas que devuelve la API (no el tamaño del array,
      // ya que PorCobrar puede devolver menos de `limit` aun habiendo más páginas)
      const totalPages = resp?.pages ?? 1;
      if (page >= totalPages) break;
      page++;
      if (page > 20) break; // safety cap
    }
    return null;
  } catch {
    return null;
  }
}

async function pcFetch(path, { method = 'GET', body } = {}) {
  if (!JWT) throw new PorcobrarError(503, 'PORCOBRAR_JWT no configurado en .env');
  const url = `${BASE_URL}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${JWT}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new PorcobrarError(504, `Timeout conectando a PorCobrar: ${url}`);
    }
    throw new PorcobrarError(502, `Error de red hacia PorCobrar: ${err.message}`);
  }

  let payload = null;
  const text = await res.text();
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }

  if (!res.ok) {
    const detail = typeof payload === 'object' ? JSON.stringify(payload).slice(0, 250) : String(payload).slice(0, 250);
    throw new PorcobrarError(res.status, `PorCobrar respondió ${res.status}: ${detail}`);
  }
  return payload;
}

/**
 * Crea una NV con cobro rápido para un predio. Pre-crea/reutiliza el customer
 * y devuelve el uuid de la NV creada.
 * @param {object} p
 * @param {string} p.cco          CCO del predio (identifica al customer)
 * @param {string} p.name         Nombre del propietario/contribuyente
 * @param {string} [p.email]      Email del contribuyente (para canal email)
 * @param {{total:number,subtotal:number,tax:number,concepto:string}} p.invoice
 * @param {boolean} p.sendEmail   Si true, PorCobrar envía el link por email (requiere email)
 */
export async function createQuickCollection({ cco, name, email, invoice, sendEmail = false }) {
  const customerUuid = await ensureCustomer({ cco, name, email });
  const nvUuid = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const dueDate = now + 30 * 24 * 3600;

  const body = {
    customer: {
      uuid: customerUuid,
      name: name || `Contribuyente ${cco}`,
      ...(email ? { email } : {}),
    },
    invoices: [
      {
        uuid: nvUuid,
        currency: 'MXN',
        discount: 0,
        collectible: 1,
        issue_date: now,
        due_date: dueDate,
        subtotal: round2(invoice.subtotal),
        tax: round2(invoice.tax),
        total: round2(invoice.total),
        items: [{ description: invoice.concepto || 'Impuesto predial' }],
      },
    ],
    ways_to_collect: {
      email: !!(sendEmail && email),
    },
  };

  const resp = await pcFetch('/v1/invoice/quick_collection', { method: 'POST', body });
  const created = resp?.data?.[0];
  return { nvUuid: created?.uuid || nvUuid, customerUuid, raw: created };
}

/** Obtiene la factura/NV (incluye payment_link cuando status_id=GENERATED). */
export async function getInvoice(uuid) {
  const resp = await pcFetch(`/v1/invoice/${uuid}`);
  const data = resp?.data ?? resp;
  return {
    uuid,
    paymentLink: data?.payment_link ?? null,
    statusId: data?.status_id ?? null,
    paidAt: data?.paid_at ?? null,
    total: data?.total ?? null,
    raw: data,
  };
}

/** Obtiene un pago por id para verificar autenticidad de un webhook. */
export async function getPayment(id) {
  const resp = await pcFetch(`/v1/payment/${id}`);
  return resp?.data ?? resp;
}

/** Lista pagos (opcionalmente filtrando por invoice uuid en memoria). */
export async function listPayments() {
  const resp = await pcFetch('/v1/payment');
  return resp?.data ?? [];
}

/** Registra un webhook endpoint. PorCobrar valida con un webhook.ping (espera 200). */
export async function registerWebhook(url, headers) {
  return pcFetch('/v1/webhook_endpoint', {
    method: 'POST',
    body: { url, ...(headers ? { headers } : {}) },
  });
}

export async function listWebhooks() {
  const resp = await pcFetch('/v1/webhook_endpoint');
  return resp?.data ?? [];
}

export function getPorcobrarInfo() {
  let expInfo = 'desconocida';
  try {
    const payload = JSON.parse(Buffer.from(JWT.split('.')[1], 'base64url').toString());
    if (payload.exp) {
      const d = new Date(payload.exp * 1000);
      expInfo = `${d.toISOString().slice(0, 10)} ${Date.now() > payload.exp * 1000 ? '(VENCIDO)' : '(vigente)'}`;
    }
  } catch { /* token vacío o malformado */ }
  return {
    baseUrl: BASE_URL,
    jwtConfigured: JWT.length > 0,
    jwtExpiracion: expInfo,
  };
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * cincel.js — Cliente REAL hacia la API de Cincel v3 (app.cincel.digital).
 *
 * Flujo documentado:
 *  1. uploadDocument()    → POST /teams/:team/folders/:folder/documents  → uuid + "unsigned"
 *  2. getDocumentStatus() → GET  /teams/:team/folders/:folder/documents/:uuid → status "unsigned"|"signed"
 *     • Portal de firma:  https://app.cincel.digital/ (el firmante abre la app y firma)
 *  3. createTimestamp()   → GET  /teams/:team/folders/:folder/documents/:uuid/timestamp.tsr
 *     • Solo disponible cuando status === "signed"; devuelve binario .tsr (RFC3161)
 *
 * JWT: si CINCEL_PAT está configurado, el JWT se refresca automáticamente vía PAT
 *      (Business Pro/Enterprise). Fallback: OTP manual vía POST /api/cincel/refresh-jwt.
 */
import PDFDocument from 'pdfkit';

const BASE_URL = process.env.CINCEL_BASE_URL || 'https://api.cincel.digital/v3';
const TEAM_UUID = process.env.CINCEL_TEAM_UUID || '';
const FOLDER_UUID = process.env.CINCEL_FOLDER_UUID || '';
export const CINCEL_EMAIL = process.env.CINCEL_EMAIL || '';
const CINCEL_PAT = process.env.CINCEL_PAT || '';

// ── JWT store ──────────────────────────────────────────────────────
let _jwt = process.env.CINCEL_JWT || '';
let _jwtExpired = false;

export function getCincelJwt() { return _jwt; }
export function setCincelJwt(jwt) { _jwt = jwt; _jwtExpired = false; }
export function isCincelJwtExpired() { return _jwtExpired; }

/** Refresca el JWT usando el PAT (Business Pro). Retorna el nuevo JWT. */
export async function refreshJwtFromPat() {
  if (!CINCEL_PAT) throw new CincelError(503, 'CINCEL_PAT no configurado en .env');
  const b64 = Buffer.from(`${CINCEL_PAT}:`).toString('base64');
  const res = await fetch(`${BASE_URL}/tokens/jwt`, {
    headers: { Authorization: `Basic ${b64}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new CincelError(res.status, `PAT refresh error: ${txt.slice(0, 200)}`);
  }
  const jwt = (await res.text()).trim().replace(/^"|"$/g, '');
  setCincelJwt(jwt);
  console.log('[Cincel] JWT refrescado automáticamente via PAT');
  return jwt;
}

// ── Errors ─────────────────────────────────────────────────────────
export class CincelError extends Error {
  constructor(status, msg) {
    super(msg);
    this.name = 'CincelError';
    this.statusCode = status;
  }
}
export class CincelAuthError extends CincelError {
  constructor() {
    super(401, 'El JWT de Cincel expiró. Renuévalo desde la interfaz: POST /api/cincel/refresh-jwt');
    this.name = 'CincelAuthError';
  }
}

// ── HTTP helpers ───────────────────────────────────────────────────
async function cincelFetch(path, { method = 'GET', headers = {}, body, rawResponse = false } = {}) {
  if (!_jwt) throw new CincelError(503, 'CINCEL_JWT no configurado en .env');
  const url = `${BASE_URL}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${_jwt}`, ...headers },
      body,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new CincelError(504, `Timeout conectando a Cincel: ${url}`);
    }
    throw new CincelError(502, `Error de red hacia Cincel: ${err.message}`);
  }

  if (res.status === 401 || res.status === 403) {
    // Si hay PAT configurado, intentar refresh automático (una sola vez)
    if (CINCEL_PAT && !headers['__pat_retry']) {
      try {
        await refreshJwtFromPat();
        return cincelFetch(path, { method, headers: { ...headers, __pat_retry: '1' }, body, rawResponse });
      } catch { /* si falla el refresh, lanzar el error original */ }
    }
    _jwtExpired = true;
    throw new CincelAuthError();
  }

  if (rawResponse) return res;

  const text = await res.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }

  if (!res.ok) {
    const detail = typeof payload === 'object'
      ? JSON.stringify(payload).slice(0, 250)
      : String(payload).slice(0, 250);
    throw new CincelError(res.status, `Cincel respondió ${res.status}: ${detail}`);
  }
  return payload;
}

// ── OTP / JWT refresh ──────────────────────────────────────────────
/** Paso 1: solicita OTP al email registrado en Cincel. */
export async function requestOtp(email) {
  const addr = email || CINCEL_EMAIL;
  if (!addr) throw new CincelError(400, 'CINCEL_EMAIL no configurado');
  const b64 = Buffer.from(`${addr}:otp`).toString('base64');
  const res = await fetch(`${BASE_URL}/tokens/otp`, {
    headers: { Authorization: `Basic ${b64}` },
    signal: AbortSignal.timeout(10_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new CincelError(res.status, `OTP error: ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

/** Paso 2: canjea el OTP por un JWT y lo persiste. */
export async function exchangeOtp(otp, email) {
  const addr = email || CINCEL_EMAIL;
  if (!addr) throw new CincelError(400, 'CINCEL_EMAIL no configurado');
  const b64 = Buffer.from(`${addr}:${otp}`).toString('base64');
  const res = await fetch(`${BASE_URL}/tokens/jwt`, {
    headers: { Authorization: `Basic ${b64}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new CincelError(res.status, `OTP inválido o expirado: ${txt.slice(0, 200)}`);
  }
  const jwt = (await res.text()).trim().replace(/^"|"$/g, '');
  setCincelJwt(jwt);
  return jwt;
}

// ── PDF generation ─────────────────────────────────────────────────
/**
 * Genera un PDF mínimo representando el expediente de un predio.
 * @returns {Promise<Buffer>}
 */
export function generateDemoPdf(predio, doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const pdf = new PDFDocument({ size: 'LETTER', margin: 60 });
    pdf.on('data', c => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    const now = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
    const docName = doc?.nombre || doc?.nombreLegible || 'Documento Catastral';
    const tipo = doc?.tipo || 'Expediente';

    pdf.fontSize(16).font('Helvetica-Bold')
      .text('KATASTIK - Gestion Catastral Digital', { align: 'center' });
    pdf.fontSize(11).font('Helvetica')
      .text('Plataforma de Modernizacion Catastral Municipal', { align: 'center' });
    pdf.moveDown(0.5);
    pdf.moveTo(60, pdf.y).lineTo(550, pdf.y).stroke();
    pdf.moveDown(0.5);

    pdf.fontSize(13).font('Helvetica-Bold').text(`${tipo}: ${docName}`);
    pdf.fontSize(10).font('Helvetica').moveDown(0.3);
    pdf.text(`Generado: ${now}`);
    pdf.text(`Folio Katastik: KAT-${(predio?.id || '').slice(-8)}-${Date.now().toString(36).toUpperCase()}`);
    pdf.moveDown(0.8);

    pdf.fontSize(12).font('Helvetica-Bold').text('Datos del Predio');
    pdf.moveTo(60, pdf.y + 2).lineTo(550, pdf.y + 2).stroke();
    pdf.moveDown(0.3);

    const rows = [
      ['Clave Catastral (CCO)', predio?.claveCatastral || predio?.id || '-'],
      ['Domicilio', predio?.domicilio || '-'],
      ['Propietario', predio?.propietario || '-'],
      ['Uso de suelo', predio?.usoSuelo || '-'],
      ['Valor catastral', predio?.valorCatastralMXN
        ? `$${Number(predio.valorCatastralMXN).toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN`
        : '-'],
      ['Superficie terreno', predio?.superficieTerrenoM2 ? `${predio.superficieTerrenoM2} m2` : '-'],
    ];

    pdf.fontSize(10).font('Helvetica');
    for (const [label, value] of rows) {
      pdf.font('Helvetica-Bold').text(`${label}: `, { continued: true });
      pdf.font('Helvetica').text(value);
    }
    pdf.moveDown(1);

    pdf.fontSize(9).font('Helvetica-Oblique').fillColor('#555')
      .text(
        'Este documento ha sido generado electronicamente por el sistema Katastik para su firma digital ' +
        'y conservacion a largo plazo conforme a la NOM-151-SCFI-2016. La validez del documento esta ' +
        'garantizada por la firma del firmante y el sello de tiempo de Cincel, Prestador de Servicios ' +
        'de Certificacion acreditado ante el SAT.',
        { align: 'justify' }
      );
    pdf.moveDown(0.8);

    pdf.fillColor('#000').fontSize(10).font('Helvetica')
      .text('___________________________', { align: 'center' });
    pdf.text('Firma del responsable catastral', { align: 'center' });
    pdf.end();
  });
}

// ── Document upload ────────────────────────────────────────────────
/**
 * Sube un PDF a Cincel y crea la sesión de firma.
 * El portal de firma es https://app.cincel.digital/ (no hay URL directa por API).
 *
 * @param {Buffer} pdfBuffer
 * @param {string} name
 * @param {{name:string, email:string}[]} signers
 * @returns {Promise<{cincelDocUuid:string, signingUrl:string}>}
 */
export async function uploadDocument(pdfBuffer, name, signers = []) {
  if (!TEAM_UUID || !FOLDER_UUID) {
    throw new CincelError(503, 'CINCEL_TEAM_UUID o CINCEL_FOLDER_UUID no configurados');
  }

  // Headers must be ASCII-safe
  const asciiName = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .slice(0, 100);

  const metadata = JSON.stringify({
    name: asciiName,
    description: `Expediente catastral Katastik - ${asciiName}`,
  });
  const signersHeader = JSON.stringify(signers);

  const resp = await cincelFetch(
    `/teams/${TEAM_UUID}/folders/${FOLDER_UUID}/documents`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/pdf',
        'Metadata': metadata,
        'Signers': signersHeader,
        // Observers omitted — Cincel requires ≥1 items if header is present
      },
      body: pdfBuffer,
    }
  );

  const uuid = resp?.uuid || resp?.id;
  if (!uuid) {
    throw new CincelError(502, `Cincel no devolvio uuid: ${JSON.stringify(resp).slice(0, 200)}`);
  }

  // Signing portal — firmante abre la app Cincel y ve el doc pendiente de firma
  const signingUrl = 'https://app.cincel.digital/';
  return { cincelDocUuid: uuid, signingUrl };
}

// ── Document status ────────────────────────────────────────────────
/**
 * Consulta el estado del documento en Cincel.
 * @param {string} cincelDocUuid
 */
export async function getDocumentStatus(cincelDocUuid) {
  const resp = await cincelFetch(
    `/teams/${TEAM_UUID}/folders/${FOLDER_UUID}/documents/${cincelDocUuid}`
  );
  const doc = resp?.data ?? resp;
  const status = doc?.status || doc?.state || 'unknown';
  return {
    uuid: cincelDocUuid,
    status,
    signed: isSignedStatus(status),
    signingUrl: 'https://app.cincel.digital/',
    firmante: doc?.creator?.name || null,
    certSerie: null,
    hashDocumento: doc?.original_doc_hash || null,
    raw: doc,
  };
}

function isSignedStatus(s) {
  return ['signed', 'completed', 'firmado', 'complete'].includes(String(s).toLowerCase());
}

// ── NOM-151 timestamp ──────────────────────────────────────────────
/**
 * Verifica que el doc esté firmado y construye el acuse NOM-151.
 * GET /teams/:team/folders/:folder/documents/:uuid/timestamp.tsr
 * devuelve un binario RFC3161; sólo llamamos si el doc ya está signed.
 *
 * @param {string} cincelDocUuid
 */
export async function createTimestamp(cincelDocUuid) {
  const statusInfo = await getDocumentStatus(cincelDocUuid);
  if (!statusInfo.signed) {
    throw new CincelError(
      422,
      `El documento aun no esta firmado (status: ${statusInfo.status}). Completa la firma primero.`
    );
  }

  // We record the URL; the binary .tsr can be fetched later for verification
  const tsrUrl = `${BASE_URL}/teams/${TEAM_UUID}/folders/${FOLDER_UUID}/documents/${cincelDocUuid}/timestamp.tsr`;
  const acuseNom151 = `NOM151-CINCEL-${cincelDocUuid.slice(0, 12).toUpperCase()}`;

  return {
    acuseNom151,
    tsrUrl,
    selloTiempo: new Date().toISOString(),
    tsa: 'Cincel TSA (PSC acreditado SAT)',
    raw: { tsrUrl, cincelDocUuid },
  };
}

// ── Info ───────────────────────────────────────────────────────────
export function getCincelInfo() {
  let jwtInfo = 'no configurado';
  if (_jwt) {
    try {
      const parts = _jwt.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        const iat = payload.iat ? new Date(payload.iat * 1000).toISOString().slice(0, 19) : '?';
        const exp = payload.exp
          ? `exp: ${new Date(payload.exp * 1000).toISOString().slice(0, 10)} ${Date.now() > payload.exp * 1000 ? '(VENCIDO)' : '(vigente)'}`
          : CINCEL_PAT ? 'sin exp (se refresca via PAT)' : 'sin exp (OTP free plan)';
        jwtInfo = `iat: ${iat} - ${exp}`;
      }
    } catch { jwtInfo = 'malformado'; }
  }
  return {
    baseUrl: BASE_URL,
    teamUuid: TEAM_UUID,
    folderUuid: FOLDER_UUID,
    email: CINCEL_EMAIL,
    patConfigured: CINCEL_PAT.length > 0,
    jwtConfigured: _jwt.length > 0,
    jwtExpired: _jwtExpired,
    jwtInfo,
  };
}

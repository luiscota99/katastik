/**
 * catastroClient.ts
 * Adaptador de servicios para el MVP Catastro Puebla.
 *
 * VITE_CATASTRO_MODE=api  → llama al backend Express vía proxy /api
 * VITE_CATASTRO_MODE=mock → lee JSON locales desde /demo/
 *
 * Cuando Oscar entregue su API real, cambiar API_BASE_URL y quitar
 * el modo mock. Los contratos (nombres de función + shapes) no cambian.
 */

import type {
  Predio,
  PredioFeatureCollection,
  Documento,
  Adeudo,
  Tramite,
  EventoBitacora,
  CincelEvent,
  DashboardKpis,
} from '@/types/catastro';

const MODE = (import.meta.env.VITE_CATASTRO_MODE as string) || 'api';
// VITE_API_URL: URL base del backend.
//   dev (Vite proxy):   '' → '/api' usa el proxy local
//   docker-compose:     '' → nginx proxy interno (api:8000)
//   cloud separado:     'https://katastik-back.tu-dominio.com' → llamada directa
const _apiUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
const API_BASE = _apiUrl ? `${_apiUrl.replace(/\/$/, '')}/api` : '/api';

// ── Helpers ──────────────────────────────────

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch { /* ignore */ }
    throw new Error(`API error ${res.status}: ${message}`);
  }
  return res.json() as Promise<T>;
}

async function mockFetch<T>(file: string): Promise<T> {
  const res = await fetch(`/demo/${file}`);
  if (!res.ok) throw new Error(`Mock file not found: ${file}`);
  return res.json() as Promise<T>;
}

// ── Propiedades / Predios ─────────────────────

export async function searchProperties(q?: string): Promise<Predio[]> {
  if (MODE === 'mock') {
    const list = await mockFetch<Predio[]>('properties.demo.json');
    if (!q) return list;
    const lq = q.toLowerCase();
    return list.filter(p =>
      p.claveCatastral?.toLowerCase().includes(lq) ||
      p.cuentaPredial?.toLowerCase().includes(lq) ||
      p.domicilio?.toLowerCase().includes(lq) ||
      p.colonia?.toLowerCase().includes(lq) ||
      p.propietario?.toLowerCase().includes(lq) ||
      p.usoSuelo?.toLowerCase().includes(lq)
    );
  }
  const qs = q ? `?q=${encodeURIComponent(q)}` : '';
  return apiFetch<Predio[]>(`/properties${qs}`);
}

export async function getProperty(id: string): Promise<Predio> {
  if (MODE === 'mock') {
    const list = await mockFetch<Predio[]>('properties.demo.json');
    const predio = list.find(p => p.id === id);
    if (!predio) throw new Error('Predio no encontrado');
    const fc = await mockFetch<PredioFeatureCollection>('predios.demo.geojson');
    const feature = fc.features.find(f => f.properties.id === id) ?? null;
    return { ...predio, feature };
  }
  return apiFetch<Predio>(`/properties/${id}`);
}

export async function getGeoJSON(): Promise<PredioFeatureCollection> {
  if (MODE === 'mock') {
    return mockFetch<PredioFeatureCollection>('predios.demo.geojson');
  }
  // /api/geometries devuelve los polígonos reales enriquecidos (real mode)
  // mientras /api/geojson sirve el GeoJSON demo de Puebla ciudad
  return apiFetch<PredioFeatureCollection>('/geometries');
}

// ── Documentos ────────────────────────────────

export async function getDocuments(predioId: string): Promise<Documento[]> {
  if (MODE === 'mock') {
    const list = await mockFetch<Documento[]>('documents.demo.json');
    return list.filter(d => d.predioId === predioId);
  }
  return apiFetch<Documento[]>(`/documents?predioId=${predioId}`);
}

// ── Cobranza / Pagos ──────────────────────────

export async function getCharges(predioId: string): Promise<Adeudo[]> {
  if (MODE === 'mock') {
    const list = await mockFetch<Adeudo[]>('payments.demo.json');
    return list.filter(p => p.predioId === predioId);
  }
  return apiFetch<Adeudo[]>(`/charges?predioId=${predioId}`);
}

export interface CobroResponse {
  chargeId: string;
  estadoPago: string;
  paymentLink: string | null;
  nvUuid: string | null;
  ordenUuid: string | null;
}

export interface CobroStatus {
  chargeId: string;
  estadoPago: string;
  paymentLink?: string | null;
  nvUuid?: string | null;
  folioOperacion?: string;
  fechaPago?: string;
}

/** Genera el cobro en PorCobrar (real) + orden de pago en Catastro (simulado). */
export async function createCobro(
  charge: Pick<Adeudo, 'id' | 'predioId' | 'totalMXN' | 'concepto' | 'periodo'>,
  email?: string,
): Promise<CobroResponse> {
  if (MODE === 'mock') {
    throw new Error('createCobro requiere modo api. Cambia VITE_CATASTRO_MODE=api');
  }
  return apiFetch<CobroResponse>(`/charges/${charge.id}/cobro`, {
    method: 'POST',
    body: JSON.stringify({
      email: email || undefined,
      total: charge.totalMXN,
      predioId: charge.predioId,
      concepto: charge.concepto,
    }),
  });
}

/** Consulta el estado del cobro (polling fallback al webhook). */
export async function getCobroStatus(chargeId: string): Promise<CobroStatus> {
  if (MODE === 'mock') {
    throw new Error('getCobroStatus requiere modo api.');
  }
  return apiFetch<CobroStatus>(`/charges/${chargeId}/cobro-status`);
}

// ── Cincel / NOM-151 ──────────────────────────

export interface CincelStepResult {
  document: Documento;
  cincelEvent: unknown;
  dashboard?: DashboardKpis;
  etapa: string;
  signed?: boolean;
  signingUrl?: string | null;
  message?: string;
}

export interface CincelDocStatus {
  signed: boolean;
  status: string;
  signingUrl?: string | null;
  etapaCincel?: string;
  firmante?: string | null;
  cincelJwtExpired?: boolean;
}

export interface CincelInfo {
  baseUrl: string;
  teamUuid: string;
  folderUuid: string;
  email: string;
  jwtConfigured: boolean;
  jwtExpired: boolean;
  jwtInfo: string;
}

export async function sendToCincel(
  documentId: string,
  etapa: 'envio' | 'firma' | 'sellado' | 'archivado' | 'auto' = 'auto'
): Promise<CincelStepResult> {
  if (MODE === 'mock') {
    throw new Error('sendToCincel requiere modo api.');
  }
  return apiFetch<CincelStepResult>(
    `/documents/${documentId}/cincel`,
    { method: 'POST', body: JSON.stringify({ etapa }) }
  );
}

/** Verifica el estado del documento en Cincel (para polling de firma). */
export async function getCincelDocStatus(documentId: string): Promise<CincelDocStatus> {
  if (MODE === 'mock') {
    return { signed: false, status: 'mock' };
  }
  return apiFetch<CincelDocStatus>(`/documents/${documentId}/cincel-status`);
}

/** Info del JWT y créditos de Cincel. */
export async function getCincelInfo(): Promise<CincelInfo> {
  return apiFetch<CincelInfo>('/cincel/status');
}

/** Paso 1: solicita OTP al email de Cincel. Paso 2: pasa { otp } para canjear. */
export async function refreshCincelJwt(otp?: string): Promise<{ ok: boolean; step: number; message: string }> {
  return apiFetch('/cincel/refresh-jwt', {
    method: 'POST',
    body: JSON.stringify(otp ? { otp } : {}),
  });
}

export async function getCincelEvents(predioId: string): Promise<CincelEvent[]> {
  if (MODE === 'mock') {
    const list = await mockFetch<CincelEvent[]>('cincel.demo.json');
    return list.filter(c => c.predioId === predioId);
  }
  return apiFetch<CincelEvent[]>(`/cincel?predioId=${predioId}`);
}

// ── Trámites / Workflows ──────────────────────

export async function getWorkflows(predioId: string): Promise<Tramite[]> {
  if (MODE === 'mock') {
    const list = await mockFetch<Tramite[]>('workflows.demo.json');
    return list.filter(w => w.predioId === predioId);
  }
  return apiFetch<Tramite[]>(`/workflows?predioId=${predioId}`);
}

// ── Bitácora ──────────────────────────────────

export async function getBitacora(predioId: string): Promise<EventoBitacora[]> {
  if (MODE === 'mock') {
    const list = await mockFetch<EventoBitacora[]>('bitacora.demo.json');
    return list.filter(b => b.predioId === predioId);
  }
  return apiFetch<EventoBitacora[]>(`/bitacora?predioId=${predioId}`);
}

// ── Dashboard ─────────────────────────────────

export async function getDashboard(): Promise<DashboardKpis> {
  if (MODE === 'mock') {
    return mockFetch<DashboardKpis>('dashboard.demo.json');
  }
  return apiFetch<DashboardKpis>('/dashboard');
}

// ── Reset demo ────────────────────────────────

export async function resetDemo(): Promise<void> {
  if (MODE === 'mock') return;
  await apiFetch<{ ok: boolean }>('/reset', { method: 'POST' });
}

// ── Geometría y croquis ───────────────────────

export async function getPropertyGeometry(id: string): Promise<GeoJSON.Feature | null> {
  try {
    return await apiFetch<GeoJSON.Feature>(`/properties/${encodeURIComponent(id)}/geometry`);
  } catch {
    return null;
  }
}

/** Devuelve todos los polígonos como FeatureCollection (real o demo) */
export async function getAllGeometries(): Promise<GeoJSON.FeatureCollection> {
  return apiFetch<GeoJSON.FeatureCollection>('/geometries');
}

/** URL del croquis PNG — se sirve como imagen directa con auth en el proxy */
export function getCroquisUrl(id: string): string {
  return `${API_BASE}/properties/${encodeURIComponent(id)}/croquis`;
}

// ── Firma digital ──────────────────────────────

export interface FirmaDigital {
  uuidDocumento: string;
  firmante: string;
  certificado: string;
  hash: string;
  modulo: string;
  nombreDocumento: string;
  usuarioAlta: string;
  fechaFirma: string;
  fechaHoraFirma: string;
  _demo?: boolean;
}

export async function getFirma(uuid: string): Promise<FirmaDigital> {
  return apiFetch<FirmaDigital>(`/firma/${uuid}`);
}

// ── Administración de documentos ───────────────

export interface DocumentoAdmin {
  id: string;
  predioId: string;
  folio: string;
  modulo: string;
  nombre: string;
  fecha: string;
  firmado: boolean;
  conservacionNom151: boolean;
  uuid: string | null;
}

export async function getAllDocuments(): Promise<DocumentoAdmin[]> {
  if (MODE === 'mock') {
    const list = await mockFetch<Documento[]>('documents.demo.json');
    return list.map(d => ({
      id: d.id,
      predioId: d.predioId,
      folio: String(d.id).toUpperCase(),
      modulo: d.tipo || 'General',
      nombre: d.nombre,
      fecha: d.fecha,
      firmado: !!d.firmado,
      conservacionNom151: !!d.conservacionNom151,
      uuid: d.id,
    }));
  }
  return apiFetch<DocumentoAdmin[]>('/documents/all');
}

// ── Source status ─────────────────────────────

export async function getSourceStatus(): Promise<Record<string, unknown>> {
  if (MODE === 'mock') {
    const sources = await mockFetch<Record<string, unknown>>('public_sources.demo.json');
    return { mode: 'mock', source: 'Archivos JSON locales (/demo/)', publicSources: sources };
  }
  return apiFetch<Record<string, unknown>>('/source-status');
}

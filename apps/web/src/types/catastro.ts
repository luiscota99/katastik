import type { Feature, Polygon, MultiPolygon, FeatureCollection } from 'geojson';

export interface Predio {
  id: string;
  claveCatastral: string;
  cuentaPredial: string;
  domicilio: string;
  colonia: string;
  zona: string;
  propietario: string;
  usoSuelo: string;
  superficieTerrenoM2: number;
  superficieConstruccionM2: number;
  valorCatastralMXN: number;
  baseGravableMXN?: number;
  sinValorCatastral?: boolean;
  estadoPredio: string;
  fuente?: string;
  nota?: string;
  // Adjunto desde API
  feature?: PredioFeature | null;
}

export interface PredioProperties {
  id: string;
  cco?: string;
  claveCatastral?: string;
  colonia?: string;
  domicilio?: string;
  propietario?: string;
  usoSuelo?: string;
  zonaValor?: string;
  estadoPredio?: string;
  estadoPago?: string;
  adeudoMXN?: number;
  valorCatastralMXN?: number;
  precioPorM2?: number;
  superficieM2?: number;
  source?: string;
  disclaimer?: string;
}

export type PredioFeature = Feature<Polygon | MultiPolygon, PredioProperties>;
export type PredioFeatureCollection = FeatureCollection<Polygon | MultiPolygon, PredioProperties>;

export interface Documento {
  id: string;
  predioId: string;
  tipo: string;
  nombre: string;
  fecha: string;
  estado: string;
  firmado: boolean;
  conservacionNom151: boolean;
  urlDemo: string;
}

export interface Adeudo {
  id: string;
  predioId: string;
  concepto: string;
  periodo: string;
  montoBaseMXN: number;
  recargosMXN: number;
  descuentosMXN: number;
  multasMXN?: number;
  totalMXN: number;
  referencia: string | null;
  estadoPago: 'pendiente' | 'referencia_generada' | 'cobro_generado' | 'pagado';
  fechaLimite?: string;
  fechaPago?: string;
  folioPago?: string;
  // PorCobrar
  paymentLink?: string | null;
  nvUuid?: string | null;
}

export interface Tramite {
  id: string;
  predioId: string;
  tipo: string;
  estado: string;
  responsable: string;
  fechaIngreso: string;
  documentosRequeridos: string[];
}

export interface EventoBitacora {
  id: string;
  predioId: string;
  evento: string;
  usuario: string;
  fechaHora: string;
  detalle: string;
}

export interface CincelEvent {
  id: string;
  predioId: string;
  documentId: string;
  provider: string;
  status: 'enviado' | 'sellado_nom151';
  timestamp: string;
  nom151: boolean;
  acuseDemo: string;
}

export interface DashboardKpis {
  generatedAt: string;
  totalPredios: number;
  prediosActivos: number;
  adeudoTotalMXN: number;
  pagosSimulados: number;
  documentos: number;
  documentosNom151: number;
  tramitesAbiertos: number;
  fuente: string;
}

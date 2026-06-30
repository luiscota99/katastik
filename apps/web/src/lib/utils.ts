import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatCurrencyM(amount: number): string {
  const millones = amount / 1000000;
  return `$${millones.toFixed(1)}M`;
}

export function formatPercentage(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

export function formatDateLong(dateStr: string): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat('es-MX').format(num);
}

export function getProgressColor(value: number): string {
  if (value < 40) return '#DC2626';
  if (value < 80) return '#D69E2E';
  return '#38A169';
}

export function getObraStatusColor(status: string): string {
  const colors: Record<string, string> = {
    'en_ejecucion_a_tiempo': '#38A169',
    'en_ejecucion_retraso': '#DD6B20',
    'concluida': '#2B6CB0',
    'en_riesgo': '#E53E3E',
    'en_preparacion': '#4A5568',
    'en_revision': '#3182CE',
    'suspendida': '#718096',
    'en_adjudicacion': '#68D391',
    'en_licitacion': '#805AD5',
    'cancelada': '#2D3748',
    'cerrada': '#276749',
  };
  return colors[status] || '#718096';
}

export function getObraStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    'en_ejecucion_a_tiempo': 'En ejecucion',
    'en_ejecucion_retraso': 'Con retraso',
    'concluida': 'Concluida',
    'en_riesgo': 'En riesgo',
    'en_preparacion': 'En preparacion',
    'en_revision': 'En revision',
    'suspendida': 'Suspendida',
    'en_adjudicacion': 'En adjudicacion',
    'en_licitacion': 'En licitacion',
    'cancelada': 'Cancelada',
    'cerrada': 'Cerrada',
  };
  return labels[status] || status;
}

export function getSeverityColor(sev: string): string {
  const colors: Record<string, string> = {
    'critica': '#E53E3E',
    'alta': '#DD6B20',
    'media': '#D69E2E',
    'baja': '#3182CE',
  };
  return colors[sev] || '#718096';
}

export function getSeverityLabel(sev: string): string {
  const labels: Record<string, string> = {
    'critica': 'Critica',
    'alta': 'Alta',
    'media': 'Media',
    'baja': 'Baja',
  };
  return labels[sev] || sev;
}

export function getRiesgoColor(nivel: string): string {
  const colors: Record<string, string> = {
    'bajo': '#38A169',
    'medio': '#D69E2E',
    'alto': '#DD6B20',
    'critico': '#E53E3E',
  };
  return colors[nivel] || '#718096';
}

export function getRiesgoLabel(nivel: string): string {
  const labels: Record<string, string> = {
    'bajo': 'Bajo',
    'medio': 'Medio',
    'alto': 'Alto',
    'critico': 'Critico',
  };
  return labels[nivel] || nivel;
}

export function getTipoObraLabel(tipo: string): string {
  const labels: Record<string, string> = {
    'pavimentacion_urbana': 'Pavimentacion',
    'infraestructura_educativa': 'Educacion',
    'drenaje_saneamiento': 'Drenaje',
    'electrificacion': 'Electrificacion',
    'agua_potable': 'Agua Potable',
    'espacios_publicos': 'Espacios Publicos',
    'salud': 'Salud',
    'proteccion_civil': 'Proteccion Civil',
    'infraestructura_comercial': 'Comercial',
    'patrimonio_cultural': 'Patrimonio',
    'puentes_vialidades': 'Puentes',
    'caminos_rurales': 'Caminos',
    'alumbrado_publico': 'Alumbrado',
  };
  return labels[tipo] || tipo;
}

export function getProgramaColor(id: string): string {
  const colors: Record<string, string> = {
    'fise': '#1B3A5C', 'fism': '#0D7377', 'fortamun': '#E8913A',
    'fais': '#38A169', 'faeispum': '#D69E2E', 'pem': '#3182CE',
    'pds': '#805AD5', 'proteccion-civil': '#DD6B20',
  };
  return colors[id] || '#718096';
}

export function getProgramaName(id: string): string {
  const names: Record<string, string> = {
    'fise': 'FISE', 'fism': 'FISM', 'fortamun': 'FORTAMUN',
    'fais': 'FAIS', 'faeispum': 'FAEISPUM', 'pem': 'PEM',
    'pds': 'PDS', 'proteccion-civil': 'PPAD',
  };
  return names[id] || id.toUpperCase();
}

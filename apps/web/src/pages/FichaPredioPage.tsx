import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  getProperty, getDocuments, getCharges, getBitacora, getWorkflows,
} from '@/lib/catastroClient';
import { PredioMapaWidget } from '@/components/mapa/PredioMapaWidget';
import { useCatastro } from '@/context/CatastroContext';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ReciboPredial } from '@/components/predial/ReciboPredial';
import { FlujoPago } from '@/components/predial/FlujoPago';
import { FlujoFirmaNom151 } from '@/components/firma/FlujoFirmaNom151';
import type {
  Predio, Documento, Adeudo, EventoBitacora, Tramite,
} from '@/types/catastro';
import {
  ArrowLeft, Building2, FileText, CreditCard, ScrollText,
  Send, CheckCircle2, AlertCircle, Clock, RefreshCw, Wifi, Receipt, ShieldCheck,
} from 'lucide-react';

function estadoPagoLabel(estado: string) {
  const map: Record<string, { label: string; color: string }> = {
    pendiente: { label: 'Pendiente', color: 'bg-orange-100 text-orange-700 border-orange-200' },
    referencia_generada: { label: 'Ref. Generada', color: 'bg-blue-100 text-blue-700 border-blue-200' },
    cobro_generado: { label: 'Cobro generado', color: 'bg-blue-100 text-blue-700 border-blue-200' },
    pagado: { label: 'Pagado', color: 'bg-green-100 text-green-700 border-green-200' },
  };
  return map[estado] ?? { label: estado, color: 'bg-gray-100 text-gray-600 border-gray-200' };
}

function estadoPredioLabel(estado: string) {
  const map: Record<string, { label: string; color: string }> = {
    activo:     { label: 'Activo',          color: 'bg-green-100 text-green-700' },
    exento:     { label: 'Exento',          color: 'bg-purple-100 text-purple-700' },
    con_adeudo: { label: 'Con adeudo',      color: 'bg-red-100 text-red-700' },
    al_corriente:{ label: 'Al corriente',   color: 'bg-green-100 text-green-700' },
    bloqueado:  { label: 'Bloqueado',       color: 'bg-gray-200 text-gray-700' },
  };
  return map[estado] ?? { label: estado, color: 'bg-gray-100 text-gray-600' };
}

export default function FichaPredioPage() {
  const { predioId } = useParams<{ predioId: string }>();
  const navigate = useNavigate();
  const { invalidateDashboard } = useCatastro();

  const [predio, setPredio] = useState<Predio | null>(null);
  const [documents, setDocuments] = useState<Documento[]>([]);
  const [charges, setCharges] = useState<Adeudo[]>([]);
  const [bitacora, setBitacora] = useState<EventoBitacora[]>([]);
  const [workflows, setWorkflows] = useState<Tramite[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('resumen');
  const [actioning, setActioning] = useState<string | null>(null);
  const [reciboCharge, setReciboCharge] = useState<Adeudo | null>(null);
  const [firmaDoc, setFirmaDoc] = useState<Documento | null>(null);
  const [pagoCharge, setPagoCharge] = useState<Adeudo | null>(null);

  const load = useCallback(async () => {
    if (!predioId) return;
    setLoading(true);
    try {
      const [p, docs, chgs, bita, wf] = await Promise.all([
        getProperty(predioId),
        getDocuments(predioId),
        getCharges(predioId),
        getBitacora(predioId),
        getWorkflows(predioId),
      ]);
      setPredio(p);
      setDocuments(docs);
      setCharges(chgs);
      setBitacora(bita);
      setWorkflows(wf);
    } catch (e) {
      toast.error('Error cargando la ficha del predio');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [predioId]);

  useEffect(() => { void load(); }, [load]);


  const handleSendToCincel = (doc: Documento) => {
    setFirmaDoc(doc);
  };

  const handleFirmaComplete = async (updatedDoc: Documento) => {
    setDocuments(ds => ds.map(d => d.id === updatedDoc.id ? updatedDoc : d));
    const newBita = await getBitacora(predioId!);
    setBitacora(newBita);
    invalidateDashboard();
    toast.success('Documento archivado con conservación NOM-151');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1B3A5C]" />
      </div>
    );
  }

  if (!predio) {
    return (
      <div className="text-center py-16 text-gray-500">
        Predio no encontrado.{' '}
        <button className="text-[#1B3A5C] underline" onClick={() => navigate(-1)}>Volver</button>
      </div>
    );
  }

  const estadoBadge = estadoPredioLabel(predio.estadoPredio);
  const isRealSource = predio.fuente === 'API real municipio 078';
  const ext = predio as Predio & { sinValorCatastral?: boolean; baseGravableMXN?: number };
  const sinValorCatastral = !!ext.sinValorCatastral;
  const baseGravableMXN = ext.baseGravableMXN ?? 0;

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="text-gray-500 hover:text-[#1B3A5C] transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-bold text-[#1B3A5C]">{predio.claveCatastral || predio.id}</h1>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${estadoBadge.color}`}>
              {estadoBadge.label}
            </span>
            {isRealSource ? (
              <span className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5 flex items-center gap-1">
                <Wifi className="w-3 h-3" /> API real
              </span>
            ) : (
              <span className="text-xs text-amber-600 bg-amber-50 rounded px-2 py-0.5">Demo</span>
            )}
          </div>
          <p className="text-sm text-gray-500">{predio.domicilio || '—'}</p>
        </div>
        <button
          onClick={load}
          className="text-gray-400 hover:text-gray-700"
          title="Recargar"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Banner contextual */}
      {isRealSource ? (
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-green-50 border border-green-200 text-green-800 text-xs">
          <Wifi className="w-3.5 h-3.5 flex-shrink-0" />
          Datos reales del Municipio de San Cristóbal de las Casas (CCO: {predio.id}). Pago: PorCobrar (stage). Firma: Cincel real.
        </div>
      ) : (
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          DATOS DEMO — ficticios. No representan un predio real.
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full justify-start bg-white border border-gray-200 rounded-xl p-1 h-auto">
          <TabsTrigger value="resumen" className="flex items-center gap-1.5 text-sm">
            <Building2 className="w-4 h-4" /> Resumen
          </TabsTrigger>
          <TabsTrigger value="expediente" className="flex items-center gap-1.5 text-sm">
            <FileText className="w-4 h-4" /> Expediente
            <Badge variant="secondary" className="ml-1 text-[10px]">{documents.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="cobranza" className="flex items-center gap-1.5 text-sm">
            <CreditCard className="w-4 h-4" /> Cobranza
            <Badge variant="secondary" className="ml-1 text-[10px]">{charges.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="bitacora" className="flex items-center gap-1.5 text-sm">
            <ScrollText className="w-4 h-4" /> Bitácora
            <Badge variant="secondary" className="ml-1 text-[10px]">{bitacora.length}</Badge>
          </TabsTrigger>
        </TabsList>

        {/* ── TAB: RESUMEN ─────────────────────── */}
        <TabsContent value="resumen" className="mt-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Ficha Catastral</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              {[
                { label: 'Clave Catastral', value: predio.claveCatastral },
                { label: 'Cuenta Predial', value: predio.cuentaPredial },
                { label: 'Propietario', value: predio.propietario },
                { label: 'Colonia', value: predio.colonia },
                { label: 'Zona', value: predio.zona },
                { label: 'Uso de Suelo', value: predio.usoSuelo },
                { label: 'Sup. Terreno', value: predio.superficieTerrenoM2 > 0 ? `${predio.superficieTerrenoM2.toLocaleString('es-MX')} m²` : '—' },
                { label: 'Sup. Construcción', value: predio.superficieConstruccionM2 > 0 ? `${predio.superficieConstruccionM2.toLocaleString('es-MX')} m²` : '—' },
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col gap-0.5">
                  <span className="text-xs text-gray-400 uppercase tracking-wide">{label}</span>
                  <span className="font-medium text-gray-800">{value || '—'}</span>
                </div>
              ))}

              {/* Valor Catastral */}
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-gray-400 uppercase tracking-wide">Valor Catastral</span>
                {sinValorCatastral ? (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium text-amber-600">$0 — Sin avalúo</span>
                    <span
                      className="inline-flex items-center gap-1 text-[10px] bg-amber-50 border border-amber-200 text-amber-700 px-1.5 py-0.5 rounded-full cursor-help"
                      title="El municipio no ha realizado el avalúo catastral formal de este predio. El valor catastral registrado es $0."
                    >
                      <AlertCircle className="w-3 h-3" /> Pendiente de avalúo
                    </span>
                  </div>
                ) : (
                  <span className="font-medium text-[#1B3A5C] text-base">{formatCurrency(predio.valorCatastralMXN)}</span>
                )}
              </div>

              {/* Base Gravable — siempre visible si hay dato */}
              {baseGravableMXN > 0 && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-gray-400 uppercase tracking-wide flex items-center gap-1">
                    Base Gravable
                    <span
                      className="cursor-help text-gray-300 hover:text-gray-500"
                      title="Valor sobre el que se calcula el impuesto predial. Puede diferir del valor catastral por factores de actualización (INPC) o por avalúo comercial."
                    >
                      ⓘ
                    </span>
                  </span>
                  <span className="font-medium text-[#1B3A5C] text-base">{formatCurrency(baseGravableMXN)}</span>
                  <span className="text-[10px] text-gray-400">Base para cálculo del predial</span>
                </div>
              )}

              {/* Estado con badge de color */}
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-gray-400 uppercase tracking-wide">Estado</span>
                <div>
                  <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${estadoBadge.color}`}>
                    {estadoBadge.label}
                  </span>
                  {predio.estadoPredio === 'exento' && (
                    <p className="text-xs text-gray-400 mt-0.5">Exento de pago de predial</p>
                  )}
                </div>
              </div>
            </div>

            {/* Visor 2D/Croquis del predio (solo modo real) */}
            {isRealSource && predioId && (
              <PredioMapaWidget
                predioId={predioId}
                area={predio.superficieTerrenoM2 ? `${predio.superficieTerrenoM2.toLocaleString('es-MX')} m²` : undefined}
              />
            )}

            {/* Trámites */}
            {workflows.length > 0 && (
              <div className="mt-5 pt-5 border-t border-gray-100">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Trámites Activos</h3>
                <div className="space-y-2">
                  {workflows.map(w => {
                    const wExt = w as Tramite & { nota?: string; etapa?: string; pasos?: { orden: number; descripcion: string; completado: boolean }[] };
                    const estadoColors: Record<string, string> = {
                      en_revision:     'bg-blue-50 text-blue-700 border-blue-200',
                      pendiente_firma: 'bg-amber-50 text-amber-700 border-amber-200',
                      aprobado:        'bg-green-50 text-green-700 border-green-200',
                      rechazado:       'bg-red-50 text-red-700 border-red-200',
                    };
                    const pasos = wExt.pasos ?? [];
                    const completados = pasos.filter(p => p.completado).length;
                    return (
                      <div key={w.id} className="p-3 bg-gray-50 rounded-lg space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex-1">
                            <div className="text-sm font-medium text-gray-800">{w.tipo}</div>
                            <div className="text-xs text-gray-500">{w.responsable} · {formatDate(w.fechaIngreso)}</div>
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded-full border flex-shrink-0 ${estadoColors[w.estado] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                            {w.estado.replace(/_/g,' ')}
                          </span>
                        </div>
                        {wExt.nota && (
                          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1">{wExt.nota}</p>
                        )}
                        {pasos.length > 0 && (
                          <div className="space-y-1">
                            <div className="text-[10px] text-gray-400 mb-1">Progreso: {completados}/{pasos.length} pasos</div>
                            {pasos.map(p => (
                              <div key={p.orden} className="flex items-center gap-1.5 text-xs">
                                <div className={`w-3.5 h-3.5 rounded-full flex-shrink-0 flex items-center justify-center ${p.completado ? 'bg-green-500' : 'bg-gray-200'}`}>
                                  {p.completado && <span className="text-white text-[8px]">✓</span>}
                                </div>
                                <span className={p.completado ? 'text-gray-500 line-through' : 'text-gray-700'}>{p.descripcion}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── TAB: EXPEDIENTE ──────────────────── */}
        <TabsContent value="expediente" className="mt-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">Documentos del Expediente</h2>
              <span className="text-xs text-gray-400">{documents.length} documentos</span>
            </div>
            {documents.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">Sin documentos registrados</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {documents.map(doc => {
                  const isHint = !!((doc as unknown) as Record<string, unknown>)._hint;
                  const isActioning = actioning === doc.id + '-cincel';
                  const etapaCincel = (doc as Documento & { _etapaCincel?: string })._etapaCincel;
                  const done = doc.firmado && doc.conservacionNom151 && etapaCincel === 'archivado';
                  const canSign = !done;

                  return (
                    <div key={doc.id} className={`p-4 flex items-start gap-4 ${isHint ? 'bg-amber-50' : ''}`}>
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${isHint ? 'bg-amber-100' : 'bg-blue-50'}`}>
                        <FileText className={`w-4 h-4 ${isHint ? 'text-amber-600' : 'text-blue-600'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-gray-800">
                            {(doc as Documento & { nombreLegible?: string }).nombreLegible || doc.nombre}
                          </span>
                          <span className="text-xs bg-gray-100 text-gray-500 px-1.5 rounded">{doc.tipo}</span>
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">{formatDate(doc.fecha)}</div>
                        <div className="flex gap-2 mt-1.5 flex-wrap">
                          {doc.firmado && (
                            <span className="inline-flex items-center gap-1 text-[11px] bg-green-50 text-green-700 border border-green-200 rounded px-1.5 py-0.5">
                              <CheckCircle2 className="w-3 h-3" /> Firmado
                            </span>
                          )}
                          {doc.conservacionNom151 && (
                            <span className="inline-flex items-center gap-1 text-[11px] bg-teal-50 text-teal-700 border border-teal-200 rounded px-1.5 py-0.5">
                              <CheckCircle2 className="w-3 h-3" /> NOM-151
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex-shrink-0">
                        {((doc as unknown) as Record<string, unknown>)._hint ? null : done ? (
                          <span className="text-xs text-gray-400 flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> Completo
                          </span>
                        ) : (
                          <div className="flex flex-col items-end gap-1">
                            {done ? (
                              <span className="inline-flex items-center gap-1 text-xs text-teal-700 bg-teal-50 border border-teal-200 rounded-full px-2 py-1">
                                <ShieldCheck className="w-3 h-3" /> NOM-151 completo
                              </span>
                            ) : (
                              <Button
                                size="sm"
                                variant={!etapaCincel ? 'default' : 'outline'}
                                disabled={isActioning}
                                onClick={() => handleSendToCincel(doc)}
                                className="text-xs gap-1"
                              >
                                <Send className="w-3 h-3" />
                                {!etapaCincel
                                  ? 'Firmar con NOM-151'
                                  : etapaCincel === 'envio'   ? 'Continuar firma…'
                                  : etapaCincel === 'firma'   ? 'Sellar NOM-151…'
                                  : etapaCincel === 'sellado' ? 'Archivar…'
                                  : 'Ver firma'}
                              </Button>
                            )}
                            {isRealSource && !done && (
                              <span className="text-[10px] text-teal-600">Cincel real</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── TAB: COBRANZA ────────────────────── */}
        <TabsContent value="cobranza" className="mt-4">
          <div className="space-y-4">
            {charges.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
                Sin adeudos registrados
              </div>
            ) : (
              <>
                {/* Resumen total */}
                {(() => {
                  const pending  = charges.filter(c => c.estadoPago !== 'pagado');
                  const paid     = charges.filter(c => c.estadoPago === 'pagado');
                  const totalPend = pending.reduce((s, c) => s + c.totalMXN, 0);
                  const totalPaid = paid.reduce((s, c) => s + c.totalMXN, 0);
                  return (
                    <div className="bg-[#1B3A5C] text-white rounded-xl p-4 grid grid-cols-3 gap-4 text-center">
                      <div>
                        <div className="text-xs text-blue-200 mb-0.5">Total adeudo</div>
                        <div className="text-lg font-bold">{formatCurrency(totalPend)}</div>
                        <div className="text-[10px] text-blue-300">{pending.length} bimestre{pending.length !== 1 ? 's' : ''} pendiente{pending.length !== 1 ? 's' : ''}</div>
                      </div>
                      <div>
                        <div className="text-xs text-blue-200 mb-0.5">Ya pagado</div>
                        <div className="text-lg font-bold text-green-300">{formatCurrency(totalPaid)}</div>
                        <div className="text-[10px] text-blue-300">{paid.length} bimestre{paid.length !== 1 ? 's' : ''} liquidado{paid.length !== 1 ? 's' : ''}</div>
                      </div>
                      <div>
                        <div className="text-xs text-blue-200 mb-0.5">Total registros</div>
                        <div className="text-lg font-bold">{charges.length}</div>
                        <div className="text-[10px] text-blue-300">bimestres en estado de cuenta</div>
                      </div>
                    </div>
                  );
                })()}

              {charges.map(charge => {
                const ext2 = charge as Adeudo & { gastosEjecucionMXN?: number; factorActualizacion?: number; anio?: number; bimestre?: number };
                const badge = estadoPagoLabel(charge.estadoPago);
                const isRefActioning = actioning === charge.id + '-ref';
                const isPayActioning = actioning === charge.id + '-pay';
                const gastosEjec = ext2.gastosEjecucionMXN ?? 0;
                const factAct = ext2.factorActualizacion ?? 0;

                return (
                  <div key={charge.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-800">{charge.concepto}</h3>
                        <p className="text-xs text-gray-400 mt-0.5">Periodo: {charge.periodo}{factAct > 0 ? ` · Factor actualización: ${factAct.toFixed(2)}` : ''}</p>
                      </div>
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${badge.color}`}>
                        {badge.label}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm mb-4">
                      <div>
                        <span className="text-xs text-gray-400">Impuesto base</span>
                        <div className="font-medium">{formatCurrency(charge.montoBaseMXN)}</div>
                      </div>
                      <div>
                        <span className="text-xs text-gray-400">Recargos</span>
                        <div className="font-medium text-orange-600">{formatCurrency(charge.recargosMXN)}</div>
                      </div>
                      {gastosEjec > 0 && (
                        <div>
                          <span className="text-xs text-gray-400">Gastos ejecución</span>
                          <div className="font-medium text-red-500">{formatCurrency(gastosEjec)}</div>
                        </div>
                      )}
                      {(charge.multasMXN ?? 0) > 0 && (
                        <div>
                          <span className="text-xs text-gray-400">Multas</span>
                          <div className="font-medium text-red-600">{formatCurrency(charge.multasMXN ?? 0)}</div>
                        </div>
                      )}
                      {charge.descuentosMXN > 0 && (
                        <div>
                          <span className="text-xs text-gray-400">Descuentos</span>
                          <div className="font-medium text-green-600">−{formatCurrency(charge.descuentosMXN)}</div>
                        </div>
                      )}
                      <div>
                        <span className="text-xs text-gray-400">Total</span>
                        <div className="font-bold text-[#1B3A5C] text-base">{formatCurrency(charge.totalMXN)}</div>
                      </div>
                    </div>

                    {charge.referencia && (
                      <div className="mb-4 p-2.5 bg-blue-50 rounded-lg text-xs text-blue-700 font-mono">
                        Referencia: {charge.referencia}
                        {charge.fechaLimite && (
                          <span className="ml-3 text-blue-500">· Vence: {formatDate(charge.fechaLimite)}</span>
                        )}
                      </div>
                    )}

                    {charge.estadoPago === 'pagado' ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg p-3 flex-1">
                          <CheckCircle2 className="w-4 h-4" />
                          Pago confirmado
                          {(charge as Adeudo & { fechaPago?: string }).fechaPago && (
                            <span className="text-xs text-green-500 ml-1">
                              · {new Date((charge as Adeudo & { fechaPago?: string }).fechaPago!).toLocaleString('es-MX')}
                            </span>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setReciboCharge(charge)}
                          className="gap-1"
                        >
                          <Receipt className="w-3.5 h-3.5" /> Ver recibo
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <div className="flex gap-3 flex-wrap">
                          <Button
                            size="sm"
                            disabled={isRefActioning || isPayActioning}
                            onClick={() => setPagoCharge(charge)}
                            className="gap-1.5 bg-green-600 hover:bg-green-700"
                          >
                            <CreditCard className="w-3.5 h-3.5" />
                            {charge.estadoPago === 'cobro_generado' ? 'Continuar cobro…' : 'Cobrar con PorCobrar'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setReciboCharge(charge)}
                            className="gap-1"
                          >
                            <Receipt className="w-3.5 h-3.5" /> Recibo
                          </Button>
                        </div>
                        {isRealSource && (
                          <span className="text-[10px] text-amber-600">cobro real PorCobrar (stage) · posteo a Catastro simulado</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              </>
            )}
          </div>
        </TabsContent>

        {/* ── TAB: BITÁCORA ────────────────────── */}
        <TabsContent value="bitacora" className="mt-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">Bitácora de Eventos</h2>
              <span className="text-xs text-gray-400">{bitacora.length} eventos</span>
            </div>
            {bitacora.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">Sin eventos registrados</div>
            ) : (
              <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                {bitacora.map((ev, i) => (
                  <div key={ev.id ?? i} className="px-5 py-3 flex items-start gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#1B3A5C] mt-2 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-800">{ev.evento}</span>
                      </div>
                      {ev.detalle && (
                        <p className="text-xs text-gray-500 mt-0.5 truncate">{ev.detalle}</p>
                      )}
                      <div className="text-[11px] text-gray-400 mt-0.5">
                        {ev.usuario} · {new Date(ev.fechaHora).toLocaleString('es-MX')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {reciboCharge && (
        <ReciboPredial
          charge={reciboCharge}
          predio={predio}
          onClose={() => setReciboCharge(null)}
        />
      )}

      {firmaDoc && (
        <FlujoFirmaNom151
          doc={firmaDoc}
          onClose={() => setFirmaDoc(null)}
          onComplete={(updated) => {
            setFirmaDoc(null);
            handleFirmaComplete(updated);
          }}
        />
      )}

      {pagoCharge && predio && (
        <FlujoPago
          charge={pagoCharge}
          predio={predio}
          onClose={() => setPagoCharge(null)}
          onComplete={(updated) => {
            setCharges(cs => cs.map(c => c.id === updated.id ? updated : c));
            getBitacora(predioId!).then(setBitacora);
            invalidateDashboard();
            toast.success('Pago confirmado');
          }}
          onRecibo={(c) => setReciboCharge(c)}
        />
      )}
    </div>
  );
}

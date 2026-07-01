import { useState, useEffect, useRef } from 'react';
import { sendToCincel, getCincelDocStatus } from '@/lib/catastroClient';
import { formatDate } from '@/lib/utils';
import type { Documento } from '@/types/catastro';
import {
  X, Send, PenLine, Stamp, Archive,
  CheckCircle2, Loader2, ShieldCheck, FileDigit,
  ExternalLink, RefreshCw, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

type Etapa = 'envio' | 'firma' | 'sellado' | 'archivado';
type EtapaState = 'pending' | 'active' | 'done' | 'error';

interface EtapaInfo {
  id: Etapa;
  label: string;
  sublabel: string;
  icon: React.ReactNode;
  activeMsg: string;
  doneMsg: string;
}

const ETAPAS: EtapaInfo[] = [
  {
    id: 'envio',
    label: 'Envío a Cincel',
    sublabel: 'Se genera el PDF y se sube al portal de firma',
    icon: <Send className="w-4 h-4" />,
    activeMsg: 'Generando PDF y subiendo a Cincel…',
    doneMsg: 'Documento recibido por Cincel. Link de firma generado.',
  },
  {
    id: 'firma',
    label: 'Firma Electrónica',
    sublabel: 'El firmante accede al portal Cincel y firma',
    icon: <PenLine className="w-4 h-4" />,
    activeMsg: 'Verificando firma en Cincel…',
    doneMsg: 'Firma electrónica confirmada.',
  },
  {
    id: 'sellado',
    label: 'Sello NOM-151',
    sublabel: 'TSA acreditada SAT aplica sello de tiempo',
    icon: <Stamp className="w-4 h-4" />,
    activeMsg: 'Cincel TSA aplicando sello de tiempo NOM-151…',
    doneMsg: 'Sello de tiempo emitido. Documento íntegro y fechado.',
  },
  {
    id: 'archivado',
    label: 'Conservación',
    sublabel: 'Archivo digital a largo plazo',
    icon: <Archive className="w-4 h-4" />,
    activeMsg: 'Archivando con conservación NOM-151…',
    doneMsg: 'Documento archivado. Tiene plena validez legal.',
  },
];

interface Props {
  doc: Documento;
  onClose: () => void;
  onComplete: (updatedDoc: Documento) => void;
}

interface CincelData {
  folio?: string;
  signingUrl?: string | null;
  hash?: string;
  firmante?: string;
  certSerie?: string;
  tsa?: string;
  selloTiempo?: string;
  acuseNom151?: string;
  folioArchivo?: string;
  timestamp?: string;
}

type DocExt = Documento & { _etapaCincel?: string; _cincelDocUuid?: string; nombreLegible?: string };

export function FlujoFirmaNom151({ doc, onClose, onComplete }: Props) {
  const getEtapaInicial = (): number => {
    const etapa = (doc as DocExt)._etapaCincel;
    if (!etapa) return 0;
    const idx = ETAPAS.findIndex(e => e.id === etapa);
    return idx >= 0 ? idx + 1 : 0;
  };

  const [completedSteps, setCompletedSteps] = useState(getEtapaInicial());
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [cincelData, setCincelData] = useState<CincelData>({});
  const [error, setError] = useState<string | null>(null);
  const [cincelJwtExpired, setCincelJwtExpired] = useState(false);
  const [currentDoc, setCurrentDoc] = useState<DocExt>(doc as DocExt);
  // State specific to the firma step (waiting for user to sign in portal)
  const [waitingForSignature, setWaitingForSignature] = useState(false);
  const [pollCount, setPollCount] = useState(0);
  const [iframeBlocked, setIframeBlocked] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const iframeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const allDone = completedSteps >= ETAPAS.length;
  const nextStep = completedSteps < ETAPAS.length ? completedSteps : null;
  const signingUrl = cincelData.signingUrl ?? null;
  const showIframe = waitingForSignature && !!signingUrl && !iframeBlocked;

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };
  useEffect(() => () => {
    stopPolling();
    if (iframeTimeoutRef.current) clearTimeout(iframeTimeoutRef.current);
  }, []);

  // Detectar si el iframe de Cincel se bloqueó (timeout 6s sin onLoad)
  useEffect(() => {
    if (!waitingForSignature || !signingUrl || iframeBlocked) return;
    if (iframeTimeoutRef.current) clearTimeout(iframeTimeoutRef.current);
    iframeTimeoutRef.current = setTimeout(() => setIframeBlocked(true), 6000);
    return () => { if (iframeTimeoutRef.current) clearTimeout(iframeTimeoutRef.current); };
  }, [waitingForSignature, signingUrl, iframeBlocked]);

  const getStepState = (idx: number): EtapaState => {
    if (idx < completedSteps) return 'done';
    if (idx === activeStep) return 'active';
    return 'pending';
  };

  // Start polling for signature when waiting
  useEffect(() => {
    if (!waitingForSignature) { stopPolling(); return; }
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const st = await getCincelDocStatus(currentDoc.id);
        setPollCount(c => c + 1);
        if (st.cincelJwtExpired) { setCincelJwtExpired(true); stopPolling(); return; }
        if (st.signed) {
          stopPolling();
          setWaitingForSignature(false);
          // Advance by calling the firma etapa
          await runStep(1, true);
        }
      } catch { /* retry next tick */ }
    }, 5000);
    return () => stopPolling();
  }, [waitingForSignature, currentDoc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const runStep = async (stepIdx: number, skipDelay = false) => {
    const etapa = ETAPAS[stepIdx];
    setActiveStep(stepIdx);
    setError(null);
    setCincelJwtExpired(false);

    if (!skipDelay) {
      await new Promise(r => setTimeout(r, 600));
    }

    try {
      const result = await sendToCincel(currentDoc.id, etapa.id);

      // Firma step: document not yet signed — show signing portal
      if (etapa.id === 'firma' && result.signed === false) {
        setActiveStep(null);
        setWaitingForSignature(true);
        setCincelData(prev => ({ ...prev, signingUrl: result.signingUrl || cincelData.signingUrl }));
        return;
      }

      const updated = result.document as DocExt;
      const event = result.cincelEvent as CincelData;
      setCurrentDoc(updated);
      setCincelData(prev => ({ ...prev, ...event }));
      setCompletedSteps(stepIdx + 1);
      setActiveStep(null);
      setWaitingForSignature(false);

      if (stepIdx === ETAPAS.length - 1) {
        onComplete(updated);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error en el flujo de firma';
      const expired = msg.includes('JWT') || msg.includes('expiró') || msg.includes('401');
      if (expired) setCincelJwtExpired(true);
      setError(msg);
      setActiveStep(null);
    }
  };

  const handleVerifySignature = async () => {
    stopPolling();
    setWaitingForSignature(false);
    await runStep(1);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className={`bg-white rounded-2xl shadow-2xl w-full overflow-hidden transition-all duration-300 ${showIframe ? 'max-w-4xl' : 'max-w-lg'}`}>

        {/* Header */}
        <div className="bg-[#1B3A5C] text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-teal-300" />
            <div>
              <h2 className="text-sm font-bold">Flujo de Firma NOM-151</h2>
              <p className="text-xs text-blue-200">Cincel · PSC acreditado SAT · Conservación digital real</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Documento */}
        <div className="px-6 py-3 bg-blue-50 border-b border-blue-100 flex items-center gap-3">
          <FileDigit className="w-8 h-8 text-blue-400 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-800 truncate">
              {currentDoc.nombreLegible || currentDoc.nombre}
            </div>
            <div className="text-xs text-gray-500">{currentDoc.tipo} · {formatDate(currentDoc.fecha)}</div>
          </div>
          {allDone && (
            <span className="ml-auto flex-shrink-0 inline-flex items-center gap-1 text-xs bg-teal-100 text-teal-700 border border-teal-200 rounded-full px-2 py-0.5 font-medium">
              <CheckCircle2 className="w-3 h-3" /> NOM-151
            </span>
          )}
        </div>

        {/* JWT expired warning */}
        {cincelJwtExpired && (
          <div className="mx-6 mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-amber-800">
              <div className="font-semibold mb-0.5">JWT de Cincel expirado</div>
              <div>El operador debe renovarlo desde <span className="font-mono">POST /api/cincel/refresh-jwt</span> con el OTP que llega al correo tech@humansoftware.mx.</div>
            </div>
          </div>
        )}

        {/* Steps */}
        <div className="px-6 py-4 space-y-3">
          {ETAPAS.map((etapa, idx) => {
            const stepState = getStepState(idx);
            const isFiremaWaiting = idx === 1 && waitingForSignature;
            return (
              <div
                key={etapa.id}
                className={`rounded-xl border p-3.5 transition-all ${
                  stepState === 'done'    ? 'bg-teal-50 border-teal-200' :
                  isFiremaWaiting        ? 'bg-amber-50 border-amber-300 shadow-sm' :
                  stepState === 'active' ? 'bg-blue-50 border-blue-300 shadow-sm' :
                  'bg-gray-50 border-gray-200 opacity-60'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    stepState === 'done'    ? 'bg-teal-500 text-white' :
                    isFiremaWaiting        ? 'bg-amber-500 text-white' :
                    stepState === 'active' ? 'bg-blue-500 text-white' :
                    'bg-gray-200 text-gray-400'
                  }`}>
                    {stepState === 'done'   ? <CheckCircle2 className="w-4 h-4" /> :
                     isFiremaWaiting       ? <PenLine className="w-4 h-4" /> :
                     stepState === 'active' ? <Loader2 className="w-4 h-4 animate-spin" /> :
                     etapa.icon}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-semibold ${
                      stepState === 'done' ? 'text-teal-800' :
                      isFiremaWaiting      ? 'text-amber-800' :
                      stepState === 'active' ? 'text-blue-800' : 'text-gray-500'
                    }`}>{etapa.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {isFiremaWaiting ? `Esperando firma en portal Cincel… (verificando cada 5s, intento ${pollCount})` :
                       stepState === 'active' ? etapa.activeMsg :
                       stepState === 'done'   ? etapa.doneMsg :
                       etapa.sublabel}
                    </div>
                  </div>

                  <div className="text-[10px] text-gray-400 flex-shrink-0">
                    {stepState === 'done' ? '✓' : isFiremaWaiting ? '…' : stepState === 'active' ? '…' : `${idx + 1}`}
                  </div>
                </div>

                {/* Done: technical details */}
                {stepState === 'done' && (
                  <div className="mt-2 ml-11 text-[10px] text-teal-600 font-mono space-y-0.5">
                    {idx === 0 && cincelData.folio && <div>UUID Cincel: {cincelData.folio}</div>}
                    {idx === 0 && cincelData.signingUrl && (
                      <a href={cincelData.signingUrl} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1 text-blue-600 hover:underline">
                        <ExternalLink className="w-3 h-3" /> Ver documento en Cincel
                      </a>
                    )}
                    {idx === 1 && cincelData.firmante && <div>Firmante: {cincelData.firmante}</div>}
                    {idx === 1 && cincelData.certSerie && <div>Cert: {cincelData.certSerie}</div>}
                    {idx === 1 && cincelData.hash && <div>Hash: {String(cincelData.hash).slice(0, 40)}…</div>}
                    {idx === 2 && cincelData.tsa && <div>TSA: {cincelData.tsa}</div>}
                    {idx === 2 && cincelData.acuseNom151 && <div>Acuse NOM-151: {cincelData.acuseNom151}</div>}
                    {idx === 2 && cincelData.selloTiempo && (
                      <div>Sellado: {new Date(cincelData.selloTiempo).toLocaleString('es-MX')}</div>
                    )}
                    {idx === 3 && cincelData.folioArchivo && <div>Folio archivo: {cincelData.folioArchivo}</div>}
                  </div>
                )}

                {/* Firma waiting: iframe o link/fallback */}
                {isFiremaWaiting && signingUrl && (
                  <div className="mt-3 ml-11 space-y-2">
                    {showIframe ? (
                      <div className="rounded-lg overflow-hidden border border-amber-200">
                        <iframe
                          src={signingUrl}
                          className="w-full border-0"
                          style={{ height: '480px' }}
                          title="Portal de firma Cincel"
                          onLoad={() => {
                            if (iframeTimeoutRef.current) clearTimeout(iframeTimeoutRef.current);
                          }}
                          onError={() => setIframeBlocked(true)}
                        />
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {iframeBlocked && (
                          <p className="w-full text-[11px] text-amber-700">
                            El portal no pudo cargarse aquí. Ábrelo en una nueva pestaña:
                          </p>
                        )}
                        <a href={signingUrl} target="_blank" rel="noreferrer">
                          <Button size="sm" className="gap-1.5 bg-amber-600 hover:bg-amber-700 h-7 text-xs">
                            <ExternalLink className="w-3 h-3" /> Abrir portal Cincel
                          </Button>
                        </a>
                      </div>
                    )}
                    <div className="flex gap-2">
                      {showIframe && (
                        <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs"
                          onClick={() => setIframeBlocked(true)}>
                          <ExternalLink className="w-3 h-3" /> Abrir en pestaña
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs"
                        onClick={handleVerifySignature}>
                        <RefreshCw className="w-3 h-3" /> Verificar firma
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Error */}
        {error && !cincelJwtExpired && (
          <div className="mx-6 mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="px-6 pb-5 flex items-center justify-between gap-3">
          {allDone ? (
            <div className="flex items-center gap-2 flex-1 bg-teal-50 border border-teal-200 rounded-xl px-4 py-3">
              <ShieldCheck className="w-5 h-5 text-teal-600 flex-shrink-0" />
              <div>
                <div className="text-sm font-semibold text-teal-800">Documento con conservación NOM-151</div>
                <div className="text-xs text-teal-600">Tiene plena validez probatoria. Integridad garantizada por Cincel.</div>
              </div>
            </div>
          ) : waitingForSignature ? (
            <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
              Esperando que el firmante complete la firma en el portal de Cincel…
            </div>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={onClose} disabled={activeStep !== null}>
                Cancelar
              </Button>
              <Button
                size="sm"
                disabled={activeStep !== null || nextStep === null}
                onClick={() => nextStep !== null && runStep(nextStep)}
                className="bg-[#1B3A5C] hover:bg-[#142d47] gap-1.5"
              >
                {activeStep !== null ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Procesando…</>
                ) : nextStep === 0 ? (
                  <><Send className="w-3.5 h-3.5" /> Subir a Cincel</>
                ) : nextStep === 1 ? (
                  <><PenLine className="w-3.5 h-3.5" /> Verificar firma</>
                ) : nextStep === 2 ? (
                  <><Stamp className="w-3.5 h-3.5" /> Sellar NOM-151</>
                ) : (
                  <><Archive className="w-3.5 h-3.5" /> Archivar</>
                )}
              </Button>
            </>
          )}
          {(allDone || waitingForSignature) && (
            <Button variant="outline" size="sm" onClick={onClose}>Cerrar</Button>
          )}
        </div>

        <div className="px-6 pb-4 text-center text-[10px] text-gray-300">
          Integración real con Cincel · PSC acreditado SAT · NOM-151-SCFI-2016
        </div>
      </div>
    </div>
  );
}

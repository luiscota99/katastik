import { useState, useEffect, useRef } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { createCobro, getCobroStatus } from '@/lib/catastroClient';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { Adeudo, Predio } from '@/types/catastro';
import {
  X, CreditCard, CheckCircle2, Loader2, Receipt,
  Building2, Banknote, ExternalLink, Copy, Check, Clock,
  ShieldCheck, QrCode,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

type Fase = 'inicio' | 'esperando' | 'pagado';

interface Props {
  charge: Adeudo;
  predio: Predio;
  onClose: () => void;
  onComplete: (updated: Adeudo) => void;
  onRecibo: (charge: Adeudo) => void;
}

type AdeudoExt = Adeudo & { anio?: number; bimestre?: number };

const TEST_CARD = '4242 4242 4242 4242';

export function FlujoPago({ charge, predio, onClose, onComplete, onRecibo }: Props) {
  const faseInicial: Fase =
    charge.estadoPago === 'pagado' ? 'pagado'
    : charge.estadoPago === 'cobro_generado' && charge.paymentLink ? 'esperando'
    : 'inicio';

  const [fase, setFase] = useState<Fase>(faseInicial);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentLink, setPaymentLink] = useState<string | null>(charge.paymentLink ?? null);
  const [folio, setFolio] = useState<string | null>(charge.folioPago ?? null);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const ext = charge as AdeudoExt;
  const periodoLabel = ext.anio && ext.bimestre
    ? `${ext.anio} Bim. ${ext.bimestre}`
    : (charge.periodo || formatDate(charge.fechaLimite ?? ''));

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  useEffect(() => () => stopPolling(), []);

  useEffect(() => {
    if (fase !== 'esperando') return;
    stopPolling();
    const interval = 4000;
    pollRef.current = setInterval(async () => {
      try {
        const st = await getCobroStatus(charge.id);
        if (st.estadoPago === 'pagado') {
          stopPolling();
          setFolio(st.folioOperacion ?? null);
          setFase('pagado');
          onComplete({ ...charge, estadoPago: 'pagado', fechaPago: st.fechaPago, folioPago: st.folioOperacion });
        }
      } catch { /* reintentar */ }
    }, interval);
    return () => stopPolling();
  }, [fase, charge.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // PorCobrar bloquea iframes — no intentamos cargar el iframe, vamos directo a QR/link.

  const handleCrearCobro = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await createCobro(charge, email.trim() || undefined);
      setPaymentLink(resp.paymentLink);
      setFase('esperando');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo generar el cobro en PorCobrar');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckStatus = async () => {
    try {
      const st = await getCobroStatus(charge.id);
      if (st.paymentLink && !paymentLink) setPaymentLink(st.paymentLink);
      if (st.estadoPago === 'pagado') {
        stopPolling();
        setFolio(st.folioOperacion ?? null);
        setFase('pagado');
        onComplete({ ...charge, estadoPago: 'pagado', fechaPago: st.fechaPago, folioPago: st.folioOperacion });
      }
    } catch { /* ignore */ }
  };

  const copyLink = async () => {
    if (!paymentLink) return;
    try {
      await navigator.clipboard.writeText(paymentLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard no disponible */ }
  };

  const modalMaxW = 'max-w-lg';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${modalMaxW} overflow-hidden transition-all duration-300`}>

        {/* Header */}
        <div className="bg-[#1B3A5C] text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Banknote className="w-5 h-5 text-green-300" />
            <div>
              <h2 className="text-sm font-bold">Cobro de Predial</h2>
              <p className="text-xs text-blue-200">PorCobrar · SPEI / tarjeta · conciliación automática</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {fase === 'esperando' && paymentLink && (
              <div className="flex rounded-lg border border-white/20 overflow-hidden px-2 py-1 text-xs items-center gap-1">
                <QrCode className="w-3 h-3" /> QR / Link
              </div>
            )}
            <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Predio + monto */}
        <div className="px-6 py-3 bg-blue-50 border-b border-blue-100">
          <div className="flex items-center gap-3">
            <Building2 className="w-8 h-8 text-blue-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-gray-800 truncate">{predio.domicilio}</div>
              <div className="text-xs text-gray-500">CCO: {predio.id}</div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-lg font-bold text-[#1B3A5C]">{formatCurrency(charge.totalMXN)}</div>
              <div className="text-xs text-gray-500">{periodoLabel}</div>
            </div>
          </div>
        </div>

        {/* Cuerpo */}
        <div className="px-6 py-5">

          {/* ── Inicio ── */}
          {fase === 'inicio' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Se generará una orden de pago y un cobro en PorCobrar. El contribuyente podrá pagar con
                tarjeta o SPEI desde el checkout integrado.
              </p>
              <div>
                <label className="text-xs font-medium text-gray-500">Email del contribuyente (opcional)</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="contribuyente@correo.com"
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3A5C]/30"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  Si lo capturas, PorCobrar envía el enlace por correo.
                </p>
              </div>
              {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}
            </div>
          )}

          {/* ── Esperando — vista QR/link ── */}
          {fase === 'esperando' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-blue-700">
                <Clock className="w-4 h-4" />
                Esperando pago del contribuyente…
                <Loader2 className="w-3.5 h-3.5 animate-spin ml-auto" />
              </div>

              {paymentLink ? (
                <div className="flex flex-col items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl p-4">
                  <QRCodeCanvas value={paymentLink} size={168} includeMargin />
                  <div className="flex gap-2 w-full">
                    <a href={paymentLink} target="_blank" rel="noreferrer" className="flex-1">
                      <Button size="sm" className="w-full gap-1.5 bg-[#1B3A5C] hover:bg-[#142d47]">
                        <ExternalLink className="w-3.5 h-3.5" /> Abrir checkout
                      </Button>
                    </a>
                    <Button size="sm" variant="outline" onClick={copyLink} className="gap-1.5">
                      {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? 'Copiado' : 'Copiar'}
                    </Button>
                  </div>
                  <div className="text-[10px] text-gray-400 break-all text-center">{paymentLink}</div>
                </div>
              ) : (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                  Enlace aún no disponible. Actualiza el estado en unos segundos.
                </div>
              )}

              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-800">
                <div className="font-semibold mb-1">Tarjeta de prueba (stage)</div>
                <div className="font-mono">{TEST_CARD}</div>
                <div className="text-blue-500 mt-0.5">Fecha futura cualquiera · CVC cualquiera</div>
              </div>

              <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={handleCheckStatus}>
                <Loader2 className="w-3.5 h-3.5" /> Actualizar estado manualmente
              </Button>
            </div>
          )}

          {/* ── Pagado ── */}
          {fase === 'pagado' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl p-4">
                <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-green-800">Pago confirmado</div>
                  <div className="text-xs text-green-600">El predio queda al corriente en el padrón.</div>
                </div>
              </div>
              {folio && (
                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-gray-400" />
                  <span className="text-xs text-gray-500">Folio operación:</span>
                  <span className="text-xs font-mono font-bold text-[#1B3A5C]">{folio}</span>
                </div>
              )}
              <p className="text-[10px] text-gray-400 text-center">
                Posteo al padrón municipal simulado · PorCobrar procesó el pago en stage
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 flex items-center justify-between gap-3">
          {fase === 'inicio' && (
            <>
              <Button variant="outline" size="sm" onClick={onClose} disabled={loading}>Cancelar</Button>
              <Button size="sm" onClick={handleCrearCobro} disabled={loading} className="bg-green-600 hover:bg-green-700 gap-1.5">
                {loading
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generando…</>
                  : <><CreditCard className="w-3.5 h-3.5" /> Generar cobro</>}
              </Button>
            </>
          )}
          {fase === 'esperando' && (
            <Button variant="outline" size="sm" onClick={onClose} className="ml-auto">Cerrar (sigue activo)</Button>
          )}
          {fase === 'pagado' && (
            <>
              <Button size="sm" variant="outline" className="gap-1.5 border-green-300 text-green-700"
                onClick={() => { onRecibo({ ...charge, estadoPago: 'pagado', folioPago: folio ?? undefined }); onClose(); }}>
                <Receipt className="w-3.5 h-3.5" /> Ver recibo
              </Button>
              <Button size="sm" variant="outline" onClick={onClose} className="ml-auto">Cerrar</Button>
            </>
          )}
        </div>

        <div className="px-6 pb-3 text-center text-[10px] text-gray-300">
          Cobranza real PorCobrar (stage) · posteo a Catastro simulado · flujo idéntico a producción
        </div>
      </div>
    </div>
  );
}

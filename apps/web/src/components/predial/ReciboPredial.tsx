import { useMemo } from 'react';
import { X, Printer, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/utils';
import type { Adeudo, Predio } from '@/types/catastro';

interface ReciboPredialProps {
  charge: Adeudo;
  predio: Predio;
  onClose: () => void;
}

function genFolio(charge: Adeudo): string {
  if (charge.referencia) return charge.referencia;
  const n = Math.floor(100000 + Math.random() * 899999);
  return `REC-078-${n}`;
}

export function ReciboPredial({ charge, predio, onClose }: ReciboPredialProps) {
  const folio = useMemo(() => genFolio(charge), [charge]);
  const now = new Date();
  const multas = charge.multasMXN ?? 0;

  const handlePrint = () => {
    const w = window.open('', '_blank', 'width=420,height=640');
    if (!w) return;
    const node = document.getElementById('recibo-print-area');
    w.document.write(`<!doctype html><html><head><title>Recibo ${folio}</title>
      <style>
        body{font-family:'Courier New',monospace;font-size:12px;color:#111;padding:16px;margin:0}
        .center{text-align:center}
        .row{display:flex;justify-content:space-between;margin:2px 0}
        .hr{border:none;border-top:1px dashed #999;margin:8px 0}
        .b{font-weight:700}
        .sm{font-size:10px;color:#555}
      </style></head><body>${node?.innerHTML ?? ''}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 250);
  };

  return (
    <div
      className="fixed inset-0 z-[2000] bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-sm max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header modal */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-[#1B3A5C] flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-green-600" /> Recibo generado
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Ticket (área imprimible) */}
        <div id="recibo-print-area" className="px-5 py-4 font-mono text-[12px] text-gray-800">
          <div className="center">
            <div className="b">SECRETARÍA DE FINANZAS</div>
            <div>Plataforma Digital de Consulta y Gestión Cartográfica</div>
            <div className="sm">Municipio 078 — San Cristóbal de las Casas</div>
          </div>
          <hr className="hr" />
          <div className="row"><span>Folio:</span><span className="b">{folio}</span></div>
          <div className="row"><span>Caja:</span><span>PAGO EN LÍNEA</span></div>
          <div className="row"><span>Fecha:</span><span>{now.toLocaleString('es-MX')}</span></div>
          <hr className="hr" />
          <div className="row"><span>Clave catastral:</span><span className="b">{predio.claveCatastral || predio.id}</span></div>
          <div className="row"><span>Cuenta predial:</span><span>{predio.cuentaPredial || '—'}</span></div>
          <div className="sm" style={{ marginTop: 2 }}>{predio.propietario}</div>
          <hr className="hr" />
          <div className="b" style={{ marginBottom: 4 }}>{charge.concepto}</div>
          <div className="row"><span>Periodo</span><span>{charge.periodo}</span></div>
          <div className="row"><span>Impuesto base</span><span>{formatCurrency(charge.montoBaseMXN)}</span></div>
          <div className="row"><span>Recargos</span><span>{formatCurrency(charge.recargosMXN)}</span></div>
          {multas > 0 && (
            <div className="row"><span>Multas</span><span>{formatCurrency(multas)}</span></div>
          )}
          <div className="row"><span>Descuentos</span><span>-{formatCurrency(charge.descuentosMXN)}</span></div>
          <hr className="hr" />
          <div className="row b" style={{ fontSize: 14 }}>
            <span>TOTAL PAGADO</span><span>{formatCurrency(charge.totalMXN)}</span>
          </div>
          <hr className="hr" />
          <div className="center sm">
            <div>Pago referenciado · CFDI timbrado (simulado)</div>
            <div>*** DEMO — sin validez fiscal ***</div>
            <div style={{ marginTop: 6 }}>Gracias por su pago</div>
          </div>
        </div>

        {/* Acciones */}
        <div className="px-4 py-3 border-t border-gray-100 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cerrar</Button>
          <Button size="sm" onClick={handlePrint} className="gap-1">
            <Printer className="w-3.5 h-3.5" /> Imprimir / PDF
          </Button>
        </div>
      </div>
    </div>
  );
}

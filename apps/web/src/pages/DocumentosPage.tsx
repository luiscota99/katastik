import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { getAllDocuments, getFirma } from '@/lib/catastroClient';
import type { DocumentoAdmin, FirmaDigital } from '@/lib/catastroClient';
import { formatDate } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  FileSearch, CheckCircle2, ShieldCheck, FileText, ExternalLink, Fingerprint,
} from 'lucide-react';

type MatchMode = 'igual' | 'contenga' | 'inicie' | 'termina';

const MATCH_OPTIONS: { value: MatchMode; label: string }[] = [
  { value: 'contenga', label: 'Contenga' },
  { value: 'igual', label: 'Igual a' },
  { value: 'inicie', label: 'Inicie con' },
  { value: 'termina', label: 'Termina con' },
];

function matches(value: string, query: string, mode: MatchMode): boolean {
  if (!query) return true;
  const v = value.toLowerCase();
  const q = query.toLowerCase();
  switch (mode) {
    case 'igual': return v === q;
    case 'inicie': return v.startsWith(q);
    case 'termina': return v.endsWith(q);
    case 'contenga':
    default: return v.includes(q);
  }
}

function MatchSelect({ value, onChange }: { value: MatchMode; onChange: (m: MatchMode) => void }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as MatchMode)}
      className="px-2 py-2 rounded-md border border-gray-300 text-xs bg-white text-gray-700"
    >
      {MATCH_OPTIONS.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export default function DocumentosPage() {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<DocumentoAdmin[]>([]);
  const [loading, setLoading] = useState(true);

  const [folio, setFolio] = useState('');
  const [folioMode, setFolioMode] = useState<MatchMode>('contenga');
  const [modulo, setModulo] = useState('');
  const [moduloMode, setModuloMode] = useState<MatchMode>('contenga');

  const [firmas, setFirmas] = useState<Record<string, FirmaDigital>>({});
  const [firmaLoading, setFirmaLoading] = useState<string | null>(null);

  useEffect(() => {
    getAllDocuments()
      .then(setDocs)
      .catch(() => toast.error('Error cargando documentos'))
      .finally(() => setLoading(false));
  }, []);

  const modulos = useMemo(
    () => Array.from(new Set(docs.map(d => d.modulo).filter(Boolean))).sort(),
    [docs]
  );

  const results = useMemo(
    () => docs.filter(d =>
      matches(d.folio, folio, folioMode) &&
      matches(d.modulo, modulo, moduloMode)
    ),
    [docs, folio, folioMode, modulo, moduloMode]
  );

  const handleVerFirma = async (doc: DocumentoAdmin) => {
    if (!doc.uuid) { toast.error('Documento sin UUID de firma'); return; }
    setFirmaLoading(doc.id);
    try {
      const f = await getFirma(doc.uuid);
      setFirmas(prev => ({ ...prev, [doc.id]: f }));
    } catch {
      toast.error('No se pudo obtener la firma digital');
    } finally {
      setFirmaLoading(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-[#1B3A5C] flex items-center gap-2">
          <FileSearch className="w-5 h-5" /> Administración de documentos
        </h1>
        <p className="text-sm text-gray-500">
          Búsqueda de documentos por folio o módulo · estado de firma digital
        </p>
      </div>

      {/* Buscador */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Folio</label>
            <div className="flex gap-2">
              <MatchSelect value={folioMode} onChange={setFolioMode} />
              <Input
                placeholder="Buscar por folio…"
                value={folio}
                onChange={e => setFolio(e.target.value)}
                className="text-sm"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Módulo</label>
            <div className="flex gap-2">
              <MatchSelect value={moduloMode} onChange={setModuloMode} />
              <Input
                placeholder="Buscar por módulo…"
                value={modulo}
                onChange={e => setModulo(e.target.value)}
                className="text-sm"
                list="modulos-list"
              />
              <datalist id="modulos-list">
                {modulos.map(m => <option key={m} value={m} />)}
              </datalist>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-gray-400">
            {loading ? 'Cargando…' : `${results.length} de ${docs.length} documentos`}
          </span>
          {(folio || modulo) && (
            <button
              className="text-xs text-[#1B3A5C] underline"
              onClick={() => { setFolio(''); setModulo(''); }}
            >
              Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {/* Resultados */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 flex items-center justify-center">
            <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-[#1B3A5C]" />
          </div>
        ) : results.length === 0 ? (
          <div className="p-12 text-center text-gray-400 text-sm">
            Sin documentos que coincidan con la búsqueda.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {results.map(doc => {
              const firma = firmas[doc.id];
              return (
                <div key={doc.id} className="p-4">
                  <div className="flex items-start gap-4">
                    <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-800">{doc.nombre}</span>
                        <span className="text-[11px] bg-gray-100 text-gray-500 px-1.5 rounded">{doc.modulo}</span>
                        {doc.firmado ? (
                          <span className="inline-flex items-center gap-1 text-[11px] bg-green-50 text-green-700 border border-green-200 rounded px-1.5 py-0.5">
                            <CheckCircle2 className="w-3 h-3" /> Firmado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] bg-gray-50 text-gray-500 border border-gray-200 rounded px-1.5 py-0.5">
                            Sin firma
                          </span>
                        )}
                        {doc.conservacionNom151 && (
                          <span className="inline-flex items-center gap-1 text-[11px] bg-teal-50 text-teal-700 border border-teal-200 rounded px-1.5 py-0.5">
                            <ShieldCheck className="w-3 h-3" /> NOM-151
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5 flex flex-wrap gap-x-3">
                        <span>Folio: <b className="text-gray-600">{doc.folio}</b></span>
                        <span>{formatDate(doc.fecha)}</span>
                        <span>Predio: {doc.predioId}</span>
                      </div>

                      {firma && (
                        <div className="mt-2 p-2.5 bg-gray-50 rounded-lg text-[11px] text-gray-600 space-y-0.5">
                          <div className="flex items-center gap-1 font-medium text-gray-700">
                            <Fingerprint className="w-3 h-3" /> Firma digital
                          </div>
                          <div>Firmante: {firma.firmante || '—'}</div>
                          <div>Certificado: {firma.certificado || '—'}</div>
                          <div className="font-mono break-all">Hash: {firma.hash || '—'}</div>
                          <div>Fecha: {firma.fechaHoraFirma || firma.fechaFirma || '—'}</div>
                          {firma._demo && <div className="text-amber-600">firma simulada (demo)</div>}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs gap-1"
                        disabled={firmaLoading === doc.id}
                        onClick={() => handleVerFirma(doc)}
                      >
                        <Fingerprint className="w-3.5 h-3.5" />
                        {firmaLoading === doc.id ? 'Consultando…' : 'Ver firma'}
                      </Button>
                      <button
                        className="text-[11px] text-[#1B3A5C] hover:underline inline-flex items-center gap-1"
                        onClick={() => navigate(`/predios/${doc.predioId}`)}
                      >
                        Ver predio <ExternalLink className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

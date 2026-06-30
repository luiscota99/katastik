import { useEffect, useState } from 'react';
import { getSourceStatus } from '@/lib/catastroClient';
import { Database, CheckCircle2, AlertCircle, Wifi, WifiOff, Key } from 'lucide-react';

export default function AdminDatosPage() {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSourceStatus()
      .then(setStatus)
      .finally(() => setLoading(false));
  }, []);

  const source = (status?.source as string) || 'demo';
  const isReal = source === 'real';

  const tokenExp = status?.tokenExpiracion as string | undefined;
  const tokenVencido = typeof tokenExp === 'string' && tokenExp.includes('VENCIDO');
  const tokenCajaOk = status?.tokenCajaConfigured as boolean | undefined;

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-xl font-bold text-[#1B3A5C]">Fuentes de Datos / API</h1>

      {loading ? (
        <div className="h-32 flex items-center justify-center">
          <div className="animate-spin h-7 w-7 rounded-full border-b-2 border-[#1B3A5C]" />
        </div>
      ) : (
        <>
          {/* Fuente activa */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${isReal ? 'bg-green-50' : 'bg-amber-50'}`}>
                {isReal
                  ? <Wifi className="w-5 h-5 text-green-600" />
                  : <Database className="w-5 h-5 text-amber-600" />
                }
              </div>
              <div>
                <div className="text-sm font-semibold text-gray-800">
                  Fuente:{' '}
                  <span className={isReal ? 'text-green-700' : 'text-amber-700'}>
                    {isReal ? 'API Real — Municipio 078' : 'Datos Demo (memoria)'}
                  </span>
                </div>
                <div className="text-xs text-gray-500">
                  {typeof status?.note === 'string' ? status.note : ''}
                </div>
              </div>
              {isReal
                ? <CheckCircle2 className="ml-auto w-5 h-5 text-green-500 flex-shrink-0" />
                : <AlertCircle className="ml-auto w-5 h-5 text-amber-500 flex-shrink-0" />
              }
            </div>

            <div className="text-sm text-gray-600 space-y-1.5">
              {isReal && (
                <>
                  <div>
                    <span className="text-gray-400">Base URL:</span>{' '}
                    <code className="text-xs bg-gray-100 rounded px-1">{String(status?.baseUrl ?? '')}</code>
                  </div>
                  <div>
                    <span className="text-gray-400">Municipio:</span>{' '}
                    <strong>{String(status?.municipio ?? '')}</strong>
                  </div>
                  <div>
                    <span className="text-gray-400">Swagger:</span>{' '}
                    <a
                      href={`${String(status?.baseUrl ?? '')}/api/swagger/swagger-ui/index.html`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 text-xs hover:underline"
                    >
                      /api/swagger/swagger-ui/index.html
                    </a>
                  </div>
                </>
              )}
              {!isReal && status?.prediosDemoEnRAM != null && (
                <div><span className="text-gray-400">Predios demo en memoria:</span> <strong>{String(status.prediosDemoEnRAM)}</strong></div>
              )}
            </div>
          </div>

          {/* Estado del token (solo modo real) */}
          {isReal && (
            <div className={`bg-white rounded-xl border shadow-sm p-5 ${tokenVencido ? 'border-red-300' : 'border-gray-200'}`}>
              <div className="flex items-center gap-3 mb-3">
                <Key className={`w-5 h-5 ${tokenVencido ? 'text-red-500' : tokenCajaOk ? 'text-green-500' : 'text-gray-400'}`} />
                <h2 className="text-sm font-semibold text-gray-700">Token JWT — CATASTRO_TOKEN_CAJA</h2>
                {tokenCajaOk
                  ? tokenVencido
                    ? <span className="ml-auto text-xs text-red-600 bg-red-50 rounded-full px-2 py-0.5 border border-red-200">VENCIDO</span>
                    : <span className="ml-auto text-xs text-green-600 bg-green-50 rounded-full px-2 py-0.5 border border-green-200">vigente</span>
                  : <span className="ml-auto text-xs text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">no configurado</span>
                }
              </div>

              {tokenExp && (
                <div className="text-sm text-gray-600">
                  <span className="text-gray-400">Expiración:</span>{' '}
                  <span className={tokenVencido ? 'text-red-600 font-semibold' : 'text-gray-800'}>
                    {tokenExp}
                  </span>
                </div>
              )}

              {tokenVencido && (
                <div className="mt-3 p-3 bg-red-50 rounded-lg text-xs text-red-700 border border-red-200">
                  El token está vencido. Solicita uno nuevo a Oscar y actualiza{' '}
                  <code className="bg-red-100 rounded px-1">CATASTRO_TOKEN_CAJA</code>{' '}
                  en <code className="bg-red-100 rounded px-1">apps/api/.env</code>, luego reinicia el servidor.
                </div>
              )}

              {!tokenCajaOk && (
                <div className="mt-3 p-3 bg-amber-50 rounded-lg text-xs text-amber-700 border border-amber-200">
                  Token no configurado. Copia <code className="bg-amber-100 rounded px-1">apps/api/.env.example</code>{' '}
                  a <code className="bg-amber-100 rounded px-1">apps/api/.env</code> y pega el JWT de Oscar.
                </div>
              )}
            </div>
          )}

          {/* Instrucciones modo demo → real */}
          {!isReal && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">
                Conectar a la API real del municipio 078
              </h2>
              <ol className="text-sm text-gray-600 space-y-2 list-decimal list-inside">
                <li>
                  Copiar <code className="bg-gray-100 rounded px-1 text-xs">apps/api/.env.example</code>{' '}
                  a <code className="bg-gray-100 rounded px-1 text-xs">apps/api/.env</code>
                </li>
                <li>
                  Pegar los tokens de Oscar:
                  <pre className="bg-gray-50 rounded-lg p-2 text-xs mt-1 font-mono overflow-x-auto">
{`CATASTRO_SOURCE=real
CATASTRO_TOKEN_CAJA=eyJ0eXAi...
CATASTRO_TOKEN_NOTARIO=eyJ0eXAi...`}
                  </pre>
                </li>
                <li>Reiniciar el servidor: <code className="bg-gray-100 rounded px-1 text-xs">npm run dev:api</code></li>
                <li>
                  Buscar predios por CCO en la página de Predios (ej:{' '}
                  <code className="bg-gray-100 rounded px-1 text-xs font-mono">078000101001001</code>)
                </li>
              </ol>
              <div className="mt-3 text-xs text-gray-400">
                Las acciones de pago y firma siguen siendo simuladas; los datos de predio, cobranza y expedientes son reales.
              </div>
            </div>
          )}

          {/* Swagger link */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-2">
              {isReal
                ? <Wifi className="w-4 h-4 text-green-500" />
                : <WifiOff className="w-4 h-4 text-gray-400" />
              }
              <h2 className="text-sm font-semibold text-gray-700">Documentación de la API</h2>
            </div>
            <a
              href="http://134.255.227.95:6080/api/swagger/swagger-ui/index.html#/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline break-all"
            >
              http://134.255.227.95:6080/api/swagger/swagger-ui/index.html#/
            </a>
            <div className="text-xs text-gray-400 mt-1">450 endpoints · WS Traslado y avalúo · OpenAPI 3.1</div>
          </div>

          {/* Fuentes públicas (solo demo) */}
          {!isReal && status?.publicSources && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Fuentes públicas sugeridas</h2>
              <div className="space-y-3">
                {((status.publicSources as Record<string, unknown>).sources as Array<{
                  name: string; url?: string; use: string; caution?: string;
                }>)?.map((src, i) => (
                  <div key={i} className="p-3 bg-gray-50 rounded-lg text-sm">
                    <div className="font-medium text-gray-800">{src.name}</div>
                    {src.url && (
                      <a
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline"
                      >
                        {src.url}
                      </a>
                    )}
                    <p className="text-xs text-gray-500 mt-0.5">{src.use}</p>
                    {src.caution && (
                      <p className="text-xs text-amber-600 mt-0.5">{src.caution}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

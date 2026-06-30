import { useState } from 'react';
import { useCatastro } from '@/context/CatastroContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { LandPlot, Lock, User, Building, MapPin } from 'lucide-react';

const OFICINAS = [
  'Oficina Central',
  'Oficina Regional Norte',
  'Oficina Regional Sur',
  'Oficina Regional Altos',
];

const MUNICIPIOS = [
  '078 — San Cristóbal de las Casas',
  '001 — Tuxtla Gutiérrez',
  '010 — Comitán de Domínguez',
  '038 — Palenque',
];

export default function LoginPage() {
  const { login } = useCatastro();
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [oficina, setOficina] = useState(OFICINAS[0]);
  const [municipio, setMunicipio] = useState(MUNICIPIOS[0]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login({
      usuario: usuario.trim() || 'operador',
      oficina,
      municipio,
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1B3A5C] to-[#0f2236] p-4">
      <div className="w-full max-w-md">
        {/* Branding */}
        <div className="text-center mb-6 text-white">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 mb-3">
            <LandPlot className="w-9 h-9 text-[#E8913A]" />
          </div>
          <h1 className="text-2xl font-bold tracking-widest">KATASTIK</h1>
          <p className="text-sm text-white/70 mt-1">Plataforma Digital de Gestión Catastral</p>
          <p className="text-xs text-white/40 mt-0.5">Secretaría de Finanzas</p>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl shadow-2xl p-6 space-y-4"
        >
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Usuario</label>
            <div className="relative">
              <User className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
              <Input
                value={usuario}
                onChange={e => setUsuario(e.target.value)}
                placeholder="usuario"
                className="pl-8"
                autoFocus
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Contraseña</label>
            <div className="relative">
              <Lock className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
              <Input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="pl-8"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Oficina regional</label>
            <div className="relative">
              <Building className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
              <select
                value={oficina}
                onChange={e => setOficina(e.target.value)}
                className="w-full pl-8 pr-3 py-2 rounded-md border border-gray-300 text-sm bg-white text-gray-700"
              >
                {OFICINAS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Municipio</label>
            <div className="relative">
              <MapPin className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
              <select
                value={municipio}
                onChange={e => setMunicipio(e.target.value)}
                className="w-full pl-8 pr-3 py-2 rounded-md border border-gray-300 text-sm bg-white text-gray-700"
              >
                {MUNICIPIOS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          <Button type="submit" className="w-full bg-[#1B3A5C] hover:bg-[#152f4a]">
            Ingresar
          </Button>

          <p className="text-[11px] text-gray-400 text-center pt-1">
            Acceso demostrativo — sin autenticación real. Los datos de lectura provienen de la API del municipio 078.
          </p>
        </form>

        <p className="text-center text-[11px] text-white/40 mt-4">
          GovTech Labs · MVP Catastro 2026
        </p>
      </div>
    </div>
  );
}

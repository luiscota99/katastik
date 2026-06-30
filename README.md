# MVP Catastro Puebla — Demo

Demo navegable de la plataforma de modernización catastral del Municipio de Puebla.
Construida sobre el shell técnico de **arkon** (React + Vite + shadcn/ui + Leaflet + Recharts).

> **DATOS DEMO** — toda la información es ficticia y generada para presentación.  
> No representa el catastro real del Municipio de Puebla.

---

## Requisitos

- Node.js ≥ 20
- npm ≥ 10

---

## Arrancar en desarrollo

```bash
# Desde la raíz del proyecto
cd katastik
npm install
npm run dev
```

Levanta:
- **API** → http://localhost:8000 (Express, datos en memoria)  
- **Web** → http://localhost:3000 (Vite, proxy /api → 8000)

> **Importante (demo en vivo):** NO usar `--watch` ni `nodemon` durante la presentación.  
> El estado del servidor (pagos, firmas) vive en RAM y se pierde al reiniciar.  
> Para reiniciar los datos sin perder el proceso, usa el botón **"Reiniciar demo"** en el dashboard.

---

## Guion de demo (~5–7 min)

### Paso 1 — Dashboard ejecutivo (30 s)
- Abrir http://localhost:3000
- Señalar KPIs: 25 predios, adeudo pendiente, pagos simulados, documentos NOM-151
- Mencionar: "el dashboard se recalcula en tiempo real tras cada operación"
- Mostrar la mini-gráfica de distribución

### Paso 2 — Mapa catastral 2D (45 s)
- Ir a **Mapa Catastral** en el menú
- Señalar los 25 polígonos GeoJSON sobre OpenStreetMap
- Demostrar el buscador: escribir "PUE-DEMO-0003" o "Centro Historico"
- Click directo en un polígono del mapa → abre ficha

### Paso 3 — Ficha del predio (1 min)
- Predio guion: **PUE-DEMO-0003** (buscar en Predios o click en mapa)
- Tab **Resumen**: clave catastral, propietario, superficies, valor catastral
- Tab **Expediente**: ver los 4 documentos asociados
- Tab **Cobranza**: mostrar adeudo en estado "Pendiente"
- Tab **Bitácora**: ver eventos iniciales del predio

### Paso 4 — Flujo de pago simulado (1 min)
- En tab **Cobranza**:
  1. Click **"Generar Referencia"** → aparece la línea de captura
  2. Click **"Simular Pago"** → estado cambia a "Pagado"
- Ir a tab **Bitácora** → ver el nuevo evento de pago registrado
- Volver al **Dashboard** → adeudo pendiente ya no incluye este predio

### Paso 5 — Flujo Cincel / NOM-151 (1 min)
- Ir a tab **Expediente**:
  1. Click **"Firmar (Cincel)"** en cualquier documento → badge "Firmado"
  2. Click **"Sellar NOM-151"** en el mismo documento → badge "NOM-151"
- Ir a tab **Bitácora** → ver eventos de firma y sello
- Volver al **Dashboard** → "Docs NOM-151" aumentó

### Paso 6 — Fuentes / API (30 s)
- Ir a **Fuentes / API** en el menú
- Señalar modo actual (`api` = Express local con datos demo)
- Mostrar instrucciones para conectar la API real de Oscar cuando esté disponible

### Paso 7 — Cierre (30 s)
- "Esta demo corre en modo 100% local, sin base de datos"
- "Cuando Oscar entregue el endpoint, solo cambiamos la URL en el adaptador"
- "El flujo completo: catastro → expediente → cobranza → firma → NOM-151 → dashboard"

---

## Estructura del proyecto

```
katastik/
├── data/demo/           # Datos ficticios (25 predios, documentos, pagos, etc.)
├── apps/
│   ├── api/             # Backend Express read-only (Node.js, sin BD)
│   │   └── src/index.js
│   └── web/             # Frontend React + Vite
│       ├── src/
│       │   ├── components/
│       │   │   ├── layout/   # Sidebar, TopBar, MobileDrawer
│       │   │   ├── mapa/     # MapaCatastral.tsx (react-leaflet)
│       │   │   └── ui/       # shadcn/ui components
│       │   ├── context/      # CatastroContext (sin login)
│       │   ├── lib/          # catastroClient.ts, utils.ts
│       │   ├── pages/        # Dashboard, Mapa, Ficha, Predios, Admin
│       │   └── types/        # catastro.ts
│       └── .env              # VITE_CATASTRO_MODE=api
└── README.md
```

---

## Modo Mock (sin backend)

Si el API Express no está corriendo, cambiar en `apps/web/.env`:

```
VITE_CATASTRO_MODE=mock
```

En modo mock, los datos se leen de `/public/demo/*.json` directamente en el navegador.  
**Las acciones de pago y firma NO están disponibles en modo mock** (requieren estado en servidor).

---

## Conectar API real de Oscar

1. Obtener URL, credenciales y esquema de autenticación de Oscar.
2. En `apps/web/.env`: `VITE_CATASTRO_MODE=api`
3. En `apps/web/src/lib/catastroClient.ts`: actualizar `API_BASE` con la URL real.
4. Los contratos de función no cambian; solo el endpoint de destino.

---

## Predio recomendado para guion

**PUE-DEMO-0003** — estado `pendiente`, sin referencia previa, sin firma Cincel.  
Permite demostrar el flujo completo de punta a punta.

---

*GovTech Labs · MVP Catastro Puebla · Junio 2026*

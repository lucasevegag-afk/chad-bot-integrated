# Chad Inversor Platform

Backend Node.js + Express + WebSocket que:

1. Sirve **toda la web Chad Inversor** (home, quiz, academy, bot, pagos, psicología, sesiones, noticias, etc.) desde un único servidor.
2. Aloja el **Chad Bot Scanner multi-activo 24/7** (basado en la lógica de `indexbot_3.html`).
3. Protege las **API keys** (Twelve Data, etc.) en el server: nunca se exponen al navegador.
4. Deja la arquitectura lista para **usuarios, login, pagos, alertas, panel privado y métricas propias**.

Nada del sitio actual se rediseñó. Toda la web sigue **idéntica visualmente** — solo cambió cómo se sirve y dónde corre el bot.

---

## 1. Instalación local

Requisitos: **Node.js 18+** y npm.

```bash
git clone <tu-repo>
cd chad-inversor-platform
npm install
cp .env.example .env
# Editar .env y cargar tu TWELVE_DATA_API_KEY (gratis en twelvedata.com/apikey)
npm start
```

## 2. Arranque

```bash
npm install
npm start
```

Logs esperados:

```
[INFO] [boot] Iniciando Chad Inversor Platform...
[INFO] [marketData] MarketDataManager listo
[INFO] [scanner] Iniciando scanner para: BTCUSDT, XAUUSD
[INFO] [binance] Conectando BTCUSDT 1m → wss://stream.binance.com:9443/ws/...
[INFO] [binance] ✅ Stream abierto: BTCUSDT 1m
[INFO] [ws] WebSocket server escuchando en /ws
[INFO] [boot] 🚀 Servidor escuchando en http://localhost:3000
```

## 3. Cómo acceder

| URL | Página |
| --- | --- |
| `http://localhost:3000/` | Home Chad Inversor |
| `http://localhost:3000/quiz` | Quiz (es la misma home) |
| `http://localhost:3000/academy` | Academy |
| `http://localhost:3000/bot` | **Chad Bot completo** (versión `indexbot_3.html`) |
| `http://localhost:3000/bot-classic` | Versión histórica del bot (`bot.html`) |
| `http://localhost:3000/news` | Noticias |
| `http://localhost:3000/psicologia` | Psicología del Trading |
| `http://localhost:3000/sesiones` | Sesiones |
| `http://localhost:3000/pagos` | Pagos |
| `http://localhost:3000/login` | Login |

Las URLs originales con `.html` (ej. `/index.html`, `/academy.html`) **siguen funcionando** — no se rompe ningún link interno.

## 4. API

| Endpoint | Descripción |
| --- | --- |
| `GET /api/health` | Healthcheck. Devuelve `{ ok, service, status }`. |
| `GET /api/platform/status` | Estado del sitio + bot + WS. |
| `GET /api/bot/status` | Estado del scanner: `scannerRunning`, `assets`, `activeSignals`. |
| `GET /api/bot/state/:asset` | Snapshot completo de un activo (precio, velas, bot state, señales). |
| `GET /api/bot/signals` | Últimas 50 señales emitidas. |
| `GET /api/markets/assets` | Catálogo de activos soportados. |
| `GET /api/history/:asset?tf=1m&limit=300` | Velas históricas. |
| `POST /api/analytics/event` | Trackear evento del frontend. |
| `GET /api/analytics/summary` | Contadores de eventos. |
| `POST /api/users/register` | Registrar usuario (esqueleto). |
| `GET /api/users/me` | Datos del usuario autenticado (`Authorization: Bearer <token>`). |

### WebSocket

Conexión: `ws://localhost:3000/ws`

Mensajes que el cliente puede enviar:

```json
{ "action": "subscribe",   "asset": "BTCUSDT", "timeframes": ["1m","5m"] }
{ "action": "unsubscribe", "asset": "BTCUSDT" }
{ "action": "ping" }
```

Eventos que el servidor emite:

- `system_status` — estado del sistema al conectarse.
- `price_update` — tick de precio por activo.
- `candle_update` — vela actualizada (abierta o cerrada) por timeframe.
- `bot_state_update` — cambios en `htfBias`, `tacticalBias`, `sessionState`, etc.
- `signal_detected` — señal nueva del bot.

## 5. Despliegue en Render

1. Subir este repo a GitHub.
2. En Render: **New → Web Service → conectar el repo**.
3. Configurar:
   - **Environment**: Node
   - **Build command**: `npm install`
   - **Start command**: `npm start`
   - **Health check path**: `/api/health`
4. En la pestaña **Environment** del servicio, cargar:

   | Variable | Valor |
   | --- | --- |
   | `PORT` | (Render lo asigna solo — no hace falta hardcodear) |
   | `FRONTEND_ORIGIN` | `https://chadinversor.com.ar` |
   | `TWELVE_DATA_API_KEY` | (tu API key real) |
   | `BINANCE_WS_ENABLED` | `true` |
   | `SCANNER_ASSETS` | `BTCUSDT,XAUUSD` |
   | `LOG_LEVEL` | `info` |

5. Deploy. Render dará una URL tipo `https://chad-inversor-platform.onrender.com`.
6. Apuntar `chadinversor.com.ar` (custom domain) al servicio de Render.

**Importante**: el plan gratuito de Render duerme tras 15 min de inactividad. Para un scanner 24/7 real, usar plan Starter ($7/mes) o superior.

## 6. Estructura del proyecto

```
chad-inversor-platform/
├── public/                ← Todos los HTMLs e imágenes
│   ├── index.html
│   ├── academy.html
│   ├── bot.html
│   ├── indexbot_3.html     ← versión completa del bot (base del super bot)
│   ├── chad_bot_V9.html
│   ├── psychology.html
│   ├── sesiones.html
│   ├── pagos.html
│   ├── noticias.html
│   ├── login.html
│   ├── activar.html
│   ├── logo.jpeg
│   └── img/                ← imágenes + PDFs externos (NO base64)
│
├── server/
│   ├── config/env.js
│   ├── utils/              ← logger, time, validation
│   ├── marketData/
│   │   ├── marketDataManager.js
│   │   └── providers/      ← interface, binance, twelveData
│   ├── candles/            ← agregador + store
│   ├── bot/
│   │   ├── botStateStore.js
│   │   ├── signalManager.js
│   │   ├── scanner/assetScanner.js
│   │   └── engines/        ← bias, nyManip, sessionFlow, sweepReclaim, lateralization
│   ├── services/           ← alerts, analytics, auth
│   ├── routes/             ← health, pages, bot, market, analytics, users
│   └── websocket/          ← server + broadcast
│
├── server.js
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

## 7. Política de imágenes

**Ninguna imagen se embebe** dentro del HTML/CSS/JS (no hay base64). Todas se referencian como archivos externos en `/public/img/`. Esto:

- Mantiene el HTML ligero.
- Permite a Render/Cloudflare cachear los assets eficientemente.
- Facilita el reemplazo individual de cualquier asset sin tocar código.

## 8. Próximos pasos sugeridos

- [ ] Completar los engines (`biasEngine`, `nyManipulationEngine`, …) con la lógica fina de `indexbot_3.html` (S1/S2/D1/D2 + scoring).
- [ ] Conectar `signalManager` a `alertService` con un canal real (Telegram o email).
- [ ] Migrar `authService` a JWT real con BD persistente.
- [ ] Sumar persistencia (PostgreSQL en Render) para velas, señales y usuarios.
- [ ] Conectar `analyticsService` a un proveedor externo (PostHog/Plausible).

---

Built for **chadinversor.com.ar**. Para feedback abrir un issue en el repo.

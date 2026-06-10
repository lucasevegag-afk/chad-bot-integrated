# MT5 Executor · Python service

Servidor Flask local que recibe señales del bot CHAD (en Fly) y ejecuta órdenes en MT5 Exness.

## 🚀 Setup paso a paso

### 1. Crear carpeta de trabajo

```powershell
mkdir C:\bot-mt5
cd C:\bot-mt5
```

Copiar a esta carpeta:
- `mt5_executor.py`
- `config.example.json` → renombrar a `config.json` y editar

### 2. Crear cuenta DEMO Exness

1. Ir a https://www.exness.com/ → "Open Demo Account"
2. Elegir tipo: **Raw Spread** (tighter spreads)
3. Te van a dar:
   - Login number (8 dígitos)
   - Password
   - Servidor (ej `Exness-MT5Trial7`)
4. Abrir MT5 → File → Login to Trade Account → llenar los datos

### 3. Editar `config.json`

Abrir con Notepad y reemplazar:

```json
{
  "account":  TU_LOGIN_AQUI,
  "password": "TU_PASSWORD_AQUI",
  "server":   "Exness-MT5Trial9",
  "symbol":   "XAUUSD",
  ...
}
```

**Importante**: el `api_token` debería ser un string largo y random. Generá uno acá:
https://www.uuidgenerator.net/version4 (copiá ej `8f4e2a1b-9c3d-4567-...`)

### 4. Verificar símbolo XAU en tu MT5

En MT5 → Market Watch (Ctrl+M) → buscá `XAUUSD`. Si tu Exness usa otro nombre (`XAUUSDm`, `GOLD`, etc.), poné ese en `config.json`.

### 5. Correr el servidor

```powershell
cd C:\bot-mt5
python mt5_executor.py
```

Deberías ver:
```
✅ Conectado a MT5 · Account: 12345678 · Balance: 10000 USD
🚀 Servidor escuchando en http://0.0.0.0:5000
```

### 6. Probar local

Abrir otra terminal y pegar:

```powershell
curl http://localhost:5000/health
```

Debe responder:
```json
{"ok":true,"service":"mt5-executor","time":"..."}
```

### 7. Test con auth

```powershell
$token = "TU_API_TOKEN_DE_CONFIG"
curl -H "Authorization: Bearer $token" http://localhost:5000/status
```

Debe mostrar tu balance, equity, posiciones abiertas (vacío al inicio).

### 8. Exponer al bot Fly · ngrok

Como el bot está en Fly y tu PC está local, necesitás un tunnel.

**Opción A · ngrok (recomendado)**:
1. Bajar de https://ngrok.com/download (cuenta gratis)
2. Correr:
```powershell
ngrok http 5000
```
3. Te da una URL pública tipo `https://abc123.ngrok-free.app`
4. Esa URL la usa el bot Fly para llegar a tu PC

**Opción B · Cloudflare Tunnel** (más estable, también gratis).

### 9. Configurar el bot Fly

En el repo del bot, setear estas env vars en Fly:

```
MT5_BRIDGE_URL=https://abc123.ngrok-free.app
MT5_BRIDGE_TOKEN=tu-api-token-largo
MT5_BRIDGE_ENABLED=1
```

```powershell
fly secrets set MT5_BRIDGE_URL=https://abc123.ngrok-free.app MT5_BRIDGE_TOKEN=... MT5_BRIDGE_ENABLED=1
```

### 10. Smoke test

Con MT5 abierto y Python corriendo, esperá la próxima señal J3 en horario 11-16 UTC. El bot Fly va a:

1. Detectar sweep+reclaim en XAUUSD M5
2. Calcular SL/TP con ATR
3. POST a tu URL ngrok
4. Tu Python recibe → ejecuta en MT5
5. Ves la posición abrirse en tu MT5

---

## ☁️ Correrlo 24/7 en un VPS Windows

El executor necesita Windows (la librería `MetaTrader5` de Python no corre en Linux).
Para no depender de tu PC, móntalo en un VPS Windows (Contabo, Kamatera, FXVM, etc. — 2 vCPU / 4 GB RAM alcanza).

### Setup inicial (una sola vez, por RDP)

1. Conéctate por **Escritorio Remoto** al VPS.
2. Instala: MT5 de Exness (loguea la cuenta), Python 3.x, y ngrok (`ngrok config add-authtoken ...`).
3. Copia la carpeta `C:\bot-mt5` completa (executor + `config.json`).
4. `pip install MetaTrader5 flask`
5. Prueba a mano: `run-forever.bat` y `run-ngrok-forever.bat` — deben quedar corriendo y reiniciarse solos si los matas.

### Auto-arranque al bootear (Task Scheduler)

1. **Auto-logon de Windows** (MT5 es app gráfica, necesita sesión iniciada):
   `Win+R` → `netplwiz` → destildar "Los usuarios deben escribir su nombre y contraseña" → poner la contraseña.
2. Abrir **Programador de tareas** → Crear tarea (no básica) ×3:
   - **MT5**: Desencadenador *Al iniciar sesión* · Acción: ruta a `terminal64.exe` de Exness.
   - **Executor**: Desencadenador *Al iniciar sesión* (retraso 1 min para que MT5 cargue) · Acción: `C:\bot-mt5\run-forever.bat`.
   - **ngrok**: Desencadenador *Al iniciar sesión* · Acción: `C:\bot-mt5\run-ngrok-forever.bat`.
   En las 3: pestaña Configuración → destildar "Detener la tarea si se ejecuta durante más de..." .
3. Reinicia el VPS y verifica sin tocar nada: `https://TU-DOMINIO.ngrok-free.dev/health` debe responder `{"ok":true}`.

Con eso el VPS aguanta reinicios, crashes del Python y caídas de ngrok sin intervención.
El dominio estático de ngrok hace que `MT5_BRIDGE_URL` en Fly nunca cambie.

## 🛑 Para detener

`Ctrl+C` en la terminal donde corre Python.

## 📁 Logs

Los logs se guardan en `logs/executor-YYYY-MM-DD.log`. Revisalos cada día.

## ⚠️ Importantes

- `allow_live: false` en config = SEGURO, solo demo.
- Si pasás a `allow_live: true`, **CHEQUEÁ DOS VECES** que el account es el live (no demo).
- El `magic_number` identifica los trades del bot. NO operes manualmente con el mismo número.
- Si tu PC se apaga, las posiciones siguen vivas en el servidor de Exness con su SL/TP.
- Si tu PC se reinicia, hay que volver a correr `python mt5_executor.py`.

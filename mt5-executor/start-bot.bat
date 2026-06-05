@echo off
REM ════════════════════════════════════════════════════════════
REM CHAD BOT · Arranque rápido de servers locales
REM ════════════════════════════════════════════════════════════
REM
REM Abre 2 ventanas PowerShell:
REM   1. Python MT5 executor (puerto 5000)
REM   2. ngrok tunnel (URL fija craftwork-scoff-spotless)
REM
REM Requisito previo: MT5 Exness abierto y logueado
REM ════════════════════════════════════════════════════════════

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║   CHAD BOT · Arrancando servers locales              ║
echo  ╚══════════════════════════════════════════════════════╝
echo.
echo  1. Asegurate de tener MT5 Exness ABIERTO y LOGUEADO
echo     (cuenta 198454534 demo · server Exness-MT5Trial11)
echo.
pause

REM ─── Ventana 1: Python MT5 Executor ──────────────────────
echo Abriendo Python executor...
start "CHAD BOT - Python MT5 Executor" cmd /k "cd /d C:\bot-mt5 && python mt5_executor.py"

REM Esperar 3 segundos para que Python arranque
timeout /t 3 /nobreak >nul

REM ─── Ventana 2: ngrok Tunnel ─────────────────────────────
echo Abriendo ngrok tunnel...
start "CHAD BOT - ngrok Tunnel" cmd /k "ngrok http --url=craftwork-scoff-spotless.ngrok-free.dev 5000"

echo.
echo  ✅ Servers lanzados en ventanas separadas
echo.
echo  Verifica que ambas ventanas muestren:
echo    1. 🚀 Servidor escuchando en http://0.0.0.0:5000
echo    2. Session Status: online
echo.
echo  Esta ventana se puede cerrar (no afecta a los servers).
echo.
pause

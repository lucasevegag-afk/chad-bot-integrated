@echo off
REM ════════════════════════════════════════════════════════════
REM CHAD BOT · Watchdog de ngrok (para VPS 24/7)
REM ════════════════════════════════════════════════════════════
REM Mantiene el tunnel vivo: si ngrok se cae, lo relanza a los
REM 10 segundos. Usa el dominio estatico para que MT5_BRIDGE_URL
REM en Fly nunca cambie.
REM ════════════════════════════════════════════════════════════

set NGROK_DOMAIN=craftwork-scoff-spotless.ngrok-free.dev

:loop
echo [%date% %time%] Lanzando ngrok (%NGROK_DOMAIN%)...
ngrok http --url=%NGROK_DOMAIN% 5000
echo [%date% %time%] ngrok termino. Reinicio en 10s...
timeout /t 10 /nobreak >nul
goto loop

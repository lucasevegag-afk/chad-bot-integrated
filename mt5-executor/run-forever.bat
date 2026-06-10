@echo off
REM ════════════════════════════════════════════════════════════
REM CHAD BOT · Watchdog del Python MT5 executor (para VPS 24/7)
REM ════════════════════════════════════════════════════════════
REM Corre el executor en loop: si crashea o se cierra, espera
REM 10 segundos y lo vuelve a levantar. Sin interaccion (apto
REM para Task Scheduler).
REM
REM Ajusta BOT_DIR si tu carpeta no es C:\bot-mt5
REM ════════════════════════════════════════════════════════════

set BOT_DIR=C:\bot-mt5

:loop
cd /d %BOT_DIR%
echo [%date% %time%] Lanzando mt5_executor.py...
python mt5_executor.py
echo [%date% %time%] El executor termino (crash o cierre). Reinicio en 10s...
timeout /t 10 /nobreak >nul
goto loop

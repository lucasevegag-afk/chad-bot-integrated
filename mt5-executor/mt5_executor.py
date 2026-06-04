"""
mt5_executor.py — Servidor Flask que ejecuta órdenes en MT5 Exness.

Recibe señales HTTP del bot Node.js (en Fly) y ejecuta el trade
en tu MT5 local con risk management.

Uso:
    python mt5_executor.py

Endpoints:
    GET  /health            → ping
    GET  /status            → info de cuenta MT5 (balance, equity, open positions)
    GET  /symbols           → lista de símbolos disponibles
    POST /execute           → abre una posición
    GET  /positions         → lista posiciones abiertas
    POST /close             → cierra una posición por ticket
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import MetaTrader5 as mt5
from flask import Flask, request, jsonify

# ─────────────────────────────────────────
# Config & Logging
# ─────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent
CONFIG_PATH = SCRIPT_DIR / 'config.json'
LOG_DIR = SCRIPT_DIR / 'logs'
LOG_DIR.mkdir(exist_ok=True)

log_file = LOG_DIR / f'executor-{datetime.now().strftime("%Y-%m-%d")}.log'
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler(log_file, encoding='utf-8'),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger('mt5')

if not CONFIG_PATH.exists():
    log.error(f'❌ config.json no encontrado en {CONFIG_PATH}')
    sys.exit(1)

with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
    CFG = json.load(f)

ACCOUNT       = CFG['account']
PASSWORD      = CFG.get('password') or os.environ.get('MT5_PASSWORD', '')
SERVER        = CFG['server']
SYMBOL        = CFG.get('symbol', 'XAUUSD')
LOT_SIZE      = float(CFG.get('lot_size', 0.01))
MAX_POSITIONS = int(CFG.get('max_positions', 1))
MAGIC_NUMBER  = int(CFG.get('magic_number', 20250603))
ALLOW_LIVE    = bool(CFG.get('allow_live', False))
API_TOKEN     = CFG.get('api_token', 'change-me')
ALLOWED_HOURS = set(CFG.get('allowed_hours_utc', list(range(24))))
ALLOWED_DOWS  = set(CFG.get('allowed_dows', list(range(7))))   # 0=Mon, 6=Sun (Python)

if not PASSWORD:
    log.error('❌ Password no configurada. Setear en config.json o env MT5_PASSWORD')
    sys.exit(1)

# ─────────────────────────────────────────
# MT5 connection
# ─────────────────────────────────────────
def mt5_connect():
    if not mt5.initialize():
        log.error(f'❌ MT5 initialize() failed: {mt5.last_error()}')
        return False

    authorized = mt5.login(login=ACCOUNT, password=PASSWORD, server=SERVER)
    if not authorized:
        log.error(f'❌ MT5 login failed for account {ACCOUNT}@{SERVER}: {mt5.last_error()}')
        return False

    info = mt5.account_info()
    if info is None:
        log.error('❌ account_info() returned None')
        return False

    log.info(f'✅ Conectado a MT5 · Account: {info.login} · Server: {SERVER} · Balance: {info.balance} {info.currency}')
    log.info(f'   Trade mode: {"DEMO" if info.trade_mode == 0 else "REAL" if info.trade_mode == 2 else "CONTEST"}')
    log.info(f'   Symbol target: {SYMBOL} · Lot: {LOT_SIZE} · Max positions: {MAX_POSITIONS}')
    log.info(f'   Allowed hours UTC: {sorted(ALLOWED_HOURS)} · Allowed dows: {sorted(ALLOWED_DOWS)}')
    log.info(f'   ALLOW_LIVE: {ALLOW_LIVE} · Magic: {MAGIC_NUMBER}')

    # Verificar que el símbolo existe y está visible
    if not mt5.symbol_select(SYMBOL, True):
        log.error(f'❌ Símbolo {SYMBOL} no disponible en este broker')
        return False

    return True

def mt5_disconnect():
    mt5.shutdown()
    log.info('MT5 disconnected')

# ─────────────────────────────────────────
# Validations
# ─────────────────────────────────────────
def check_token():
    """Valida el token Bearer en el header."""
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return False
    token = auth[7:]
    return token == API_TOKEN

def safety_checks(symbol, lot):
    """Devuelve mensaje de error o None si todo OK."""
    now = datetime.now(timezone.utc)
    if now.hour not in ALLOWED_HOURS:
        return f'Hora UTC {now.hour} no permitida (allowed: {sorted(ALLOWED_HOURS)})'
    if now.weekday() not in ALLOWED_DOWS:
        return f'Día {now.weekday()} no permitido (allowed: {sorted(ALLOWED_DOWS)})'
    if symbol != SYMBOL:
        return f'Símbolo {symbol} no permitido (only {SYMBOL})'
    if lot > LOT_SIZE * 5:
        return f'Lot {lot} > max permitido {LOT_SIZE*5}'

    # Check max positions
    positions = mt5.positions_get(magic=MAGIC_NUMBER)
    if positions and len(positions) >= MAX_POSITIONS:
        return f'Ya hay {len(positions)} posiciones abiertas (max {MAX_POSITIONS})'

    # Live trade gate
    info = mt5.account_info()
    if info and info.trade_mode == 2 and not ALLOW_LIVE:
        return 'Cuenta LIVE detectada pero ALLOW_LIVE=false. Cambia config si querés operar live.'

    return None

# ─────────────────────────────────────────
# Flask app
# ─────────────────────────────────────────
app = Flask(__name__)

@app.before_request
def auth_check():
    # /health no requiere auth
    if request.path in ['/health']:
        return None
    if not check_token():
        log.warning(f'⛔ Auth failed from {request.remote_addr}')
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 401

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'ok': True, 'service': 'mt5-executor', 'time': datetime.now(timezone.utc).isoformat()})

@app.route('/status', methods=['GET'])
def status():
    info = mt5.account_info()
    if info is None:
        return jsonify({'ok': False, 'error': 'No account info'}), 500
    positions = mt5.positions_get(magic=MAGIC_NUMBER) or []
    return jsonify({
        'ok': True,
        'account': info.login,
        'server': SERVER,
        'balance': info.balance,
        'equity': info.equity,
        'currency': info.currency,
        'trade_mode': 'DEMO' if info.trade_mode == 0 else 'REAL' if info.trade_mode == 2 else 'CONTEST',
        'open_positions': [
            {
                'ticket': p.ticket,
                'symbol': p.symbol,
                'type': 'long' if p.type == 0 else 'short',
                'volume': p.volume,
                'price_open': p.price_open,
                'sl': p.sl,
                'tp': p.tp,
                'profit': p.profit,
                'time': datetime.fromtimestamp(p.time, tz=timezone.utc).isoformat(),
            }
            for p in positions
        ],
    })

@app.route('/symbols', methods=['GET'])
def symbols():
    syms = mt5.symbols_get()
    if syms is None:
        return jsonify({'ok': False, 'error': 'No symbols'}), 500
    # Buscar XAU u otros relevantes
    relevant = [s.name for s in syms if 'XAU' in s.name or 'BTC' in s.name or 'EURUSD' in s.name][:30]
    return jsonify({'ok': True, 'count': len(syms), 'relevant_samples': relevant})

@app.route('/positions', methods=['GET'])
def positions():
    positions = mt5.positions_get(magic=MAGIC_NUMBER) or []
    return jsonify({
        'ok': True,
        'count': len(positions),
        'positions': [
            {
                'ticket': p.ticket, 'symbol': p.symbol, 'type': 'long' if p.type == 0 else 'short',
                'volume': p.volume, 'price_open': p.price_open, 'sl': p.sl, 'tp': p.tp,
                'profit': p.profit,
            }
            for p in positions
        ],
    })

@app.route('/execute', methods=['POST'])
def execute():
    """
    Body esperado:
    {
      "symbol":    "XAUUSD",
      "direction": "long" | "short",
      "lot":       0.01,
      "sl":        2650.00,
      "tp":        2680.00,
      "comment":   "J3 sweep+reclaim",
      "magic":     20250603
    }
    """
    data = request.get_json(silent=True) or {}
    log.info(f'📨 /execute request: {json.dumps(data)}')

    symbol = data.get('symbol', SYMBOL)
    direction = data.get('direction')
    lot = float(data.get('lot', LOT_SIZE))
    sl = float(data.get('sl', 0))
    tp = float(data.get('tp', 0))
    comment = str(data.get('comment', 'CHAD bot'))[:30]
    magic = int(data.get('magic', MAGIC_NUMBER))

    # Validaciones
    if direction not in ('long', 'short'):
        return jsonify({'ok': False, 'error': 'direction debe ser long o short'}), 400

    err = safety_checks(symbol, lot)
    if err:
        log.warning(f'⛔ Safety: {err}')
        return jsonify({'ok': False, 'error': err}), 400

    # Obtener precio actual
    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        return jsonify({'ok': False, 'error': f'No tick for {symbol}'}), 500

    price = tick.ask if direction == 'long' else tick.bid
    order_type = mt5.ORDER_TYPE_BUY if direction == 'long' else mt5.ORDER_TYPE_SELL

    # Construir request
    req = {
        'action':       mt5.TRADE_ACTION_DEAL,
        'symbol':       symbol,
        'volume':       lot,
        'type':         order_type,
        'price':        price,
        'sl':           sl,
        'tp':           tp,
        'magic':        magic,
        'comment':      comment,
        'deviation':    20,
        'type_time':    mt5.ORDER_TIME_GTC,
        'type_filling': mt5.ORDER_FILLING_IOC,
    }

    result = mt5.order_send(req)
    if result is None:
        log.error(f'❌ order_send None · last_error: {mt5.last_error()}')
        return jsonify({'ok': False, 'error': str(mt5.last_error())}), 500

    if result.retcode != mt5.TRADE_RETCODE_DONE:
        log.error(f'❌ Trade failed · retcode={result.retcode} · {result.comment}')
        return jsonify({
            'ok': False,
            'retcode': result.retcode,
            'comment': result.comment,
            'request': str(req),
        }), 500

    log.info(f'✅ Trade abierto · ticket {result.order} · {direction} {lot} {symbol} @ {price} · SL={sl} TP={tp}')
    return jsonify({
        'ok': True,
        'ticket': result.order,
        'volume': result.volume,
        'price': result.price,
        'sl': sl,
        'tp': tp,
        'comment': result.comment,
    })

@app.route('/close', methods=['POST'])
def close():
    data = request.get_json(silent=True) or {}
    ticket = data.get('ticket')
    if not ticket:
        return jsonify({'ok': False, 'error': 'ticket requerido'}), 400

    position = mt5.positions_get(ticket=ticket)
    if not position:
        return jsonify({'ok': False, 'error': 'posición no encontrada'}), 404

    p = position[0]
    tick = mt5.symbol_info_tick(p.symbol)
    price = tick.bid if p.type == 0 else tick.ask
    close_type = mt5.ORDER_TYPE_SELL if p.type == 0 else mt5.ORDER_TYPE_BUY

    req = {
        'action':       mt5.TRADE_ACTION_DEAL,
        'position':     p.ticket,
        'symbol':       p.symbol,
        'volume':       p.volume,
        'type':         close_type,
        'price':        price,
        'magic':        MAGIC_NUMBER,
        'comment':      'manual close',
        'deviation':    20,
        'type_filling': mt5.ORDER_FILLING_IOC,
    }
    result = mt5.order_send(req)
    if result.retcode != mt5.TRADE_RETCODE_DONE:
        return jsonify({'ok': False, 'retcode': result.retcode, 'comment': result.comment}), 500

    log.info(f'✅ Posición {ticket} cerrada')
    return jsonify({'ok': True, 'ticket': ticket, 'close_price': price})

# ─────────────────────────────────────────
# Main
# ─────────────────────────────────────────
if __name__ == '__main__':
    if not mt5_connect():
        sys.exit(1)
    try:
        port = int(CFG.get('port', 5000))
        log.info(f'🚀 Servidor escuchando en http://0.0.0.0:{port}')
        app.run(host='0.0.0.0', port=port, debug=False)
    finally:
        mt5_disconnect()

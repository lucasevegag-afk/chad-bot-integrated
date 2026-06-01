/*
 * chad-backend-bridge.js
 * ─────────────────────────────────────────────────────────────────────
 * Migra la capa de datos del bot visual al backend Chad Inversor Platform,
 * y REEMPLAZA el chart casero por TradingView Lightweight Charts™ servido
 * localmente desde /public/js/lightweight-charts.standalone.js.
 *
 * El NativeChart original queda intacto en el DOM pero se oculta — no se
 * borra para no romper código que aún lo referencia (autoRepair, etc.).
 *
 * NO toca:
 *   - diseño, layout, paneles, estilos, IDs ni clases
 *   - lógica de estrategia, scoring, paper trading
 *   - backend
 *
 * SÍ hace:
 *   1. Parchea DataFeedManager.prototype._loadHistBinance / _loadHistTwelve
 *      → trae histórico desde /api/history/:asset?tf=...
 *   2. Anula pollLatest / startBinanceWS del DataFeed y openBinanceWS /
 *      schedulePolling de Bootstrap (el WS del backend ya alimenta todo)
 *   3. Abre un WebSocket a /ws y enruta candle_update + bot_state_update
 *      + signal_detected
 *   4. Bypassa el requerimiento de API key (la maneja el backend)
 *   5. Instala store.getLastPrice (faltaba — bloqueaba Buy/Sell)
 *   6. Inyecta CSS para que el right panel no se aplaste en notebooks
 *   7. Monta Lightweight Charts dentro de #v11ChartHost:
 *        - velas en vivo (series.update por cada candle_update del WS)
 *        - zoom rueda, pan arrastrando, crosshair, tooltip OHLC
 *        - escala precio + escala temporal + auto-scale
 *        - línea de precio actual
 *        - markers para signal_detected (LONG/SHORT)
 *        - API pública window.ChadChart.drawLevel('SL', price, color)
 *          lista para SL/TP/FVG/zonas/etiquetas en próximas iteraciones.
 * ─────────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  // ───── 1) Mappings ─────
  const ASSET_TO_BACKEND = {
    'BTC/USD': 'BTCUSDT',
    'XAU/USD': 'XAUUSD',
    'EUR/USD': 'EURUSD',
    'WTI':     'WTI',
    'NAS100':  'NAS100',
  };
  const BACKEND_TO_ASSET = Object.fromEntries(
    Object.entries(ASSET_TO_BACKEND).map(([k, v]) => [v, k])
  );

  const TF_TO_BACKEND = {
    M1: '1m', M5: '5m', M15: '15m', M30: '30m', H1: '1h', H4: '4h',
  };
  const BACKEND_TO_TF = Object.fromEntries(
    Object.entries(TF_TO_BACKEND).map(([k, v]) => [v, k])
  );

  // ───── 2) URLs ─────
  const REST_BASE = '/api';
  const WS_URL = (location.protocol === 'https:' ? 'wss:' : 'ws:') +
                 '//' + location.host + '/ws';
  const LWC_URL = '/js/lightweight-charts.standalone.js';

  // ───── 3) Helpers ─────
  function log(type, text, sub) {
    try {
      if (window.liveFeed && typeof window.liveFeed.add === 'function') {
        window.liveFeed.add({ type, text, sub });
        return;
      }
    } catch (_) { /* fall-through */ }
    const tag = '[chad-bridge]';
    if (type === 'danger' || type === 'warn') console.warn(tag, text, sub || '');
    else console.log(tag, text, sub || '');
  }

  // Vela backend → vela interna del bot {time,open,high,low,close,volume}
  function adaptCandleToStore(c) {
    return {
      time:   c.timestamp,
      open:   +c.open,
      high:   +c.high,
      low:    +c.low,
      close:  +c.close,
      volume: +(c.volume || 1),
    };
  }
  // Vela → Lightweight Charts: time en SEGUNDOS Unix
  function adaptCandleToLwc(c) {
    return {
      time:  Math.floor((c.timestamp || c.time) / 1000),
      open:  +c.open,
      high:  +c.high,
      low:   +c.low,
      close: +c.close,
    };
  }

  // ───── 4) REST: histórico ─────
  async function fetchHistory(backendSymbol, backendTf, limit = 500) {
    const url = `${REST_BASE}/history/${encodeURIComponent(backendSymbol)}` +
                `?tf=${encodeURIComponent(backendTf)}&limit=${limit}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('Backend /api/history HTTP ' + r.status);
    const json = await r.json();
    if (!Array.isArray(json.candles)) throw new Error('Backend sin candles');
    return json.candles;
  }

  // ───── 5) Patch DataFeedManager (histórico legacy del bot) ─────
  function patchDataFeed() {
    if (!window.feed_dataSource || !window.feed_dataSource.constructor) {
      return setTimeout(patchDataFeed, 80);
    }
    const proto = window.feed_dataSource.constructor.prototype;
    if (proto.__chadBridgePatched) return;
    proto.__chadBridgePatched = true;

    proto._loadHistBinance = async function (assetId, tf) {
      const bSym = ASSET_TO_BACKEND[assetId];
      const bTf  = TF_TO_BACKEND[tf];
      if (!bSym || !bTf) return;
      this.onLog({ type: 'info', text: `Backend · histórico ${assetId} ${tf}` });
      const raw = await fetchHistory(bSym, bTf, 300);
      const candles = raw.slice(0, -1).map(adaptCandleToStore);
      this.store.setHistorical(assetId, tf, candles);
    };
    proto._loadHistTwelve = async function (assetId, tf) {
      const bSym = ASSET_TO_BACKEND[assetId];
      const bTf  = TF_TO_BACKEND[tf];
      if (!bSym || !bTf) return;
      this.onLog({ type: 'info', text: `Backend · histórico ${assetId} ${tf}` });
      const raw = await fetchHistory(bSym, bTf, 300);
      const candles = raw.slice(0, -1).map(adaptCandleToStore);
      this.store.setHistorical(assetId, tf, candles);
    };
    proto.pollLatest      = async function () { /* no-op */ };
    proto.startBinanceWS  = function () { /* no-op */ };

    log('success', 'Capa de datos migrada al Chad Backend');
  }

  function patchBootstrap() {
    if (!window.Bootstrap) return setTimeout(patchBootstrap, 80);
    if (window.Bootstrap.__chadBridgePatched) return;
    window.Bootstrap.__chadBridgePatched = true;
    window.Bootstrap.openBinanceWS  = function (a, tf) { log('info', `Live ${a} ${tf} via Chad Backend`); };
    window.Bootstrap.schedulePolling = function (a)     { log('info', `Live ${a} via Chad Backend`); };
  }

  // ───── 6) WebSocket al backend ─────
  let ws = null;
  let wsBackoffMs = 1000;

  function connectWS() {
    try { ws = new WebSocket(WS_URL); }
    catch (e) { log('danger', 'No se pudo abrir WS backend: ' + e.message); return scheduleReconnect(); }

    ws.onopen = () => {
      wsBackoffMs = 1000;
      log('success', 'WebSocket Chad Backend conectado');
      for (const sym of Object.values(ASSET_TO_BACKEND)) {
        try { ws.send(JSON.stringify({ action: 'subscribe', asset: sym })); }
        catch (_) { /* noop */ }
      }
    };
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      switch (msg.type) {
        case 'candle_update':    handleCandleUpdate(msg);    break;
        case 'bot_state_update': handleBotStateUpdate(msg);  break;
        case 'signal_detected':  handleSignal(msg);          break;
      }
    };
    ws.onerror = () => { /* log via onclose */ };
    ws.onclose = () => { log('warn', 'WS backend cerrado — reintentando…'); scheduleReconnect(); };
  }
  function scheduleReconnect() {
    setTimeout(connectWS, wsBackoffMs);
    wsBackoffMs = Math.min(wsBackoffMs * 2, 30000);
  }

  function handleCandleUpdate(msg) {
    const assetId = BACKEND_TO_ASSET[msg.asset];
    const tf      = BACKEND_TO_TF[msg.timeframe];
    if (!assetId || !tf) return;
    // 1) Persistir en el store del bot (engines, signals, paper, etc.)
    if (window.store) {
      const c = adaptCandleToStore(msg.candle);
      if (msg.candle && msg.candle.isClosed) window.store.closeCandle(assetId, tf, c);
      else                                    window.store.updateLastCandle(assetId, tf, c);
    }
    // 2) Empujar al Lightweight Chart si es el asset+tf actualmente visible
    if (assetId === LwState.asset && tf === LwState.tf && LwState.series) {
      try {
        const lwc = adaptCandleToLwc(msg.candle);
        LwState.series.update(lwc);
        LwState._lastCandle = lwc;
        renderLwOhlc(lwc);
        refreshCurrentPriceLine();
      } catch (_) { /* noop */ }
    }
    // 3) Actualizar header OHLC legacy si la API del bot existe
    try {
      const ui = window.UI && window.UI.state;
      if (ui && ui.asset === assetId && ui.tf === tf && window.Bootstrap?.renderOHLC) {
        window.Bootstrap.renderOHLC(adaptCandleToStore(msg.candle));
      }
    } catch (_) { /* noop */ }
  }

  function handleBotStateUpdate(msg) {
    const assetId = BACKEND_TO_ASSET[msg.asset] || msg.asset;
    const s = msg.botState || {};
    log('neutral',
      `${assetId} · bias HTF=${s.htfBias || '–'} / Táctico=${s.tacticalBias || '–'}`,
      `Sesión: ${s.sessionState || '–'}`);
    // ⭐ Reenviar el botState al TrapDetector (si está cargado)
    try {
      if (window.TrapDetector?.onBotState) {
        window.TrapDetector.onBotState(assetId, s);
      }
    } catch (err) { console.warn('[bridge] TrapDetector.onBotState error:', err); }
  }
  function handleSignal(msg) {
    const assetId = BACKEND_TO_ASSET[msg.asset] || msg.asset;
    const s = msg.signal || {};
    const type = (s.type || 'SIGNAL').toString();
    const dir  = (s.direction || '').toString().toUpperCase();
    log('success',
      `Señal ${assetId} · ${type} ${dir}`,
      s.notes || `Score ${s.score ?? '–'}`);
    // ── Verificación: toda señal entrante queda registrada ──
    console.log('[Chart Signal] incoming from backend:', {
      assetIncoming: assetId,
      currentChartAsset: LwState.asset,
      type, direction: dir,
      level: s.level, score: s.score,
      willDrawNow: (assetId === LwState.asset && !!LwState.series),
    });
    // Asegurar que el objeto signal tenga `asset` para los logs internos
    if (!s.asset) s.asset = assetId;
    if (assetId === LwState.asset && LwState.series) {
      addSignalMarker(s);
    } else {
      LwState.pendingMarkers[assetId] = LwState.pendingMarkers[assetId] || [];
      LwState.pendingMarkers[assetId].push(s);
      console.log(`[Chart Signal] queued for ${assetId} (no es el activo actual)`);
    }
  }

  // ───── 7) UI: bypass requisito de API key ─────
  function tweakApikeyUi() {
    window.CHAD_BACKEND_MANAGED = true;
    const inputs = [
      document.getElementById('apikeyInput'),
      document.getElementById('cfg_apikey'),
    ];
    for (const el of inputs) {
      if (!el) continue;
      el.value = 'backend-managed';
      el.readOnly = true;
      el.placeholder = 'Gestionado por Chad Platform Backend';
      el.title = 'API key gestionada por el servidor.';
    }
    const status = document.getElementById('cfg_apikey_status');
    if (status) {
      status.dataset.backendManaged = 'true';
      status.textContent = 'Datos gestionados por Chad Platform Backend (API key en servidor)';
    }
    const card = document.getElementById('apikeyCard');
    if (card) { card.dataset.backendManaged = 'true'; card.classList.add('hidden'); }
    try { localStorage.setItem('chadbot_admin_apiKey', 'backend-managed'); } catch (_) {}
    document.getElementById('v11ApiModal')?.classList.remove('show');
  }

  // ───── 8) Fix Buy/Sell: store.getLastPrice ─────
  function ensureGetLastPrice(store) {
    if (!store || typeof store.getLastPrice === 'function') return;
    store.getLastPrice = function (asset, tf) {
      const arr = this.get(asset, tf);
      if (!arr || !arr.length) return null;
      return arr[arr.length - 1].close;
    };
    log('success', 'store.getLastPrice instalado (Buy/Sell desbloqueado)');
  }

  // ───── 9) CSS overrides ─────
  function injectLayoutCss() {
    if (document.getElementById('chad-bridge-styles')) return;
    const style = document.createElement('style');
    style.id = 'chad-bridge-styles';
    style.textContent = `
      /* ============================================================
         FIX LAYOUT TOPBAR
         El override de línea 13173 baja --v11-header-h a 60px pero el
         contenido real del header (stats + nav tabs envueltas) mide
         ~120px → desbordaba sobre el right panel.
         Fix: comprimir el contenido del header (padding chico, nav tabs
         finas) y matchear la variable a la altura compacta resultante.
         ============================================================ */
      :root { --v11-header-h: 84px !important; }

      .v11-header {
        padding: 4px 18px !important;   /* antes 8px → más fino */
        min-height: 48px !important;
        row-gap: 0 !important;
      }
      /* Nav tabs (TERMINAL / CONFIGURACIÓN / ESTRATEGIAS) más finas */
      .v11-nav-tabs {
        height: 30px !important;         /* antes 36px */
        margin: 2px -18px 0 !important;  /* antes 6px -18px 0 */
      }
      .v11-nav-tab {
        padding: 0 14px !important;
        font-size: 10px !important;
      }
      .v11-nav-tab .ic { font-size: 12px !important; }

      /* Right panel: cards no se aplastan; scroll interno limpio */
      .v11-rightpanel { scrollbar-gutter: stable; }
      .v11-rightpanel > .v11-card { flex-shrink: 0; }

      /* ============================================================
         BUY/SELL panel SIEMPRE compacto (no gated por media query) —
         así entra sin truncarse en 1366×768.
         ============================================================ */
      .v11-rightpanel > #v11NoCard .v11-card-body {
        padding: 8px 12px 10px !important;
      }
      .v11-rightpanel > #v11NoCard .v11-field-grid {
        row-gap: 6px !important;
        column-gap: 8px !important;
      }
      .v11-rightpanel > #v11NoCard .v11-field input,
      .v11-rightpanel > #v11NoCard .v11-field select {
        padding-top: 4px !important;
        padding-bottom: 4px !important;
        min-height: 28px !important;
      }
      .v11-rightpanel > #v11NoCard .v11-noform-final { margin-top: 6px !important; }
      .v11-rightpanel > #v11NoCard .v11-noform-final button { padding: 8px 12px !important; }
      .v11-rightpanel > #v11NoCard .v11-bid-ask { padding: 6px 8px !important; }
      .v11-rightpanel > #v11NoCard .v11-noform-tabs button { padding: 6px 10px !important; }
      /* Ocultar NativeChart y dejar lugar al Lightweight Chart */
      #v11ChartHost .chart-container { display: none !important; }
      #chad-lw-chart {
        position: absolute; inset: 0; width: 100%; height: 100%;
        background: var(--bg-1, #0a0a0a);
      }
      /* Tooltip OHLC flotante */
      #chad-lw-ohlc {
        position: absolute; top: 8px; left: 12px; z-index: 5;
        font: 11px 'JetBrains Mono', monospace;
        color: #cfcfcf; pointer-events: none;
        background: rgba(0,0,0,0.55); border: 1px solid rgba(212,160,23,0.25);
        border-radius: 4px; padding: 4px 8px; backdrop-filter: blur(6px);
        display: flex; gap: 10px; white-space: nowrap;
      }
      #chad-lw-ohlc .lbl { color: #8a8a8a; margin-right: 3px; }
      #chad-lw-ohlc .up  { color: #4ade80; }
      #chad-lw-ohlc .dn  { color: #f87171; }
    `;
    document.head.appendChild(style);
  }

  // ──────────────────────────────────────────────────────────────────
  // 10) LIGHTWEIGHT CHARTS — Chart manager
  // ──────────────────────────────────────────────────────────────────

  const LwState = {
    chart: null,
    series: null,
    priceLine: null,
    overlayLines: [],
    asset: null,
    tf: null,
    pendingMarkers: {},
    markersForAsset: {},
    _lastCandle: null,
  };

  function loadLightweightChartsLib() {
    if (window.LightweightCharts) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LWC_URL;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('No se pudo cargar Lightweight Charts'));
      document.head.appendChild(s);
    });
  }

  async function buildLwChart() {
    const host = document.getElementById('v11ChartHost');
    if (!host) { log('warn', '#v11ChartHost no existe'); return null; }

    let div = document.getElementById('chad-lw-chart');
    if (!div) {
      div = document.createElement('div');
      div.id = 'chad-lw-chart';
      host.appendChild(div);
    }

    let ohlcEl = document.getElementById('chad-lw-ohlc');
    if (!ohlcEl) {
      ohlcEl = document.createElement('div');
      ohlcEl.id = 'chad-lw-ohlc';
      ohlcEl.innerHTML =
        '<span><span class="lbl">O</span><span id="lwO">—</span></span>' +
        '<span><span class="lbl">H</span><span id="lwH">—</span></span>' +
        '<span><span class="lbl">L</span><span id="lwL">—</span></span>' +
        '<span><span class="lbl">C</span><span id="lwC">—</span></span>';
      host.appendChild(ohlcEl);
    }

    try { await loadLightweightChartsLib(); }
    catch (e) { log('danger', e.message); return null; }

    const LWC = window.LightweightCharts;

    const chart = LWC.createChart(div, {
      width:  div.clientWidth  || 600,
      height: div.clientHeight || 300,
      layout: {
        background: { type: 'solid', color: 'rgba(0,0,0,0)' },
        textColor: '#cfcfcf',
        fontSize: 11,
        fontFamily: 'JetBrains Mono, monospace',
      },
      grid: {
        vertLines: { color: 'rgba(212,160,23,0.06)' },
        horzLines: { color: 'rgba(212,160,23,0.07)' },
      },
      rightPriceScale: {
        borderColor: '#222',
        scaleMargins: { top: 0.08, bottom: 0.18 },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#222',
        rightOffset: 6,
        barSpacing: 6,
      },
      crosshair: {
        mode: LWC.CrosshairMode.Normal,
        vertLine: { color: 'rgba(212,160,23,0.45)', width: 1, style: 0, labelBackgroundColor: '#1a1408' },
        horzLine: { color: 'rgba(212,160,23,0.45)', width: 1, style: 0, labelBackgroundColor: '#1a1408' },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale:  { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: true } },
    });

    const series = chart.addCandlestickSeries({
      upColor:        '#4ade80',
      downColor:      '#f87171',
      borderUpColor:  '#4ade80',
      borderDownColor:'#f87171',
      wickUpColor:    '#4ade80',
      wickDownColor:  '#f87171',
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });

    // Auto-resize cuando el host cambia
    const ro = new ResizeObserver(() => {
      const r = div.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        chart.applyOptions({ width: Math.floor(r.width), height: Math.floor(r.height) });
      }
    });
    ro.observe(div);

    // Tooltip OHLC en el crosshair
    chart.subscribeCrosshairMove((param) => {
      const d = param.seriesData && param.seriesData.get(series);
      renderLwOhlc(d || LwState._lastCandle);
    });

    LwState.chart = chart;
    LwState.series = series;
    return chart;
  }

  function renderLwOhlc(c) {
    if (!c) return;
    const dec = decimalsFor(LwState.asset);
    const setT = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setT('lwO', (+c.open ).toFixed(dec));
    setT('lwH', (+c.high ).toFixed(dec));
    setT('lwL', (+c.low  ).toFixed(dec));
    setT('lwC', (+c.close).toFixed(dec));
    const cEl = document.getElementById('lwC');
    if (cEl) cEl.className = (+c.close >= +c.open) ? 'up' : 'dn';
  }

  function decimalsFor(assetId) {
    if (assetId === 'EUR/USD') return 5;
    return 2;
  }

  async function loadLwHistory(assetId, tf) {
    const bSym = ASSET_TO_BACKEND[assetId];
    const bTf  = TF_TO_BACKEND[tf];
    if (!bSym || !bTf || !LwState.series) return;

    try {
      const raw = await fetchHistory(bSym, bTf, 500);
      const candles = raw.map(adaptCandleToLwc).sort((a, b) => a.time - b.time);
      const seen = new Set();
      const dedup = candles.filter(c => seen.has(c.time) ? false : (seen.add(c.time), true));

      LwState.series.setData(dedup);
      LwState.asset = assetId;
      LwState.tf = tf;
      LwState._lastCandle = dedup[dedup.length - 1] || null;
      renderLwOhlc(LwState._lastCandle);

      const dec = decimalsFor(assetId);
      LwState.series.applyOptions({
        priceFormat: { type: 'price', precision: dec, minMove: Math.pow(10, -dec) },
      });

      refreshCurrentPriceLine();
      reapplyMarkers(assetId);

      try { LwState.chart.timeScale().fitContent(); } catch (_) {}
      log('info', `Chart ${assetId} ${tf}: ${dedup.length} velas`);
    } catch (e) {
      log('danger', `Histórico ${assetId} ${tf} falló: ${e.message}`);
    }
  }

  function refreshCurrentPriceLine() {
    if (!LwState.series) return;
    const c = LwState._lastCandle;
    if (!c) return;
    if (LwState.priceLine) {
      try { LwState.series.removePriceLine(LwState.priceLine); } catch (_) {}
      LwState.priceLine = null;
    }
    LwState.priceLine = LwState.series.createPriceLine({
      price: +c.close,
      color: '#d4a017',
      lineWidth: 1,
      lineStyle: 2, // dashed
      axisLabelVisible: true,
      title: '',
    });
  }

  // ───── Markers de señales (estilo broker discreto) ─────
  // Reutiliza el evento `signal_detected` que ya emite signalManager
  // cuando assetScanner detecta sweep+reclaim alineado con bias y sesión tradeable.
  // Solo se dibuja la marca cuando level >= 3 (setup operable, no ruido).
  function buildMarker(s) {
    const tNow = Math.floor(((s.timestamp || Date.now())) / 1000);
    const dir = (s.direction || '').toLowerCase();
    const isLong = dir === 'long';

    // Texto compacto tipo ticket de orden
    let label;
    if (isLong)      label = 'BUY';
    else if (dir === 'short') label = 'SELL';
    else             label = (s.type || 'SIG').toUpperCase();

    // Colores afinados al tema Chad (verde / rojo con luminancia controlada)
    const color = isLong ? '#10a14b' : '#d93838';

    return {
      time: tNow,
      position: isLong ? 'belowBar' : 'aboveBar',
      color,
      // shape sutil: círculo (más pequeño que la flecha) + texto del lado
      shape: isLong ? 'arrowUp' : 'arrowDown',
      text:  label,
      size:  1, // tamaño 1 = chico (Lightweight Charts: 0.5–2)
    };
  }

  // Filtro: solo aceptar marker si la señal alcanza nivel operable.
  // Reutiliza el campo `level` que ya viene del signalManager (1–5).
  function shouldDrawMarker(signal) {
    if (!signal) return false;
    const lvl = Number(signal.level || 0);
    return lvl >= 3; // setup operable o superior
  }
  function addSignalMarker(signal) {
    if (!LwState.series || !signal) return;
    if (!shouldDrawMarker(signal)) {
      // Log también las señales rechazadas, para distinguir "no llegó" de "llegó pero filtrada"
      console.log('[Chart Signal] REJECTED (level<3 o vacía):', {
        asset: signal.asset, type: signal.type, direction: signal.direction,
        level: signal.level, score: signal.score,
      });
      return;
    }
    const marker = buildMarker(signal);
    const list = LwState.markersForAsset[LwState.asset] || [];
    list.push(marker);
    if (list.length > 20) list.shift(); // tope para no saturar el gráfico ni la RAM
    LwState.markersForAsset[LwState.asset] = list;
    try { LwState.series.setMarkers(list); } catch (_) {}

    // ── Herramienta de verificación: log estructurado por señal dibujada ──
    const isLong = (signal.direction || '').toLowerCase() === 'long';
    const tag = isLong ? 'BUY' : 'SELL';
    const priceHint =
      signal.price ?? signal.entry ?? LwState._lastCandle?.close ?? 'n/a';
    const isoTime = new Date(signal.timestamp || Date.now()).toISOString();
    console.log(
      `[Chart Signal] ${tag} marker created at price ${priceHint} / time ${isoTime}`,
      {
        asset: signal.asset,
        type: signal.type,
        level: signal.level,
        score: signal.score,
        markerTime: marker.time, // Unix seconds (lo que recibe Lightweight Charts)
        currentAsset: LwState.asset,
        drawnOnChart: signal.asset === LwState.asset || true, // siempre drawn aquí
      }
    );
  }
  function reapplyMarkers(assetId) {
    if (!LwState.series) return;
    const queued = LwState.pendingMarkers[assetId] || [];
    if (queued.length) {
      const arr = LwState.markersForAsset[assetId] = LwState.markersForAsset[assetId] || [];
      for (const s of queued) {
        if (shouldDrawMarker(s)) arr.push(buildMarker(s));
      }
      LwState.pendingMarkers[assetId] = [];
    }
    const list = LwState.markersForAsset[assetId] || [];
    try { LwState.series.setMarkers(list); } catch (_) {}
  }

  // ───── Overlays públicos (SL/TP/FVG/zonas/etiquetas) ─────
  function drawLevel(label, price, color) {
    if (!LwState.series || !price) return null;
    const line = LwState.series.createPriceLine({
      price: +price,
      color: color || '#d4a017',
      lineWidth: 1,
      lineStyle: 1, // dotted
      axisLabelVisible: true,
      title: label || '',
    });
    LwState.overlayLines.push(line);
    return line;
  }
  function clearOverlays() {
    if (!LwState.series) return;
    for (const l of LwState.overlayLines) {
      try { LwState.series.removePriceLine(l); } catch (_) {}
    }
    LwState.overlayLines = [];
  }

  // ──────────────────────────────────────────────────────────────────
  // 11) Wrappers UI: cambio de asset/TF → recarga del LW chart
  // ──────────────────────────────────────────────────────────────────
  function wrapUiHandlers() {
    const UI = window.UI;
    if (!UI || UI.__chadBridgeWrapped) return;
    UI.__chadBridgeWrapped = true;

    if (typeof UI.selectAsset === 'function') {
      const orig = UI.selectAsset.bind(UI);
      UI.selectAsset = function (id) {
        orig(id);
        loadLwHistory(id, UI.state.tf);
      };
    }
    if (typeof UI.selectTf === 'function') {
      const orig = UI.selectTf.bind(UI);
      UI.selectTf = function (tf) {
        orig(tf);
        loadLwHistory(UI.state.asset, tf);
      };
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // 12) Boot
  // ──────────────────────────────────────────────────────────────────
  async function bootChartLayer() {
    let tries = 0;
    while (!(window.UI && window.UI.state && window.store) && tries++ < 120) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (!(window.UI && window.UI.state && window.store)) {
      log('warn', 'Bot no inicializó a tiempo — chart no montado');
      return;
    }
    ensureGetLastPrice(window.store);
    wrapUiHandlers();

    const built = await buildLwChart();
    if (!built) return;

    const asset = window.UI.state.asset;
    const tf    = window.UI.state.tf;
    await loadLwHistory(asset, tf);

    // API pública para SL/TP/FVG/zonas/etiquetas
    window.ChadChart = {
      get chart()  { return LwState.chart; },
      get series() { return LwState.series; },
      drawLevel,
      clearOverlays,
      addSignalMarker,
      reloadHistory: () => loadLwHistory(LwState.asset, LwState.tf),
    };
    log('success', 'ChadChart listo (TradingView Lightweight Charts)');
  }

  // ───── 13) Init ─────
  function start() {
    patchDataFeed();
    patchBootstrap();
    tweakApikeyUi();
    injectLayoutCss();
    connectWS();
    bootChartLayer();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();

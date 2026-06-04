/**
 * backtest/build-ranking-xlsx.js
 * Genera Excel completo con las 53 estrategias del registry, ordenadas por TotalR.
 */
const ExcelJS = require('exceljs');
const { STRATEGIES } = require('../server/bot/strategies/registry');

function detectStyle(s) {
  const c = s.config;
  const hasPartial = !!c.S1_PARTIAL_TP_MULT;
  const tp = Number(c.S1_TP_MULT || 2);
  if (hasPartial) {
    if (tp >= 2.0) return 'Partial híbrido (scalp + intradía)';
    return 'Partial scalp-puro';
  }
  if (tp <= 0.3) return 'Sniper ultra-scalp';
  if (tp <= 0.5) return 'Scalp rápido';
  if (tp <= 1.0) return 'Intradía corto';
  if (tp <= 2.0) return 'Intradía medio';
  return 'Swing intradía';
}

function detectDuration(s) {
  const c = s.config;
  const hasPartial = !!c.S1_PARTIAL_TP_MULT;
  const tp = Number(c.S1_TP_MULT || 2);
  if (hasPartial) {
    return tp >= 2.0
      ? '3-15 min (partial) + 20-60 min (final)'
      : '3-10 min (partial) + 5-15 min (final)';
  }
  if (tp <= 0.3) return '3-8 min';
  if (tp <= 0.5) return '5-15 min';
  if (tp <= 1.0) return '10-30 min';
  if (tp <= 2.0) return '20-60 min';
  return '30-90 min';
}

function detectSchedule(s) {
  const c = s.config;
  if (c.S1_KILLZONES) {
    const kz = c.S1_KILLZONES;
    if (kz === '7,8,9,12,13,14') return 'London KZ (7-9 UTC) + NY KZ (12-14 UTC)';
    if (kz === '8,13') return 'London 8 UTC + NY 13 UTC (centros)';
    return 'Killzones: ' + kz + ' UTC';
  }
  const parts = ['24h FX (sin killzones)'];
  if (c.S1_BAD_SESSIONS) parts.push('sin ' + c.S1_BAD_SESSIONS);
  if (c.S1_BAD_HOURS) parts.push('sin ' + c.S1_BAD_HOURS + ' UTC');
  if (c.S1_BAD_DOWS) {
    const names = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    const days = c.S1_BAD_DOWS.split(',').map(d => names[Number(d)]).join(',');
    parts.push('sin ' + days);
  }
  return parts.join(' · ');
}

function detectOrigin(s) {
  const c = s.config;
  const hasPartial = !!c.S1_PARTIAL_TP_MULT;
  const tp = Number(c.S1_TP_MULT || 2);
  if (hasPartial) {
    return tp >= 2.0
      ? 'HÍBRIDO: partial cierra rápido (scalp) + final corre a TP swing/intradía. Mecanismo de GESTIÓN DE RIESGO, NO es scalping puro ni swing puro.'
      : 'HÍBRIDO scalping: partial cierra ultra-rápido + final a TP scalp. Es scalping con gestión de riesgo (BE after partial).';
  }
  if (tp <= 0.3) return 'SCALPING puro: TP ultra-cercano. Trades muy rápidos.';
  if (tp <= 0.5) return 'SCALPING / DAY TRADING corto: TP cercano, alta frecuencia.';
  if (tp <= 1.0) return 'DAY TRADING intradía: TP moderado, trades medios.';
  if (tp <= 2.0) return 'DAY TRADING / SWING corto: TP amplio.';
  return 'SWING INTRADÍA: TP amplio, deja correr el movimiento. NO es day-trading ni scalping clásico.';
}

function rrEffective(s) {
  const c = s.config;
  const sl = Number(c.S1_SL_MULT || 1);
  const tp = Number(c.S1_TP_MULT || 2);
  if (c.S1_PARTIAL_TP_MULT) {
    const ptp = Number(c.S1_PARTIAL_TP_MULT);
    const pfrac = Number(c.S1_PARTIAL_FRACTION || 0.5);
    const eff = (ptp * pfrac + tp * (1 - pfrac)) / sl;
    return `1:${eff.toFixed(2)} (weighted partial)`;
  }
  return `1:${(tp/sl).toFixed(2)}`;
}

function breakevenWr(s) {
  const c = s.config;
  const sl = Number(c.S1_SL_MULT || 1);
  const tp = Number(c.S1_TP_MULT || 2);
  if (c.S1_PARTIAL_TP_MULT) {
    const ptp = Number(c.S1_PARTIAL_TP_MULT);
    const pfrac = Number(c.S1_PARTIAL_FRACTION || 0.5);
    const effR = (ptp * pfrac + tp * (1 - pfrac)) / sl;
    return (1 / (1 + effR));
  }
  return 1 / (1 + tp/sl);
}

// Sort by TotalR descending
const strategies = [...STRATEGIES].sort((a, b) => b.metrics.totalR_5y - a.metrics.totalR_5y);

async function build() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CHAD BOT';
  wb.created = new Date();

  // ═════════════ HOJA 1: Ranking ═════════════
  const ws = wb.addWorksheet('Ranking Definitivo');

  ws.columns = [
    { header: '#', key: 'rank', width: 5 },
    { header: 'ID', key: 'id', width: 22 },
    { header: 'Activo', key: 'asset', width: 10 },
    { header: 'Tipo', key: 'tipo', width: 9 },
    { header: 'Estilo operativo', key: 'estilo', width: 28 },
    { header: 'Origen / Categoría (CLARIFICA partial)', key: 'origen', width: 55 },
    { header: 'Timeframe base', key: 'tf', width: 38 },
    { header: 'Duración estimada', key: 'dur', width: 38 },
    { header: 'Horario / Sesión', key: 'horario', width: 50 },
    { header: 'Mecánica · Filtros', key: 'mecanica', width: 60 },
    { header: 'SL ×ATR', key: 'sl', width: 9 },
    { header: 'TP ×ATR', key: 'tp', width: 9 },
    { header: 'Partial TP ×ATR', key: 'ptp', width: 11 },
    { header: 'Partial fracción', key: 'pfrac', width: 11 },
    { header: 'BE after partial', key: 'be', width: 11 },
    { header: 'R/R efectivo', key: 'rr', width: 24 },
    { header: 'Breakeven WR', key: 'be_wr', width: 12 },
    { header: 'Trades 5y', key: 'trades', width: 10 },
    { header: 'WinRate IS', key: 'wr_is', width: 11 },
    { header: 'WinRate OS', key: 'wr_os', width: 11 },
    { header: 'Margen WR sobre BE', key: 'margin', width: 14 },
    { header: 'AvgR IS', key: 'avgR_is', width: 11 },
    { header: 'AvgR OS', key: 'avgR_os', width: 11 },
    { header: 'TotalR 5y', key: 'totalR', width: 12 },
    { header: 'Max DD (R)', key: 'dd', width: 11 },
    { header: 'Max Streak Losses', key: 'streak', width: 11 },
    { header: 'Decay OOS %', key: 'decay', width: 11 },
    { header: 'Robustez', key: 'robust', width: 10 },
    { header: 'Tagline', key: 'tag', width: 50 },
    { header: 'Pros (top 3)', key: 'pros', width: 60 },
    { header: 'Cons (top 3)', key: 'cons', width: 60 },
    { header: 'Ideal para', key: 'ideal', width: 60 },
  ];

  // Header style
  ws.getRow(1).eachCell(c => {
    c.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2A44' } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = {
      left:  { style: 'thin', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } },
      top:   { style: 'thin', color: { argb: 'FF000000' } },
      bottom:{ style: 'thin', color: { argb: 'FF000000' } },
    };
  });
  ws.getRow(1).height = 40;

  // Data rows
  strategies.forEach((s, idx) => {
    const c = s.config;
    const m = s.metrics;
    const e = s.explanation;
    const beWr = breakevenWr(s);
    const margin = (m.winRate_OS / 100) - beWr;

    const row = ws.addRow({
      rank: idx + 1,
      id: s.id,
      asset: s.asset,
      tipo: s.category === 'scalping' ? 'scalping' : 'main',
      estilo: detectStyle(s),
      origen: detectOrigin(s),
      tf: 'M5 base + multi-TF context (M15/H1/H4)',
      dur: detectDuration(s),
      horario: detectSchedule(s),
      mecanica: 'Sweep+Reclaim S1 · HTF bias filter · ' + (e.how || '').slice(0, 90),
      sl: Number(c.S1_SL_MULT || 1),
      tp: Number(c.S1_TP_MULT || 2),
      ptp: c.S1_PARTIAL_TP_MULT ? Number(c.S1_PARTIAL_TP_MULT) : null,
      pfrac: c.S1_PARTIAL_FRACTION ? Number(c.S1_PARTIAL_FRACTION) : null,
      be: c.S1_BE_AFTER_PARTIAL === '1' ? 'Sí' : (c.S1_PARTIAL_TP_MULT ? 'No' : '—'),
      rr: rrEffective(s),
      be_wr: beWr,
      trades: m.trades_5y || 0,
      wr_is: m.winRate_IS / 100,
      wr_os: m.winRate_OS / 100,
      margin: margin,
      avgR_is: m.avgR_IS,
      avgR_os: m.avgR_OS,
      totalR: m.totalR_5y,
      dd: m.maxDD_R,
      streak: m.maxStreakLosses,
      decay: m.decay_pct / 100,
      robust: s.robustness || 'alta',
      tag: s.tagline || '',
      pros: (e.pros || []).slice(0, 3).join(' · '),
      cons: (e.cons || []).slice(0, 3).join(' · '),
      ideal: e.idealFor || '',
    });

    row.eachCell((cell, colNumber) => {
      cell.font = { name: 'Arial', size: 10 };
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = {
        left:   { style: 'thin', color: { argb: 'FFCCCCCC' } },
        right:  { style: 'thin', color: { argb: 'FFCCCCCC' } },
        top:    { style: 'thin', color: { argb: 'FFCCCCCC' } },
        bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
      };

      // Number formats
      if (colNumber === 17) cell.numFmt = '0.0%';        // Breakeven WR
      if (colNumber === 19) cell.numFmt = '0.0%';        // WR IS
      if (colNumber === 20) cell.numFmt = '0.0%';        // WR OS
      if (colNumber === 21) cell.numFmt = '+0.0%;[Red]-0.0%';  // Margen
      if (colNumber === 22) cell.numFmt = '+0.000;[Red]-0.000;-';  // AvgR IS
      if (colNumber === 23) cell.numFmt = '+0.000;[Red]-0.000;-';  // AvgR OS
      if (colNumber === 24) cell.numFmt = '+0.0"R";[Red]-0.0"R";-';  // TotalR
      if (colNumber === 25) cell.numFmt = '0.0"R"';      // DD
      if (colNumber === 27) cell.numFmt = '+0.0%;[Red]-0.0%';  // Decay
      if (colNumber === 11 || colNumber === 12 || colNumber === 13 || colNumber === 14) cell.numFmt = '0.00';
      if (colNumber === 18) cell.numFmt = '#,##0';

      // Color en tipo
      if (colNumber === 4) {
        if (cell.value === 'scalping') {
          cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFB45F06' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
        } else {
          cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF0B5394' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
        }
        cell.alignment = { ...cell.alignment, horizontal: 'center' };
      }

      // Decay coloring
      if (colNumber === 27 && typeof cell.value === 'number') {
        if (cell.value > 0) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
        } else if (cell.value > -0.30) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } };
        } else if (cell.value > -0.60) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
        } else {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF8080' } };
        }
      }

      // TotalR coloring (top is green)
      if (colNumber === 24 && typeof cell.value === 'number') {
        const v = cell.value;
        if (v >= 400) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF63BE7B' } };
        else if (v >= 200) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB5E2A8' } };
        else if (v >= 100) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7F2D5' } };
        else if (v >= 50) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8E1' } };
        else if (v >= 10) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEFC3' } };
      }
    });
    row.height = 85;
  });

  ws.views = [{ state: 'frozen', xSplit: 4, ySplit: 1 }];

  // ═════════════ HOJA 2: Notas ═════════════
  const ws2 = wb.addWorksheet('Notas y Leyenda');
  ws2.columns = [
    { header: 'Concepto', key: 'concept', width: 38 },
    { header: 'Explicación', key: 'expl', width: 110 },
  ];

  const notes = [
    ['GUÍA DE COLUMNAS · CHAD BOT STRATEGY REGISTRY', ''],
    ['', ''],
    ['Tipo', 'main = estrategia principal · scalping = trades 3-15 min con TPs ajustados'],
    ['Estilo operativo', 'Clasificación según TP/SL: Sniper, Scalp, Intradía, Swing, Partial'],
    ['', ''],
    ['━━━━━ ACLARACIÓN CRÍTICA: PARTIAL ━━━━━', ''],
    ['Las estrategias PARTIAL no son scalp ni swing puros', ''],
    ['  • Son HÍBRIDAS: bot abre el trade con SL+TP ATR-based', ''],
    ['  • Al alcanzar TP1 (partial), cierra una porción (50/70%) → SL→BE', ''],
    ['  • El resto del trade corre al TP final (puede ser scalp o swing)', ''],
    ['  • Es una técnica de GESTIÓN DE RIESGO, no un estilo en sí', ''],
    ['  • Beneficio: combina alta probabilidad (TP1 cercano) + dejar correr ganadores', ''],
    ['', ''],
    ['PA1, PA3 (main)', 'Partial híbrido: TP1 scalp (+0.5 o +1.0 ATR) + final swing intradía (+2.5 ATR). El partial es scalping, el final es day/swing trading.'],
    ['C1, C2 (scalp)', 'Partial scalping puro: TP1 ultra-cerca (+0.2 o +0.3) + final scalp (+0.7 ATR). Todo es scalping pero con 2 targets.'],
    ['', ''],
    ['━━━━━ ESTILOS OPERATIVOS ━━━━━', ''],
    ['Sniper ultra-scalp', 'TP×0.3 ATR (3-8 min). Wide stop SL×1.5-2 ATR. WinRate 85-91%. Ej: S8, B1, B2'],
    ['Scalp rápido', 'TP×0.5 ATR (5-15 min). SL×1 ATR. WinRate 68-75%. Ej: P1'],
    ['Intradía corto', 'TP×0.7-1.0 ATR (10-30 min). Trades medios'],
    ['Swing intradía', 'TP×2.5 ATR (30-90 min). SL×0.7 ATR. R/R 1:3.5. WinRate 25-27%. Ej: J3'],
    ['Partial híbrido', 'TP1 scalp + TP2 swing. Wr ~50-60%, captura quick profit + dejar correr'],
    ['', ''],
    ['━━━━━ MÉTRICAS CLAVE ━━━━━', ''],
    ['Breakeven WR', '% mínimo de wins necesario para no perder, dado el R/R'],
    ['Margen WR sobre BE', 'WR actual - Breakeven WR. Más alto = más cushion contra ruido de mercado'],
    ['Decay OOS %', 'Cambio en AvgR entre train (2022-24) y test (2025-26). 0% = edge perfecto. Negativo = edge se degrada. Positivo = edge mejoró en data nueva'],
    ['Robustez', 'Verdict cualitativo basado en decay + DD + sample'],
    ['', ''],
    ['━━━━━ HORARIOS / SESIONES ━━━━━', ''],
    ['London KZ', '07:00-09:59 UTC (apertura London + primera hora)'],
    ['NY KZ', '12:00-14:59 UTC (apertura NY + primera hora)'],
    ['Horas malas (10/15/18 UTC)', 'Horas con winrate <33% históricamente en XAU/USD'],
    ['NY_PM', '17:00-19:59 UTC. Sesión perdedora cross-asset'],
    ['Sin Lunes', 'Lunes históricamente débil (noise de fin de semana)'],
    ['', ''],
    ['━━━━━ ATR & DURACIONES ━━━━━', ''],
    ['ATR período', '14 velas M5 (≈ 70 minutos de volatilidad)'],
    ['XAU ATR típico', '~$2-3 USD'],
    ['EUR ATR típico', '~0.0005-0.0008 (5-8 pips)'],
    ['BTC ATR típico', '~$200-400'],
    ['SPX/NAS ATR', '~5-15 puntos'],
    ['GBP ATR típico', '~0.0008-0.0012 (8-12 pips)'],
  ];

  // Estilo del header
  ws2.getRow(1).eachCell(c => {
    c.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2A44' } };
    c.alignment = { horizontal: 'center' };
  });

  notes.forEach(([concept, expl]) => {
    const row = ws2.addRow({ concept, expl });
    if (concept.includes('━')) {
      row.getCell(1).font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FF1F2A44' } };
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
      row.height = 28;
    } else if (concept === 'GUÍA DE COLUMNAS · CHAD BOT STRATEGY REGISTRY') {
      row.getCell(1).font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FF1F2A44' } };
      row.height = 32;
    } else {
      row.getCell(1).font = { name: 'Arial', size: 10, bold: true };
      row.getCell(2).font = { name: 'Arial', size: 10 };
      row.getCell(2).alignment = { vertical: 'middle', wrapText: true };
      row.height = 22;
    }
  });

  // ═════════════ HOJA 3: Resumen por activo ═════════════
  const ws3 = wb.addWorksheet('Resumen por Activo');
  ws3.columns = [
    { header: 'Activo', key: 'asset', width: 12 },
    { header: 'Total Estrategias', key: 'total', width: 18 },
    { header: 'Main', key: 'main', width: 8 },
    { header: 'Scalping', key: 'scalp', width: 10 },
    { header: 'Top 1 (más rentable)', key: 'top', width: 22 },
    { header: 'Top TotalR', key: 'topR', width: 14 },
    { header: 'Top WR OS', key: 'topWR', width: 12 },
    { header: 'Top decay', key: 'topDecay', width: 12 },
  ];

  ws3.getRow(1).eachCell(c => {
    c.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2A44' } };
    c.alignment = { horizontal: 'center' };
  });

  // Agrupar
  const byAsset = {};
  for (const s of strategies) {
    (byAsset[s.asset] = byAsset[s.asset] || []).push(s);
  }
  const sortedAssets = Object.entries(byAsset).sort((a, b) =>
    b[1].reduce((acc, s) => acc + s.metrics.totalR_5y, 0) -
    a[1].reduce((acc, s) => acc + s.metrics.totalR_5y, 0));

  for (const [asset, slist] of sortedAssets) {
    const mainCount = slist.filter(s => s.category !== 'scalping').length;
    const scalpCount = slist.filter(s => s.category === 'scalping').length;
    const top = slist.reduce((a, b) => a.metrics.totalR_5y > b.metrics.totalR_5y ? a : b);
    const row = ws3.addRow({
      asset, total: slist.length, main: mainCount, scalp: scalpCount,
      top: top.id, topR: top.metrics.totalR_5y,
      topWR: top.metrics.winRate_OS / 100,
      topDecay: top.metrics.decay_pct / 100,
    });
    row.getCell(6).numFmt = '+0.0"R"';
    row.getCell(7).numFmt = '0.0%';
    row.getCell(8).numFmt = '+0.0%;[Red]-0.0%';
    row.eachCell(c => { c.font = { name: 'Arial', size: 10 }; c.alignment = { vertical: 'middle' }; });
  }

  // ═════════════ HOJA 4: Patrones universales ═════════════
  const ws4 = wb.addWorksheet('Patrones Universales');
  ws4.columns = [
    { header: 'ESTRATEGIA', key: 's', width: 24 },
    { header: 'CONFIG', key: 'cfg', width: 40 },
    { header: 'ACTIVOS CONFIRMADOS', key: 'assets', width: 65 },
    { header: '#', key: 'n', width: 6 },
    { header: 'WR RANGE', key: 'wr', width: 16 },
    { header: 'CATEGORÍA', key: 'cat', width: 28 },
  ];
  ws4.getRow(1).eachCell(c => {
    c.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2A44' } };
    c.alignment = { horizontal: 'center', wrapText: true };
  });
  const patterns = [
    ['PA1 (main)', 'SL×0.7 TP×2.5 + partial 0.5/50% + BE', 'XAU, EUR, BTC, NAS, USDCAD, USDJPY, GBPUSD, GBPAUD', 8, '58.5% - 63.7%', 'Universal multi-asset'],
    ['S8 / B1 (main/scalp)', 'SL×1.5 TP×0.3 + killzones', 'SPX, NAS, USDCAD, USDJPY, GBPUSD, GBPAUD, EURUSD', 7, '83.5% - 88.4%', 'Universal índices+FX'],
    ['B2 (scalp)', 'SL×2.0 TP×0.3', 'XAU, SPX, NAS, USDCAD, USDJPY, GBPUSD, AUDUSD, GBPAUD', 8, '87.4% - 91.2%', 'Universal scalp ultra-extremo'],
    ['C2 (scalp/main)', 'SL×1.0 TP×0.7 + partial 0.3/70% + BE', 'XAU, EUR, BTC, NAS, USDCAD, GBPUSD, GBPAUD', 7, '76.1% - 81.0%', 'Universal partial-scalp'],
    ['J3 (main)', 'SL×0.7 TP×2.5', 'XAU, BTC, USDCAD, USDJPY, GBPUSD, GBPAUD', 6, '23.4% - 27.5%', 'Swing rangos amplios'],
    ['P1 (main)', 'SL×1.0 TP×0.5 + killzones', 'XAU, EUR, BTC, NAS, USDCAD, USDJPY, GBPUSD, GBPAUD', 8, '66.6% - 73.5%', 'Scalp killzones FX'],
    ['PA3 (main)', 'SL×0.7 TP×2.5 + partial 1.0/50% + BE', 'XAU, BTC, GBPUSD, GBPAUD', 4, '43.6% - 47.8%', 'Mid balance partial'],
  ];
  for (const p of patterns) {
    const row = ws4.addRow({ s: p[0], cfg: p[1], assets: p[2], n: p[3], wr: p[4], cat: p[5] });
    row.height = 50;
    row.eachCell(c => { c.font = { name: 'Arial', size: 10 }; c.alignment = { vertical: 'middle', wrapText: true }; });
  }

  await wb.xlsx.writeFile('backtest/Ranking-Estrategias-CHAD-BOT.xlsx');
  console.log('✅ Excel generated: backtest/Ranking-Estrategias-CHAD-BOT.xlsx');
  console.log(`   ${strategies.length} strategies across ${Object.keys(byAsset).length} assets`);
  console.log('   4 sheets: Ranking, Notas y Leyenda, Resumen por Activo, Patrones Universales');
}

build().catch(e => { console.error(e); process.exit(1); });

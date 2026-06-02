/**
 * server/bot/strategies/registry.js
 *
 * Registro de estrategias backtested y disponibles para activar en el bot live.
 * Cada estrategia tiene:
 *   - id, name, asset
 *   - config (env-vars que aplicarán al s1Strategy)
 *   - metrics (resultados de backtest 5y)
 *   - explanation (qué hace, cómo opera, fortalezas/debilidades)
 *
 * Para activar en producción:
 *   fly secrets set S1_SL_MULT=0.7 S1_TP_MULT=2.5 ... (ver config)
 *   o usar /api/strategies/activate
 */

const fs = require('fs');
const path = require('path');

const ACTIVE_FILE = path.join(__dirname, 'active.json');

const STRATEGIES = [
  {
    id: 'J3',
    name: 'J3 base',
    asset: 'XAUUSD',
    badge: '⚖️ La robusta clásica',
    tagline: 'Bajo winrate, alto profit. La más matemáticamente sólida.',
    config: {
      S1_BAD_SESSIONS: 'NY_PM',
      S1_BAD_HOURS: '10,15,18',
      S1_BAD_DOWS: '1',
      S1_SL_MULT: '0.7',
      S1_TP_MULT: '2.5',
    },
    metrics: {
      winRate_IS: 27.3,
      winRate_OS: 27.1,
      avgR_IS: 0.247,
      avgR_OS: 0.238,
      totalR_5y: 493.4,
      maxDD_R: 27.4,
      maxStreakLosses: 28,
      decay_pct: -3.6,
      trades_5y: 2032,
    },
    robustness: 'alta',
    explanation: {
      summary: 'La estrategia más matemáticamente honesta. Pocas wins pero grandes (TP×2.5 ATR). Decay mínimo en out-of-sample.',
      how: 'Detecta sweep + reclaim de niveles institucionales. SL ajustado (0.7×ATR), TP amplio (2.5×ATR). R/R efectivo 3.57:1.',
      pros: [
        'Edge confirmado en data nueva (decay -3.6%)',
        'Profit total más alto: +493R en 5 años',
        'Sample grande (2,032 trades) — confiable estadísticamente',
        'Risk-adjusted return el mejor (R/DD 14.5)',
      ],
      cons: [
        'WinRate bajo (27%) — psicológicamente exigente',
        'Streak máxima de 28 losses seguidos',
        '73% del tiempo estás "perdiendo"',
        'Requiere disciplina extrema para no abandonar en rachas largas',
      ],
      idealFor: 'Trader con experiencia, disciplinado, horizonte 6+ meses, no chequea cuenta a diario.',
    },
  },

  {
    id: 'P1',
    name: 'P1 alto winrate',
    asset: 'XAUUSD',
    badge: '⚠️ Alto winrate (frágil)',
    tagline: '70% winrate pero CON RIESGO de overfit. Monitoreo activo.',
    config: {
      S1_BAD_SESSIONS: 'NY_PM',
      S1_BAD_DOWS: '1',
      S1_KILLZONES: '7,8,9,12,13,14',
      S1_SL_MULT: '1',
      S1_TP_MULT: '0.5',
    },
    metrics: {
      winRate_IS: 71.7,
      winRate_OS: 69.1,
      avgR_IS: 0.076,
      avgR_OS: 0.036,
      totalR_5y: 101.0,
      maxDD_R: 13.5,
      maxStreakLosses: 8,
      decay_pct: -52.6,
      trades_5y: 1609,
    },
    robustness: 'baja',
    explanation: {
      summary: 'Killzones London + NY puras con SL×1 ATR y TP×0.5 ATR. 70% winrate atractivo PERO walk-forward mostró degradación -52% en OOS.',
      how: 'Solo opera en killzones ICT (7-9, 12-14 UTC). Sin lunes, sin NY_PM. TP cercano (0.5×ATR), SL normal (1×ATR). R/R 1:0.5.',
      pros: [
        '69% winrate (sensación de "ganar seguido")',
        'DD bajo: 13.5R',
        'Max streak losses solo 8 (vs 28 J3)',
        'Coherente con metodología ICT (institucional)',
      ],
      cons: [
        '⚠️ DECAY -52% en out-of-sample (frágil)',
        '2026 YTD fue NEGATIVO (-3R, 65% wr)',
        'Margen sobre breakeven muy chico (1pp)',
        'Profit total solo +101R (1/5 de J3)',
        'Requiere monitoreo activo + kill-switch',
      ],
      idealFor: 'Trader que prioriza sensación psicológica, dispuesto a apagar si rinde mal 5 días seguidos.',
    },
  },

  {
    id: 'PA1',
    name: 'PA1 partial-profit',
    asset: 'XAUUSD',
    badge: '🎯 La mejor balance',
    tagline: '60% winrate + robustez intacta. J3 con partial profit-taking.',
    config: {
      S1_BAD_SESSIONS: 'NY_PM',
      S1_BAD_HOURS: '10,15,18',
      S1_BAD_DOWS: '1',
      S1_SL_MULT: '0.7',
      S1_TP_MULT: '2.5',
      S1_PARTIAL_TP_MULT: '0.5',
      S1_PARTIAL_FRACTION: '0.5',
      S1_BE_AFTER_PARTIAL: '1',
    },
    metrics: {
      winRate_IS: 62.5,
      winRate_OS: 60.5,
      avgR_IS: 0.128,
      avgR_OS: 0.118,
      totalR_5y: 252.6,
      maxDD_R: 13.6,
      maxStreakLosses: 10,
      decay_pct: -7.8,
      trades_5y: 2032,
    },
    robustness: 'alta',
    explanation: {
      summary: 'J3 con partial profit-taking inteligente. Sube winrate a 60% sin overfittear. Reduce drawdown a la mitad de J3.',
      how: 'Mismos filtros de entrada que J3 (robustos). Pero cierra 50% del trade en +0.5×ATR y mueve SL a breakeven. La otra mitad corre a +2.5×ATR.',
      pros: [
        '🎯 60.5% winrate en OOS (objetivo cumplido)',
        'Decay solo -7.8% (robusta)',
        'DD máximo 13.6R (LA MITAD de J3)',
        'Max streak losses solo ~10',
        'Sin overfit — no filtros nuevos, solo exit inteligente',
      ],
      cons: [
        'Profit total +253R (-49% vs J3 que da +493R)',
        'Implementación más compleja (broker debe soportar partial close)',
        'Algunas wins "se cortan" antes de tiempo',
      ],
      idealFor: 'TRADER PROMEDIO: mejor balance entre psicología y robustez. Mi recomendación principal.',
    },
  },

  {
    id: 'PA3',
    name: 'PA3 mid-balance',
    asset: 'XAUUSD',
    badge: '⚖️ Mid balance',
    tagline: '46% winrate con +338R. Más profit que PA1, más winrate que J3.',
    config: {
      S1_BAD_SESSIONS: 'NY_PM',
      S1_BAD_HOURS: '10,15,18',
      S1_BAD_DOWS: '1',
      S1_SL_MULT: '0.7',
      S1_TP_MULT: '2.5',
      S1_PARTIAL_TP_MULT: '1.0',
      S1_PARTIAL_FRACTION: '0.5',
      S1_BE_AFTER_PARTIAL: '1',
    },
    metrics: {
      winRate_IS: 47.2,
      winRate_OS: 45.8,
      avgR_IS: 0.171,
      avgR_OS: 0.165,
      totalR_5y: 338.3,
      maxDD_R: 17.4,
      maxStreakLosses: 15,
      decay_pct: -3.5,
      trades_5y: 2032,
    },
    robustness: 'alta',
    explanation: {
      summary: 'Como PA1 pero con TP1 más lejano (+1.0×ATR). Mantiene robustez y captura más profit total. Punto medio entre J3 y PA1.',
      how: 'Filtros de entrada J3. TP1 = +1.0×ATR (cierra 50%), después SL → BE, TP2 = +2.5×ATR.',
      pros: [
        '🥇 Decay solo -3.5% (igual o más robusta que J3 base)',
        'Profit total +338R (-31% vs J3)',
        'WinRate 46% sigue dando "sensación de ganar"',
        'DD 17.4R (mejor que J3)',
      ],
      cons: [
        'WinRate menor que PA1 (46% vs 60%)',
        'Streak max de 15 losses (más que PA1)',
        'TP1 a +1×ATR se alcanza menos seguido que +0.5×ATR',
      ],
      idealFor: 'Trader que quiere MEJOR profit que PA1 pero mejor psicología que J3. Punto medio óptimo.',
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // EUR/USD strategies
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'P1-EUR',
    name: 'P1 alto winrate · EUR',
    asset: 'EURUSD',
    badge: '🎯 Especialidad EUR',
    tagline: '68% winrate. En EUR/USD el setup de killzones funciona MEJOR en out-of-sample.',
    config: {
      S1_BAD_SESSIONS: 'NY_PM',
      S1_BAD_DOWS: '1',
      S1_KILLZONES: '7,8,9,12,13,14',
      S1_SL_MULT: '1',
      S1_TP_MULT: '0.5',
    },
    metrics: {
      winRate_IS: 67.5,
      winRate_OS: 68.2,
      avgR_IS: 0.013,
      avgR_OS: 0.022,
      totalR_5y: 46.5,
      maxDD_R: 26.0,
      maxStreakLosses: 7,
      decay_pct: 69.2,   // ¡decay POSITIVO! mejoró en OOS
      trades_5y: 2004,
    },
    robustness: 'alta',
    explanation: {
      summary: 'En EUR/USD el setup P1 mostró comportamiento opuesto al de XAU/USD: el edge MEJORÓ en out-of-sample (+69% decay positivo). El setup encaja mejor con la microestructura FX que con commodities.',
      how: 'Mismas killzones London + NY (7-9, 12-14 UTC). SL×1 ATR, TP×0.5 ATR (1:0.5 R/R). Sin lunes, sin NY_PM.',
      pros: [
        '✅ 68.2% winrate en OOS (subió 0.7pp vs train)',
        '✅ Decay POSITIVO +69% (mejoró en data nueva)',
        'DD máximo 26R (manejable)',
        'Max streak losses solo 7 (psicológicamente cómoda)',
        'Coherente con metodología ICT institucional',
      ],
      cons: [
        'Profit total bajo: +46R en 5 años (vs +158 de PA1)',
        'AvgR/trade chiquito (+0.022R) — requiere muchos trades para compounding',
        'Sensible al spread del broker (TP cercano)',
      ],
      idealFor: 'Trader FX que opera EUR/USD spec con cuenta chica y bajo spread. Sentirse cómodo ganando seguido.',
    },
  },

  {
    id: 'PA1-EUR',
    name: 'PA1 partial-profit · EUR (GENÉRICA)',
    asset: 'EURUSD',
    badge: '⭐ Universal & robusta',
    tagline: '59% winrate idéntico al de XAU. La única estrategia que transfiere bien entre activos.',
    config: {
      S1_BAD_SESSIONS: 'NY_PM',
      S1_BAD_HOURS: '10,15,18',
      S1_BAD_DOWS: '1',
      S1_SL_MULT: '0.7',
      S1_TP_MULT: '2.5',
      S1_PARTIAL_TP_MULT: '0.5',
      S1_PARTIAL_FRACTION: '0.5',
      S1_BE_AFTER_PARTIAL: '1',
    },
    metrics: {
      winRate_IS: 58.8,
      winRate_OS: 59.5,
      avgR_IS: 0.054,
      avgR_OS: 0.048,
      totalR_5y: 158.2,
      maxDD_R: 36.8,
      maxStreakLosses: 8,
      decay_pct: -11.1,
      trades_5y: 2495,
    },
    robustness: 'alta',
    explanation: {
      summary: 'La estrategia "universal" — funciona prácticamente igual en XAU/USD y EUR/USD. La validación cruzada en dos activos distintos confirma que el edge es real y robusto, no overfit al gold.',
      how: 'Mismos filtros J3 (sin NY_PM, sin Mon, sin horas 10/15/18). SL×0.7, TP final ×2.5. Partial: cierra 50% del trade en +0.5×ATR y mueve SL a breakeven.',
      pros: [
        '⭐ Edge TRANSFIERE entre activos (XAU + EUR similar)',
        '✅ 59.5% winrate OOS prácticamente idéntico al IS',
        '✅ Decay solo -11.1% (robusta)',
        'Profit total +158R en 5 años EUR (vs +252R XAU — buen scale)',
        'Mecanismo partial-profit reduce DD significativamente',
        'Streak max losses solo 8',
      ],
      cons: [
        'DD máximo 36.8R (más alto que P1-EUR)',
        'Implementación compleja (broker debe soportar partial close)',
        'Trades de larga duración (esperar TP×2.5)',
      ],
      idealFor: 'RECOMENDACIÓN PRINCIPAL para EUR/USD. Trader que busca consistencia y robustez verificada en multi-asset.',
    },
  },
];

// ─────────────────────────────────────────
// Active strategy persistence
// ─────────────────────────────────────────
function getActive() {
  try {
    if (!fs.existsSync(ACTIVE_FILE)) return null;
    return JSON.parse(fs.readFileSync(ACTIVE_FILE, 'utf8'));
  } catch (e) {
    return null;
  }
}

function setActive(strategyId) {
  const strat = STRATEGIES.find(s => s.id === strategyId);
  if (!strat) throw new Error(`Estrategia desconocida: ${strategyId}`);
  fs.writeFileSync(ACTIVE_FILE, JSON.stringify({
    activatedAt: new Date().toISOString(),
    strategyId,
    config: strat.config,
  }, null, 2));
  return strat;
}

function getActiveConfig() {
  const active = getActive();
  if (!active) return {};
  return active.config || {};
}

function getAll() {
  return STRATEGIES;
}

function getById(id) {
  return STRATEGIES.find(s => s.id === id) || null;
}

module.exports = { STRATEGIES, getActive, setActive, getActiveConfig, getAll, getById };

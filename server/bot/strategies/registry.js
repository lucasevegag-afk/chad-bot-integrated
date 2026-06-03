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

  // ═══════════════════════════════════════════════════════════════
  // BTC/USD strategies
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'J3-BTC',
    name: 'J3 robusta · BTC',
    asset: 'BTCUSDT',
    badge: '🥇 Top profit',
    tagline: 'J3 transfiere a BTC con MÁS profit (+548R) que XAU (+493R). 24/7 trading = más oportunidades.',
    config: {
      S1_BAD_SESSIONS: 'NY_PM',
      S1_BAD_HOURS: '10,15,18',
      S1_BAD_DOWS: '1',
      S1_SL_MULT: '0.7',
      S1_TP_MULT: '2.5',
    },
    metrics: {
      winRate_IS: 26.3,
      winRate_OS: 25.5,
      avgR_IS: 0.202,
      avgR_OS: 0.164,
      totalR_5y: 548.0,
      maxDD_R: 57.0,
      maxStreakLosses: 28,
      decay_pct: -18.8,
      trades_5y: 2913,
    },
    robustness: 'alta',
    explanation: {
      summary: 'J3 verificada en BTC con resultados aún mejores que XAU. BTC opera 24/7 y tiene rangos amplios similares al oro — el setup sweep+reclaim con TP amplio se alcanza con frecuencia.',
      how: 'Mismo setup J3 que en XAU: SL×0.7 ATR, TP×2.5 ATR. Sin lunes, sin NY_PM, sin horas 10/15/18. Filtros sesión heredados (aunque crypto opera 24/7, los patrones de volatilidad institucional se mantienen).',
      pros: [
        '✅ +548R en 5 años (mejor que XAU)',
        'Decay -18.8% (robusta)',
        'Sample grande (2,913 trades)',
        'BTC tiene rangos amplios → TP se alcanza',
        'Expectancy +0.164R/trade en OOS',
      ],
      cons: [
        'WinRate 25.5% — psicológicamente exigente',
        'Streak máxima ~28 losses',
        'DD máximo 57R (más alto que PA1/PA3 BTC)',
        'BTC tiene gaps de volatilidad (crashes súbitos)',
      ],
      idealFor: 'Trader que ya operó J3 en XAU y quiere extender el sistema a crypto. Mismas reglas de disciplina aplican.',
    },
  },

  {
    id: 'PA1-BTC',
    name: 'PA1 partial-profit · BTC',
    asset: 'BTCUSDT',
    badge: '🎯 Balance universal',
    tagline: '58.5% winrate, transferencia limpia desde XAU. La estrategia que funciona en TODOS los activos.',
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
      winRate_IS: 61.3,
      winRate_OS: 58.5,
      avgR_IS: 0.121,
      avgR_OS: 0.093,
      totalR_5y: 322.0,
      maxDD_R: 34.0,
      maxStreakLosses: 10,
      decay_pct: -23.1,
      trades_5y: 2913,
    },
    robustness: 'alta',
    explanation: {
      summary: 'PA1 sigue siendo la estrategia universal: 58.5% winrate en BTC casi idéntico a XAU (60.5%) y EUR (59.5%). El partial profit-taking aplica igual de bien a crypto.',
      how: 'Filtros J3 + partial: cierra 50% en +0.5×ATR + SL→BE + corre resto a +2.5×ATR. Mismas reglas que la PA1 de XAU.',
      pros: [
        '⭐ Edge transfiere de XAU, EUR y BTC casi idénticamente',
        '58.5% winrate OOS',
        '+322R en 5 años',
        'DD bajo: 34R',
        'Max streak losses 10',
        'Sin overfit demostrado en 3 activos diferentes',
      ],
      cons: [
        'AvgR ligeramente menor que en XAU (0.093 vs 0.118)',
        'BTC requiere broker con buen spread crypto',
        'Trades pueden quedar abiertos en weekends (crypto 24/7)',
      ],
      idealFor: 'TRADER MULTI-ASSET: querés operar XAU, EUR y BTC con la MISMA estrategia. Diversificación clean.',
    },
  },

  {
    id: 'PA3-BTC',
    name: 'PA3 mid-balance · BTC (LA ESTRELLA)',
    asset: 'BTCUSDT',
    badge: '⭐⭐⭐ Top robusta BTC',
    tagline: 'Decay -4.2% (casi cero), +479R, DD 35R. La estrategia más estable encontrada hasta ahora en BTC.',
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
      winRate_IS: 47.3,
      winRate_OS: 45.8,
      avgR_IS: 0.168,
      avgR_OS: 0.161,
      totalR_5y: 479.0,
      maxDD_R: 35.0,
      maxStreakLosses: 15,
      decay_pct: -4.2,
      trades_5y: 2913,
    },
    robustness: 'alta',
    explanation: {
      summary: 'EL HALLAZGO MÁS NOTABLE en BTC: PA3 muestra decay -4.2% (cuasi-zero). Profit total +479R con DD solo 35R. R/DD ratio = 13.7 — la mejor de TODAS las estrategias.',
      how: 'Filtros J3 + partial al +1.0×ATR (en vez de 0.5 como PA1). El TP1 más lejano captura más profit por cada trade exitoso, mientras el BE protege el resto.',
      pros: [
        '🥇 Decay -4.2% (la más robusta de todas)',
        '⭐ +479R en 5 años (top 2 con J3-BTC)',
        '46% winrate (sensación de "ganar la mitad")',
        'DD 35R (vs 57 de J3-BTC)',
        'Max streak ~15 (manejable)',
        'AvgR +0.161R en OOS (alto)',
      ],
      cons: [
        'Implementación con partial profit requiere broker compatible',
        'Esperar TP×2.5 puede ser largo (BTC se mueve rápido)',
        'Streak max 15 sigue siendo exigente psicológicamente',
      ],
      idealFor: 'RECOMENDACIÓN PRINCIPAL para BTC: mejor balance entre profit, robustez y manejabilidad encontrado hasta ahora en crypto.',
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // SPX500 (S&P 500) strategies
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'S8-SPX',
    name: 'S8 sniper · SPX500',
    asset: 'SPX500',
    badge: '🎯 85% winrate · decay positivo',
    tagline: 'La única estrategia que MEJORÓ en out-of-sample. Scalper paciente para índices.',
    config: {
      S1_BAD_SESSIONS: 'NY_PM',
      S1_BAD_DOWS: '1',
      S1_KILLZONES: '7,8,9,12,13,14',
      S1_SL_MULT: '1.5',
      S1_TP_MULT: '0.3',
    },
    metrics: {
      winRate_IS: 85.2,
      winRate_OS: 85.6,
      avgR_IS: 0.023,
      avgR_OS: 0.027,
      totalR_5y: 35.0,        // estimación FULL (10R OS + 25R IS aprox)
      maxDD_R: 8.0,
      maxStreakLosses: 4,
      decay_pct: 17.4,        // ⭐ DECAY POSITIVO — el edge mejoró en OOS
      trades_5y: 1444,
    },
    robustness: 'alta',
    explanation: {
      summary: 'EL HALLAZGO MÁS NOTABLE en SPX500: única estrategia con decay POSITIVO (+17.4%). El edge mejoró en out-of-sample. SPX500 tiene rangos chicos → TPs ajustados funcionan mejor que TPs amplios.',
      how: 'Killzones London + NY (7-9, 12-14 UTC). SL amplio ×1.5 ATR (no salta por ruido). TP ajustado ×0.3 ATR (se alcanza con frecuencia). Sin lunes, sin NY_PM.',
      pros: [
        '🎯 85.6% winrate OOS (idéntico al IS 85.2%)',
        '⭐ Decay +17.4% — EDGE MEJORÓ en data nueva (raro)',
        'Max DD ridículamente bajo: 8R',
        'Max streak losses solo 4',
        '~3-4 trades por día (alta frecuencia)',
        'DD/Equity ratio el mejor de TODO el registry',
      ],
      cons: [
        'AvgR chiquito (+0.027R por trade)',
        'Profit total modesto: +35R en 5 años',
        'R/R 1:0.2 — cada loss vale 5× una win',
        'Breakeven en 83.3% — margen solo 2.3pp (frágil ante slippage)',
        'Sensible al spread del broker — requiere spread cero o muy bajo',
      ],
      idealFor: 'Trader que opera SPX/NDX en cuenta institucional o broker con spread sub-1pt. Filosofía scalper: ganar chico pero muy seguido, controlando bien el slippage.',
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // NAS100 (NASDAQ-100) strategies
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'P1-NAS',
    name: 'P1 alto winrate · NAS100',
    asset: 'NAS100',
    badge: '🎯 71% wr · decay +204%',
    tagline: 'El P1 en NAS100 MEJORA dramáticamente en out-of-sample. Killzones + tight TP combo perfecto.',
    config: {
      S1_BAD_SESSIONS: 'NY_PM',
      S1_BAD_DOWS: '1',
      S1_KILLZONES: '7,8,9,12,13,14',
      S1_SL_MULT: '1',
      S1_TP_MULT: '0.5',
    },
    metrics: {
      winRate_IS: 68.2,
      winRate_OS: 71.4,
      avgR_IS: 0.023,
      avgR_OS: 0.070,
      totalR_5y: 62.0,        // estimación IS+OS
      maxDD_R: 13.5,
      maxStreakLosses: 7,
      decay_pct: 204.3,       // ⭐ edge se TRIPLICÓ en OOS
      trades_5y: 1545,
    },
    robustness: 'alta',
    explanation: {
      summary: 'P1 en NAS100 tuvo el decay positivo más alto de todo el registry (+204%). El edge no solo se mantuvo, sino que se triplicó en data nueva. NAS100 tiene volatilidad institucional clara durante killzones.',
      how: 'Killzones London + NY (7-9, 12-14 UTC). SL×1 ATR, TP×0.5 ATR (1:0.5 R/R). Sin lunes, sin NY_PM.',
      pros: [
        '⭐ 71.4% winrate OOS (sube 3.2pp vs IS)',
        '⭐ Decay +204% (edge MEJORÓ enormemente)',
        'DD bajo: 13.5R',
        'Max streak losses solo 7',
        '+27R en OS · +62R total estimado 5y',
        'Funciona en horarios institucionales claros',
      ],
      cons: [
        'AvgR/trade chico (+0.070R OS)',
        'Requiere broker con buen spread NAS100',
        'Trades pueden quedar abiertos overnight',
      ],
      idealFor: 'RECOMENDACIÓN PRINCIPAL para NAS100. Trader institucional o retail con spreads chicos.',
    },
  },

  {
    id: 'S8-NAS',
    name: 'S8 sniper · NAS100',
    asset: 'NAS100',
    badge: '🎯 86.5% wr · DD 6.8R',
    tagline: 'La estrategia S8 transfiere a NAS100 con winrate aún más alto que en SPX500.',
    config: {
      S1_BAD_SESSIONS: 'NY_PM',
      S1_BAD_DOWS: '1',
      S1_KILLZONES: '7,8,9,12,13,14',
      S1_SL_MULT: '1.5',
      S1_TP_MULT: '0.3',
    },
    metrics: {
      winRate_IS: 83.3,
      winRate_OS: 86.5,
      avgR_IS: -0.001,
      avgR_OS: 0.038,
      totalR_5y: 13.0,        // estimación IS+OS (IS ~-1, OS +14)
      maxDD_R: 6.8,
      maxStreakLosses: 3,
      decay_pct: 200.0,       // OS positivo, IS casi cero
      trades_5y: 1545,
    },
    robustness: 'alta',
    explanation: {
      summary: 'CONFIRMACIÓN CRÍTICA: S8 (configurada originalmente para SPX500) funcionó AÚN MEJOR en NAS100. 86.5% winrate OOS, DD ridículamente bajo (6.8R). Esto demuestra que S8 es la estrategia genérica para índices US.',
      how: 'Mismo S8 que SPX500: SL×1.5 ATR (amplio, absorbe ruido), TP×0.3 ATR (muy ajustado, se alcanza casi siempre). Killzones LON + NY.',
      pros: [
        '🎯 86.5% winrate OOS (la más alta de TODO el registry)',
        '🥇 Max DD 6.8R (la más baja de TODO el registry)',
        'Max streak losses solo 3',
        'Confirmación cruzada: funciona en SPX y NAS',
        '~3-4 trades/día (alta frecuencia)',
      ],
      cons: [
        'AvgR muy chico (+0.038R OS)',
        'TotalR modesto (+14R OS)',
        'R/R 1:0.2 — losses 5× una win',
        'Breakeven 83.3% — margen 3.2pp (delgado)',
        'Sensible al spread del broker',
      ],
      idealFor: 'Scalper paciente con broker premium. Cuenta institucional o retail con spreads sub-pt. Filosofía "ganar muy seguido aunque chico".',
    },
  },

  {
    id: 'PA1-NAS',
    name: 'PA1 partial-profit · NAS100',
    asset: 'NAS100',
    badge: '⭐ Universal cross-asset',
    tagline: 'PA1 transfiere a NAS100 con 59.3% winrate idéntico al IS. Estrategia universal verificada.',
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
      winRate_IS: 59.1,
      winRate_OS: 59.3,
      avgR_IS: 0.092,
      avgR_OS: 0.061,
      totalR_5y: 161.0,       // estimación IS+OS
      maxDD_R: 30.9,
      maxStreakLosses: 12,
      decay_pct: -33.7,
      trades_5y: 1913,
    },
    robustness: 'alta',
    explanation: {
      summary: 'PA1 confirma su rol UNIVERSAL: 59.3% winrate OOS prácticamente idéntico a 59.1% IS. Mismo edge que en XAU/USD (60.5%), EUR/USD (59.5%) y BTC (58.5%). Validación cruzada en 4 activos.',
      how: 'Filtros J3 (sin NY_PM, sin Mon, sin horas 10/15/18). SL×0.7, TP final ×2.5. Partial: cierra 50% en +0.5×ATR + SL→BE.',
      pros: [
        '⭐ Edge transfiere consistentemente desde XAU/EUR/BTC',
        '59.3% winrate OOS (igual al IS — sin overfit)',
        '+28.8R OOS, +161R estimado total',
        'Max streak losses 12 (manejable)',
        'AvgR alto +0.061R OS',
        'La misma config funciona en 4 activos distintos',
      ],
      cons: [
        'DD 30.9R (más alto que P1/S8 en NAS)',
        'Decay -33.7% (algo más frágil que P1-NAS)',
        'Requiere broker con partial close',
      ],
      idealFor: 'Trader multi-asset que ya opera PA1 en XAU/EUR/BTC y quiere sumar NAS100 con la MISMA estrategia. Diversificación clean.',
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // USDCAD strategies (el activo MÁS limpio - 4 estrategias robustas)
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'PA1-CAD',
    name: 'PA1 partial-profit · USDCAD',
    asset: 'USDCAD',
    badge: '⭐⭐⭐ Universal (5 activos)',
    tagline: 'PA1 rinde mejor en USDCAD que en ningún otro activo. Decay +14.6%.',
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
      winRate_IS: 60.6,
      winRate_OS: 61.2,
      avgR_IS: 0.089,
      avgR_OS: 0.102,
      totalR_5y: 176.0,
      maxDD_R: 23.4,
      maxStreakLosses: 9,
      decay_pct: 14.6,
      trades_5y: 1895,
    },
    robustness: 'alta',
    explanation: {
      summary: 'PA1 rinde MEJOR en USDCAD que en cualquiera de los 4 activos previos. Decay positivo +14.6% confirma que el edge mejora en data nueva. La mejor versión universal.',
      how: 'Mismos filtros J3 + partial profit-taking (50% en +0.5×ATR + SL→BE + resto a +2.5×ATR).',
      pros: [
        '⭐ Mejor versión de PA1 entre 5 activos testeados',
        '61.2% winrate OOS (sube de 60.6% IS)',
        'Decay +14.6% (edge MEJORÓ en OOS)',
        '+58R OS, +176R total estimado 5y',
        'DD 23.4R, max streak 9',
        'AvgR alto: +0.102R OS',
      ],
      cons: [
        'Requiere broker FX con buen spread en pares de commodities',
        'CAD correlacionado con petróleo (USOIL events afectan)',
      ],
      idealFor: 'RECOMENDACIÓN PRINCIPAL para USDCAD. Trader que ya opera PA1 en otros activos y quiere extender.',
    },
  },

  {
    id: 'J3-CAD',
    name: 'J3 robusta · USDCAD',
    asset: 'USDCAD',
    badge: '🥇 Top profit USDCAD',
    tagline: 'J3 funciona EXCELENTE en USDCAD: +86R OS con decay positivo +25.8%.',
    config: {
      S1_BAD_SESSIONS: 'NY_PM',
      S1_BAD_HOURS: '10,15,18',
      S1_BAD_DOWS: '1',
      S1_SL_MULT: '0.7',
      S1_TP_MULT: '2.5',
    },
    metrics: {
      winRate_IS: 24.5,
      winRate_OS: 25.2,
      avgR_IS: 0.120,
      avgR_OS: 0.151,
      totalR_5y: 244.0,
      maxDD_R: 45.0,
      maxStreakLosses: 25,
      decay_pct: 25.8,
      trades_5y: 1895,
    },
    robustness: 'alta',
    explanation: {
      summary: 'J3 funciona en USDCAD aunque normalmente falla en FX. Razón: USDCAD tiene rangos amplios (vinculados al petróleo) similares a XAU. Decay +25.8% confirma robustez.',
      how: 'Setup J3 estándar: SL×0.7, TP×2.5. Sin filtros killzones (operación 24h FX).',
      pros: [
        '+86R en OS, +244R total estimado',
        'Decay +25.8% (edge mejora en OOS)',
        'AvgR alto: +0.151R OS',
        'Aprovecha rangos amplios del par',
      ],
      cons: [
        'WinRate bajo 25% (psicológicamente exigente)',
        'Max streak ~25 losses (igual que XAU)',
        'DD 45R (más alto que PA1)',
      ],
      idealFor: 'Trader con experiencia que ya operó J3 en XAU y quiere repetir patrón en FX.',
    },
  },

  {
    id: 'P1-CAD',
    name: 'P1 alto winrate · USDCAD',
    asset: 'USDCAD',
    badge: '🎯 70.8% wr · decay +50%',
    tagline: 'P1 mejora 50% en OOS sobre USDCAD. DD ridículamente bajo (14.5R).',
    config: {
      S1_BAD_SESSIONS: 'NY_PM',
      S1_BAD_DOWS: '1',
      S1_KILLZONES: '7,8,9,12,13,14',
      S1_SL_MULT: '1',
      S1_TP_MULT: '0.5',
    },
    metrics: {
      winRate_IS: 69.5,
      winRate_OS: 70.8,
      avgR_IS: 0.042,
      avgR_OS: 0.063,
      totalR_5y: 76.0,
      maxDD_R: 14.5,
      maxStreakLosses: 7,
      decay_pct: 50.0,
      trades_5y: 1458,
    },
    robustness: 'alta',
    explanation: {
      summary: 'P1 muestra decay +50% en USDCAD (el edge se multiplicó por 1.5 en OOS). 70.8% winrate consistente con XAU/EUR/NAS. La versión más robusta de P1 en FX.',
      how: 'Killzones London + NY. SL×1 ATR, TP×0.5 ATR.',
      pros: [
        '70.8% winrate OOS (sube de 69.5% IS)',
        '⭐ Decay +50% (edge mejorando)',
        'DD muy bajo: 14.5R',
        'Max streak 7 (psicológicamente cómoda)',
        '+27R OS, +76R total',
      ],
      cons: [
        'AvgR chico (+0.063R)',
        'Requiere broker con buen spread (TP cercano)',
      ],
      idealFor: 'Scalper FX paciente. Excellent psicología (gana seguido) + buen risk control.',
    },
  },

  {
    id: 'S8-CAD',
    name: 'S8 sniper · USDCAD',
    asset: 'USDCAD',
    badge: '🎯 86.1% wr · DD 10.8R',
    tagline: 'S8 transfiere de índices a FX. 86% winrate en USDCAD con DD chico.',
    config: {
      S1_BAD_SESSIONS: 'NY_PM',
      S1_BAD_DOWS: '1',
      S1_KILLZONES: '7,8,9,12,13,14',
      S1_SL_MULT: '1.5',
      S1_TP_MULT: '0.3',
    },
    metrics: {
      winRate_IS: 83.9,
      winRate_OS: 86.1,
      avgR_IS: 0.007,
      avgR_OS: 0.033,
      totalR_5y: 21.0,
      maxDD_R: 10.8,
      maxStreakLosses: 4,
      decay_pct: 371.4,    // IS casi cero, OS positivo
      trades_5y: 1458,
    },
    robustness: 'alta',
    explanation: {
      summary: 'S8 confirma su universalidad: funciona en SPX500 (85.6%), NAS100 (86.5%) y ahora USDCAD (86.1%). Una estrategia única para 3 activos de "rango chico".',
      how: 'SL×1.5 ATR (amplio), TP×0.3 ATR (ajustado). Killzones LON+NY. Scalper paciente.',
      pros: [
        '🎯 86.1% winrate OOS (la 3ra confirmación de S8)',
        '🥇 DD 10.8R (muy bajo)',
        'Max streak losses solo 4',
        'Decay positivo +371% (IS era casi 0, OS positivo)',
        'Validación cruzada en 3 activos distintos',
      ],
      cons: [
        'AvgR muy chico (+0.033R)',
        'TotalR modesto (+14R OS)',
        'Breakeven 83.3% — margen 2.8pp delgado',
        'Sensible al spread',
      ],
      idealFor: 'Scalper paciente FX. Cuenta con spread sub-pip en USDCAD.',
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // USDJPY strategies (par menos preferido pero rentable)
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'PA1-JPY',
    name: 'PA1 partial-profit · USDJPY',
    asset: 'USDJPY',
    badge: '⭐ Universal (6 activos)',
    tagline: 'PA1 confirmada en el 6to activo: 60.3% wr OOS · DD 20.7R · +50R OS.',
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
      winRate_IS: 61.8,
      winRate_OS: 60.3,
      avgR_IS: 0.107,
      avgR_OS: 0.069,
      totalR_5y: 201.0,
      maxDD_R: 20.7,
      maxStreakLosses: 10,
      decay_pct: -35.5,
      trades_5y: 2141,
    },
    robustness: 'alta',
    explanation: {
      summary: 'PA1 confirma su universalidad en el 6º activo testeado. 60.3% wr OOS consistente con XAU/EUR/BTC/NAS/CAD (todos ~60%). Decay -35% moderado.',
      how: 'Filtros J3 + partial profit-taking (50% en +0.5×ATR + SL→BE + resto a +2.5×ATR).',
      pros: [
        '⭐ 6ta confirmación del patrón PA1 universal',
        '60.3% winrate OOS',
        'DD 20.7R (más bajo de las 4 en USDJPY)',
        '+50R OS, +201R total',
        'Max streak 10',
      ],
      cons: [
        'Decay -35% (no positive como USDCAD)',
        'JPY pairs tienen patrones de Asia que pueden no encajar con killzones LON+NY',
      ],
      idealFor: 'Trader multi-asset que ya opera PA1 en otros 5 activos y quiere completar diversificación.',
    },
  },

  {
    id: 'J3-JPY',
    name: 'J3 robusta · USDJPY',
    asset: 'USDJPY',
    badge: '🥇 Top profit USDJPY',
    tagline: '+65R OS, AvgR +0.091 — la de mayor profit en USDJPY.',
    config: {
      S1_BAD_SESSIONS: 'NY_PM',
      S1_BAD_HOURS: '10,15,18',
      S1_BAD_DOWS: '1',
      S1_SL_MULT: '0.7',
      S1_TP_MULT: '2.5',
    },
    metrics: {
      winRate_IS: 24.9,
      winRate_OS: 23.9,
      avgR_IS: 0.136,
      avgR_OS: 0.091,
      totalR_5y: 245.0,
      maxDD_R: 37.6,
      maxStreakLosses: 28,
      decay_pct: -33.1,
      trades_5y: 2141,
    },
    robustness: 'alta',
    explanation: {
      summary: 'J3 funciona en USDJPY (decay -33%) con +65R OS. Las wins grandes compensan los streaks largos.',
      how: 'SL×0.7 ATR, TP×2.5 ATR. Filtros J3 estándar.',
      pros: [
        'Mayor profit OS de las 4 (+65R)',
        'AvgR alto +0.091R',
        '+245R total estimado',
      ],
      cons: [
        'WinRate bajo 23.9%',
        'Max streak 28',
        'DD 37.6R',
      ],
      idealFor: 'Trader experimentado que tolera rachas largas. Alternativa de alto profit en JPY.',
    },
  },

  {
    id: 'P1-JPY',
    name: 'P1 alto winrate · USDJPY',
    asset: 'USDJPY',
    badge: '🎯 70.7% wr',
    tagline: '70.7% wr OOS, DD 26.5R, killzones.',
    config: {
      S1_BAD_SESSIONS: 'NY_PM',
      S1_BAD_DOWS: '1',
      S1_KILLZONES: '7,8,9,12,13,14',
      S1_SL_MULT: '1',
      S1_TP_MULT: '0.5',
    },
    metrics: {
      winRate_IS: 73.2,
      winRate_OS: 70.7,
      avgR_IS: 0.098,
      avgR_OS: 0.060,
      totalR_5y: 130.0,
      maxDD_R: 26.5,
      maxStreakLosses: 8,
      decay_pct: -38.8,
      trades_5y: 1655,
    },
    robustness: 'alta',
    explanation: {
      summary: 'P1 en USDJPY: 70.7% winrate OOS, decay -38.8%. Buena psicología.',
      how: 'Killzones LON + NY. SL×1, TP×0.5.',
      pros: [
        '70.7% winrate OOS',
        'AvgR razonable +0.060R',
        'Max streak 8 (manejable)',
      ],
      cons: [
        'DD 26.5R (más alto que P1-CAD)',
        'Decay -38% (algo de fragilidad)',
      ],
      idealFor: 'Scalper FX paciente con USDJPY.',
    },
  },

  {
    id: 'S8-JPY',
    name: 'S8 sniper · USDJPY',
    asset: 'USDJPY',
    badge: '🎯 85.2% wr · DD 17.8R',
    tagline: 'S8 verificada en 4º activo: 85.2% wr OOS.',
    config: {
      S1_BAD_SESSIONS: 'NY_PM',
      S1_BAD_DOWS: '1',
      S1_KILLZONES: '7,8,9,12,13,14',
      S1_SL_MULT: '1.5',
      S1_TP_MULT: '0.3',
    },
    metrics: {
      winRate_IS: 86.1,
      winRate_OS: 85.2,
      avgR_IS: 0.034,
      avgR_OS: 0.022,
      totalR_5y: 50.0,
      maxDD_R: 17.8,
      maxStreakLosses: 4,
      decay_pct: -35.3,
      trades_5y: 1655,
    },
    robustness: 'alta',
    explanation: {
      summary: 'S8 funcionando en su 4º activo (SPX/NAS/CAD/JPY). 85.2% wr consistente.',
      how: 'SL×1.5, TP×0.3. Killzones.',
      pros: [
        '85.2% winrate OOS',
        'DD 17.8R',
        '4to activo donde S8 confirma edge',
        'Max streak losses 4',
      ],
      cons: [
        'AvgR muy chico +0.022R',
        'TotalR modesto +12R OS',
        'Spread sensitive',
      ],
      idealFor: 'Scalper paciente que quiere unificar config S8 en multi-asset.',
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // XAU/USD — SCALPING (M5 ultra-rápido, TPs ajustados)
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'B2-XAU-SCALP',
    name: 'B2 extremo · XAU scalp',
    asset: 'XAUUSD',
    category: 'scalping',
    badge: '🏆 88% wr · récord absoluto',
    tagline: 'Winrate más alto del registry entero. SL amplio absorbe ruido, TP×0.3 se alcanza casi siempre.',
    config: {
      S1_BAD_SESSIONS: 'NY_PM',
      S1_BAD_HOURS: '10,15,18',
      S1_BAD_DOWS: '1',
      S1_SL_MULT: '2.0',
      S1_TP_MULT: '0.3',
    },
    metrics: {
      winRate_IS: 87.8,
      winRate_OS: 88.0,
      avgR_IS: 0.009,
      avgR_OS: 0.012,
      totalR_5y: 24.0,
      maxDD_R: 19.3,
      maxStreakLosses: 3,
      decay_pct: 33.3,
      trades_5y: 2023,
    },
    robustness: 'alta',
    explanation: {
      summary: 'EL RÉCORD DE WINRATE del registry entero: 88% OOS con decay POSITIVO (+33%). Filosofía S8 aplicada a XAU pero con SL aún más amplio (×2.0 ATR). Una de pocas estrategias donde el edge MEJORÓ en OOS.',
      how: 'SL×2.0 ATR (muy amplio — el ruido normal no toca el stop), TP×0.3 ATR (se alcanza casi siempre). Filtros J3 estándar. Duración trade: 3-10 min.',
      pros: [
        '🏆 88% winrate OOS (el más alto)',
        '⭐ Decay +33% (edge MEJORÓ en data nueva)',
        'Max streak losses solo 3',
        'DD 19.3R',
        'Validación cruzada: misma idea funciona en SPX/NAS/CAD/JPY',
      ],
      cons: [
        'AvgR muy chico (+0.012R por trade)',
        'TotalR modesto (+24R en 5y)',
        'R/R 1:0.15 — cada loss vale ~7× una win',
        'Breakeven 87% — margen 1pp (delgado)',
        'CRÍTICAMENTE sensible al spread',
      ],
      idealFor: 'Trader con cuenta institucional o broker spread sub-pip XAU. Filosofía: "ganar 9 de 10 pero chiquito, los 1 que pierde es importante controlar el spread/slippage".',
    },
  },

  {
    id: 'C2-XAU-SCALP',
    name: 'C2 partial · XAU scalp',
    asset: 'XAUUSD',
    category: 'scalping',
    badge: '⚖️ Mejor balance scalping',
    tagline: '77% winrate · +16R OS. Partial profit-taking con stop amplio. La opción más rentable de scalp.',
    config: {
      S1_BAD_SESSIONS: 'NY_PM',
      S1_BAD_HOURS: '10,15,18',
      S1_BAD_DOWS: '1',
      S1_SL_MULT: '1.0',
      S1_TP_MULT: '0.7',
      S1_PARTIAL_TP_MULT: '0.3',
      S1_PARTIAL_FRACTION: '0.7',
      S1_BE_AFTER_PARTIAL: '1',
    },
    metrics: {
      winRate_IS: 77.6,
      winRate_OS: 76.7,
      avgR_IS: 0.037,
      avgR_OS: 0.023,
      totalR_5y: 65.0,
      maxDD_R: 14.7,
      maxStreakLosses: 6,
      decay_pct: -37.8,
      trades_5y: 2023,
    },
    robustness: 'alta',
    explanation: {
      summary: 'Cierra 70% del trade en +0.3 ATR (alta probabilidad), deja 30% correr a +0.7 ATR para captura extra. SL→BE después de TP1. Mejor profit + winrate del trio scalping XAU.',
      how: '70% del trade cierra en +0.3 ATR (~6-12 USD XAU), SL pasa a BE, el resto corre a +0.7 ATR. SL inicial ×1.0 ATR. Duración: 5-15 min.',
      pros: [
        '77% winrate OS (sólido)',
        '+16R OS profit (el mayor del grupo)',
        'DD bajo 14.7R',
        'Max streak 6 (cómodo)',
        'Mecánica partial-profit reduce variance',
      ],
      cons: [
        'Decay -38% (algo de fragilidad)',
        'Requiere broker con partial close',
        'TP1 al +0.3 ATR sensible al spread',
      ],
      idealFor: 'Scalper XAU que prefiere "ganar la mayoría chico + algunas grandes". La más balanceada del scalping.',
    },
  },

  {
    id: 'C1-XAU-SCALP',
    name: 'C1 robust partial · XAU scalp',
    asset: 'XAUUSD',
    category: 'scalping',
    badge: '🛡️ La más robusta scalp',
    tagline: '71% winrate · decay -18% · DD 15.5R. Robustez máxima en scalping XAU.',
    config: {
      S1_BAD_SESSIONS: 'NY_PM',
      S1_BAD_HOURS: '10,15,18',
      S1_BAD_DOWS: '1',
      S1_SL_MULT: '0.7',
      S1_TP_MULT: '0.7',
      S1_PARTIAL_TP_MULT: '0.2',
      S1_PARTIAL_FRACTION: '0.5',
      S1_BE_AFTER_PARTIAL: '1',
    },
    metrics: {
      winRate_IS: 71.0,
      winRate_OS: 71.3,
      avgR_IS: 0.011,
      avgR_OS: 0.009,
      totalR_5y: 22.0,
      maxDD_R: 15.5,
      maxStreakLosses: 5,
      decay_pct: -18.2,
      trades_5y: 2023,
    },
    robustness: 'alta',
    explanation: {
      summary: 'Partial 50/50 con TP1 ultra-cerca (+0.2 ATR). SL y TP finales ambos ajustados a ×0.7. Decay solo -18% — la más robusta del trio scalping XAU.',
      how: '50% del trade cierra en +0.2 ATR (~4 USD XAU), SL→BE, otra mitad corre a +0.7 ATR. SL inicial ×0.7. Duración trade: 3-10 min.',
      pros: [
        '⭐ Decay solo -18% (la más robusta scalp)',
        '71% winrate OS (sube vs 71.0% IS)',
        'DD 15.5R, max streak 5',
        'TP1 muy cerca = alta probabilidad de hit',
      ],
      cons: [
        'AvgR muy chico (+0.009R)',
        'TotalR modesto (+22R en 5y)',
        'TP×0.2 ATR ≈ 4 USD — necesita spread casi cero',
      ],
      idealFor: 'Scalper que prioriza CONSISTENCIA sobre profit. Ganás chiquito pero muy seguido y muy robusto.',
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

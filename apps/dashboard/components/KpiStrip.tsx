'use client';

import { carbonColor, carbonLabel, kw, money, percent } from '../lib/format';
import type { Overview } from '../lib/types';

interface KpiStripProps {
  readonly overview: Overview | null;
  readonly avoidedCo2Kg: number | null;
}

export function KpiStrip({ overview, avoidedCo2Kg }: KpiStripProps) {
  if (!overview) {
    return (
      <div className="kpis">
        <div className="kpi">
          <span className="label">waiting for the server</span>
          <span className="value">--</span>
        </div>
      </div>
    );
  }

  const used = overview.gridConnectionKw > 0 ? overview.siteDemandKw / overview.gridConnectionKw : 0;
  const loadClass = used > 0.95 ? 'bad' : used > 0.8 ? 'warn' : '';

  return (
    <div className="kpis">
      <div className="kpi wide">
        <span className="label">site demand</span>
        <span className="value">
          {kw(overview.siteDemandKw)}
          <small>/ {kw(overview.gridConnectionKw, 0)} kW</small>
        </span>
        <span className="sub">
          {kw(overview.chargingKw)} kW charging, {kw(overview.baseLoadKw)} kW building
        </span>
        <span className="meter">
          <i className={loadClass} style={{ width: `${Math.min(100, used * 100)}%` }} />
        </span>
      </div>

      <div className="kpi">
        <span className="label">cars charging</span>
        <span className="value">
          {overview.carsCharging}
          <small>of {overview.carsPluggedIn} plugged in</small>
        </span>
        <span className="sub">
          {overview.carsAtRisk > 0 ? `${overview.carsAtRisk} deadline at risk` : 'every deadline on track'}
        </span>
      </div>

      <div className="kpi">
        <span className="label">grid right now</span>
        <span className="value" style={{ color: carbonColor(overview.carbonGPerKwh) }}>
          {Math.round(overview.carbonGPerKwh)}
          <small>gCO2/kWh</small>
        </span>
        <span className="sub">
          {carbonLabel(overview.carbonGPerKwh)}, {percent(overview.renewableShare)} renewable
        </span>
      </div>

      <div className="kpi">
        <span className="label">import price</span>
        <span className="value">
          {(overview.pricePerKwh * 100).toFixed(1)}
          <small>p/kWh</small>
        </span>
        <span className="sub">plan so far {money(overview.plannedCost, overview.currency)}</span>
      </div>

      <div className="kpi">
        <span className="label">peak today</span>
        <span className="value">
          {kw(overview.peakSoFarKw)}
          <small>kW</small>
        </span>
        <span className="sub">planned peak {kw(overview.plannedPeakKw)} kW</span>
      </div>

      <div className="kpi">
        <span className="label">CO2 avoided today</span>
        <span className="value" style={{ color: 'var(--accent)' }}>
          {avoidedCo2Kg === null ? '--' : avoidedCo2Kg.toFixed(1)}
          <small>kg</small>
        </span>
        <span className="sub">against charging on plug-in</span>
      </div>
    </div>
  );
}

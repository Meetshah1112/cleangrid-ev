'use client';

import { useMemo, useState } from 'react';
import { carbonCut, cutPhrase, deadlineOutcome, totalsOf } from '../../lib/impactRead';
import { clockTime, dayLabel, kw, modeLabel, money, percent } from '../../lib/format';
import type { Session, SessionReport } from '../../lib/types';

/**
 * The evidence, session by session.
 *
 * Filters narrow the ledger and the totals beneath it together, and the totals always say how many
 * of their sessions were meter-verified and how many estimated, so the two are never quietly added
 * into one number. Opening a row lays out how its figures were reached, step by step.
 */

type Verified = 'all' | 'verified' | 'estimated';

export interface LedgerEntry {
  readonly session: Session;
  readonly report: SessionReport;
}

export function Ledger({ entries, timezone, currency }: { readonly entries: readonly LedgerEntry[]; readonly timezone: string; readonly currency: string }) {
  const [charger, setCharger] = useState('all');
  const [driver, setDriver] = useState('all');
  const [verified, setVerified] = useState<Verified>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(12);

  const chargers = useMemo(() => [...new Set(entries.map((entry) => entry.session.chargerId))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [entries]);
  const drivers = useMemo(() => [...new Set(entries.map((entry) => entry.session.driverName ?? entry.session.idTag))].sort(), [entries]);

  const filtered = entries.filter(
    (entry) =>
      (charger === 'all' || entry.session.chargerId === charger) &&
      (driver === 'all' || (entry.session.driverName ?? entry.session.idTag) === driver) &&
      (verified === 'all' || (verified === 'verified') === entry.report.verified),
  );
  const totals = totalsOf(filtered.map((entry) => entry.report));
  const cut = carbonCut(totals.co2Kg, totals.baselineCo2Kg);

  return (
    <div className="ledger">
      <div className="ledger-filters" role="group" aria-label="Filter the audit trail">
        <label>
          <span className="caption">Charger</span>
          <select className="select" value={charger} onChange={(event) => setCharger(event.target.value)}>
            <option value="all">All chargers</option>
            {chargers.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="caption">Driver</span>
          <select className="select" value={driver} onChange={(event) => setDriver(event.target.value)}>
            <option value="all">All drivers</option>
            {drivers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <div className="segmented" role="group" aria-label="Evidence">
          {(['all', 'verified', 'estimated'] as const).map((value) => (
            <button key={value} type="button" aria-pressed={verified === value} onClick={() => setVerified(value)}>
              {value === 'all' ? 'All' : value === 'verified' ? 'Meter-verified' : 'Estimated'}
            </button>
          ))}
        </div>
      </div>

      <p className="ledger-totals" aria-live="polite">
        <span>
          <strong>{totals.sessions}</strong> session{totals.sessions === 1 ? '' : 's'}: {totals.verified} meter-verified, {totals.sessions - totals.verified} estimated
        </span>
        <span>
          <strong>{totals.energyKwh.toFixed(1)} kWh</strong> delivered
        </span>
        <span>
          <strong>{Math.abs(totals.avoidedCo2Kg).toFixed(1)} kg CO₂</strong> {totals.avoidedCo2Kg >= 0 ? 'avoided' : 'above the baseline'}, {cutPhrase(cut)}
        </span>
        <span>
          <strong>{money(Math.abs(totals.costSaved), currency)}</strong> {totals.costSaved >= 0 ? 'saved' : 'more than the baseline'}
        </span>
      </p>

      {filtered.length === 0 ? (
        <p className="empty">No finished session matches these filters.</p>
      ) : (
        <ol className="ledger-rows">
          {filtered.slice(0, shown).map(({ session, report }) => {
            const expanded = open === session.id;
            const outcome = deadlineOutcome(session);
            return (
              <li key={session.id} className={`ledger-row${expanded ? ' is-open' : ''}`}>
                <button type="button" className="ledger-line" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : session.id)}>
                  <span className="ledger-who">
                    <strong>{session.driverName ?? session.idTag}</strong>
                    <span>{session.chargerId}</span>
                  </span>
                  <span className="num">{kw(report.energyKwh)} kWh</span>
                  <span className="num">{session.unpluggedMs ? clockTime(session.unpluggedMs, timezone) : '--'}</span>
                  <span>{session.unpluggedMs ? dayLabel(session.unpluggedMs, timezone) : '--'}</span>
                  <span className={`ledger-evidence${report.verified ? ' is-verified' : ''}`}>{report.verified ? '✓ Meter-verified' : '≈ Estimated'}</span>
                  <span className={`ledger-outcome is-${outcome}`}>{OUTCOME_LABEL[outcome]}</span>
                </button>
                {expanded ? <ProofChain session={session} report={report} timezone={timezone} currency={currency} /> : null}
              </li>
            );
          })}
        </ol>
      )}
      {filtered.length > shown ? (
        <button type="button" className="btn is-small ledger-more" onClick={() => setShown((count) => count + 24)}>
          Show {Math.min(24, filtered.length - shown)} more
        </button>
      ) : null}
    </div>
  );
}

const OUTCOME_LABEL: Record<ReturnType<typeof deadlineOutcome>, string> = {
  kept: 'Deadline kept',
  missed: 'Deadline missed',
  'left-early': 'Left before its deadline',
  ended: 'Ended early',
};

/** How one session's figures were reached, in the order they were worked out. */
function ProofChain({ session, report, timezone, currency }: { readonly session: Session; readonly report: SessionReport; readonly timezone: string; readonly currency: string }) {
  const baselineFinishMs = session.pluggedInMs + (report.energyKwh / Math.max(0.1, session.maxPowerKw)) * 3_600_000;
  const steps: { title: string; body: string }[] = [
    {
      title: 'Charge point',
      body: `${session.chargerId}, connector ${session.connectorId}. Plugged in ${clockTime(session.pluggedInMs, timezone)}, left ${session.unpluggedMs ? clockTime(session.unpluggedMs, timezone) : 'not recorded'}, on ${modeLabel[session.mode]?.toLowerCase() ?? session.mode}.`,
    },
    {
      title: 'Meter readings',
      body: report.verified
        ? `${report.energyKwh.toFixed(2)} kWh between the charger's own register readings, which covered the whole session.`
        : `${report.energyKwh.toFixed(2)} kWh, estimated from the plan because the meter readings did not cover the whole session.`,
    },
    {
      title: 'Grid signal',
      body: `Weighted by ${report.carbonBasis === 'actual' ? 'settled' : 'forecast'} carbon intensity at the time each kilowatt-hour flowed: ${Math.round(report.avgCarbonGPerKwh)} gCO₂/kWh on average, from ${Math.round(report.windowMinCarbonGPerKwh)} to ${Math.round(report.windowMaxCarbonGPerKwh)} across the parked window. ${percent(report.renewableShare)} renewable.`,
    },
    {
      title: 'Baseline',
      body: `The same ${report.energyKwh.toFixed(1)} kWh at full ${kw(session.maxPowerKw)} kW from plug-in, finishing by ${clockTime(baselineFinishMs, timezone)}: ${report.baselineCo2Kg.toFixed(2)} kg CO₂ and ${money(report.baselineCost, currency)}.`,
    },
    {
      title: 'Final calculation',
      body: `${report.baselineCo2Kg.toFixed(2)} kg less ${report.co2Kg.toFixed(2)} kg is ${report.avoidedCo2Kg.toFixed(2)} kg CO₂ avoided. ${money(report.baselineCost, currency)} less ${money(report.cost, currency)} is ${money(report.costSaved, currency)} saved. Green Score ${report.greenScore}.`,
    },
  ];
  return (
    <ol className="chain" aria-label={`How the figures for ${session.driverName ?? session.idTag} were worked out`}>
      {steps.map((step) => (
        <li key={step.title}>
          <strong>{step.title}</strong>
          <span>{step.body}</span>
        </li>
      ))}
    </ol>
  );
}

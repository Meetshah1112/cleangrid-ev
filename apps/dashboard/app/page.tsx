'use client';

import { useEffect, useState } from 'react';
import { ChargerGrid } from '../components/ChargerGrid';
import { KpiStrip } from '../components/KpiStrip';
import { PlanChart } from '../components/PlanChart';
import { Rail } from '../components/Rail';
import { SessionTable } from '../components/SessionTable';
import { TopBar } from '../components/TopBar';
import { api } from '../lib/api';
import { clockTime } from '../lib/format';
import { useLiveSite } from '../lib/useLiveSite';

export default function OperationsPage() {
  const site = useLiveSite();
  const [avoidedCo2Kg, setAvoidedCo2Kg] = useState<number | null>(null);

  useEffect(() => {
    const load = (): void => {
      void api
        .impact()
        .then((impact) => setAvoidedCo2Kg(impact.avoidedCo2Kg))
        .catch(() => setAvoidedCo2Kg(null));
    };
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <main className="shell">
      <TopBar nowMs={site.nowMs} timeScale={site.timeScale} connected={site.connected} page="operations" />
      {site.error && <div className="error-banner">Cannot reach the server: {site.error}</div>}

      <KpiStrip overview={site.overview} avoidedCo2Kg={avoidedCo2Kg} />

      <div className="grid-main">
        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h2>Plan for the next 24 hours</h2>
              <span className="panel-note">
                {site.plan ? `solved ${clockTime(site.plan.solvedMs)} · ${site.plan.trigger}` : 'no plan yet'}
              </span>
            </div>
            <div className="chart-wrap">
              <PlanChart plan={site.plan} nowMs={site.nowMs} />
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Bays</h2>
              <span className="panel-note">
                {site.overview ? `${site.overview.chargersOnline}/${site.overview.chargersTotal} online` : ''}
              </span>
            </div>
            <ChargerGrid chargers={site.chargers} sessions={site.sessions} nowMs={site.nowMs} />
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Sessions</h2>
              <span className="panel-note">deadline order</span>
            </div>
            <SessionTable sessions={site.sessions} nowMs={site.nowMs} />
          </section>
        </div>

        <Rail
          plan={site.plan}
          forecast={site.forecast}
          flexEvents={site.flexEvents}
          dispatches={site.dispatches}
          onChanged={site.refresh}
        />
      </div>
    </main>
  );
}

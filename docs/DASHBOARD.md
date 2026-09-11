# Operator dashboard

Next.js, at `http://localhost:3000`, reading the same API as everything else. Two pages:
operations and impact.

**Visual direction.** A dark control room, because that is what energy operations screens are and
because the demo runs on a projector. Tabular numerals everywhere a number can change, so digits
do not jump. One semantic carbon scale, green through amber to red, reused by the chart, the
ribbon under it, the KPI tiles and the table. Colour is never decorative: if something is green it
is clean, if it is red it is either dirty or a limit.

## Operations

| Region | Content | Updates |
|---|---|---|
| Top bar | site name, simulated clock with its speed, live/polling indicator | on every clock tick |
| KPI strip | site demand against the grid connection with a fill bar, cars charging of cars plugged in, carbon intensity now, import price now, peak so far against planned peak, CO2 avoided today | WebSocket, 5 s poll fallback |
| Plan chart | 24 hours: total site draw and building load as stacked areas, the grid connection and any flex cap as a dashed line, a carbon ribbon underneath, a now marker | on `plan.solved` |
| Bays | one tile per charger: driver, current power against dispatched limit, progress towards the need, countdown to the deadline, a coloured edge for charging, waiting, at risk or offline | on `charger.updated`, `meter.updated` |
| Sessions | dense table in deadline order: driver, bay, mode, now, limit, delivered against needed, progress, deadline, time left or an at-risk flag | on `session.updated` |
| Right rail | the current plan (solver, status, solve time, trigger, planned peak, shortfalls) with a re-plan button; grid flexibility requests with accept and decline; forecast sources and the cleanest window; a live dispatch log | WebSocket |

## Impact

Four large figures: CO2 avoided, money saved, average Green Score, peak site draw. Then a direct
comparison of smart against dumb charging for both CO2 and cost, with the method stated on the
page: energy from meter readings, emissions from the intensity at the moment each kWh was drawn,
counterfactual at full power from plug-in.

## Live data

The page loads a snapshot over REST, then follows `/ws/sites/:siteId`. If the socket drops it
reconnects and keeps polling every five seconds, and the indicator in the top bar says "polling"
rather than pretending to be live. Between server ticks the clock advances locally at the server's
own speed so the display never freezes.

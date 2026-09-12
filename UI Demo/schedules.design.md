# CleanGrid — Schedules page design

## Purpose

Show exactly how CleanGrid turns renewable forecasts, price, site capacity and each driver’s deadline into one safe charging plan—without reverting to a boxed Gantt-dashboard look.

## Shared website shell

Use the locked CleanGrid header and Forecast visual language. `Schedules` is active. The page uses a single day-journey landscape, large editorial copy and a light, integrated timeline—not dark technical panels or nested cards.

## Hero — “Let every parked hour do more.”

### Scenic backdrop

Use a continuous valley from dawn to night.

- Sun and solar arrays occupy the late-morning portion.
- A low, sweeping road or shoreline traces the whole 24-hour planning horizon.
- Distant turbines gain visual prominence toward overnight.
- A quiet charging site appears in the foreground, but no full bay-grid is repeated here.

### Copy

- Eyebrow: `OPTIMISED DAY PLAN · 15-MINUTE BLOCKS`
- Headline: `Let every parked hour do more.`
- Supporting copy: `CleanGrid moves flexible energy into cleaner, cheaper hours while preserving every committed departure.`
- Reassurance: `0 / 0 deadlines safe` and `LP · auto-replanning`.
- Action: `Re-plan now`.

## Charge plan river

Replace the old rectangular timeline rows with delicate horizontal energy ribbons that follow the scene’s time horizon.

- Each active session is a fine coloured ribbon, occupying only the periods where power is planned.
- Colour semantics come from the source legend: `greenest`, `cheapest`, `fastest`, `balanced`.
- Darker ribbon intensity means more power.
- Preserve actual session identifiers from the source (`c42584`, `deaa97`) when those are the current demo sessions; otherwise use human driver names plus the charger ID.
- A thin vertical `now` marker sits at `04:45`.
- Time scale: `04:45`, `08:45`, `12:45`, `16:45`, `20:45`, `00:45`, `04:45`.
- A tappable/hoverable ribbon shows energy required, energy already delivered, deadline, selected preference and planned charging blocks.

## Site draw after optimisation

Blend the original bar chart into the lower landscape instead of isolating it in a panel.

- Title: `Site draw after optimisation`
- Main data: green 15-minute bars for planned site draw.
- Connection cap: thin coral dashed horizon line.
- Direct labels: `65 kW connection`, `planned peak 68.7 kW`, `2 cars scheduled`, `solved 04:54`.
- Time scale: `04:45`, `10:45`, `16:45`, `22:45`, `04:45`.
- Keep source legend: `planned site draw`, `planning limit, held below the connection`.

If the original data indicates a cap exception, show it directly and honestly; do not smooth it away visually.

## Driver commitments

Use an airy editorial list over a white curved section, not a standard table.

- Heading: `Every promise, still protected.`
- Supporting copy from the original screen: `Change a mode, or give a driver more time, and the plan re-solves.`
- Each live session has a compact row: driver and bay; energy needed/delivered; clear deadline; selected mode; current plan state; deadline-risk label only when needed.
- Preserve original empty state when there are no sessions: `Nothing plugged in right now.`

## Dispatch trace

Keep the source screen’s dispatch log, but make it a lower-page “machine truth” footer detail rather than a dominant dark console.

- Heading: `What actually reached the chargers`
- Stream rows retain time, charge point, limit and response status:
  - `04:54 CP-00 0.0 kW accepted`
  - `04:54 CP-03 0.0 kW accepted`
  - `04:54 CP-02 0.0 kW accepted`
  - `04:54 CP-01 0.0 kW accepted`
- Use muted mono-like numerals only within the trace; the rest of the page stays editorial.
- Add a short plain-language note: `CleanGrid only sends changes that materially improve the next charging window.`

## Interaction and live behaviour

- `Re-plan now` triggers a plan solve and briefly shows the new solve time, solver (`LP` or safe greedy fallback), peak, carbon and cost effect.
- Selecting a schedule ribbon reveals the car’s parked window and explains why it is charging now, waiting, or prioritised.
- A change to deadline, energy need or mode re-runs the plan and animates only the affected energy ribbons.
- The `now` marker moves with the shared demo clock. Completed charging blocks desaturate; the immediate binding dispatch block remains visually strongest.
- Re-plan updates should morph the relevant ribbons and site-draw bars from the old allocation to the new allocation over a brief, interruptible transition. Do not animate every row on every refresh.
- A user can change an individual mode (`greenest`, `cheapest`, `fastest`, `balanced`) or deadline from the selected-session detail. Before confirming, show the predicted cost/CO₂/deadline change; after confirmation, run the normal re-solve.
- Dispatch-log rows append when a `dispatch.sent` event arrives. Clicking a row reveals the OCPP profile periods, charger response and retry state.
- A deadline at risk becomes an explicit, actionable warning with the earliest achievable finish time. It must never be disguised by the aesthetic visual treatment.

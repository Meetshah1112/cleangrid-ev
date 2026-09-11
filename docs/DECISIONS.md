# Decisions

Every open question from the brief, the options, the trade-off, and what was built. Where the
build changed a decision, the change is recorded at the bottom rather than edited away.

## 1. Planning window

| Option | Trade-off |
|---|---|
| 12 hours | Cannot plan an overnight session, which is where most of the saving is |
| 24 hours rolling | Sees the whole daily curve: evening peak, overnight wind, midday solar |
| Until the latest deadline | Window length jumps around; forecast quality falls off a cliff past a day |

**Built: 24 hours rolling**, starting at the current slot boundary. Deadlines beyond the horizon
are clipped to the horizon end; each re-solve extends it. `HORIZON_HOURS` is configurable.

## 2. Slot granularity

| Option | Trade-off |
|---|---|
| 5 min | 288 slots per car per day; tight deadline handling, a much larger model |
| 15 min | 96 slots; matches how demand charges are metered |
| 30/60 min | Small model, but a deadline can be missed by up to half an hour |

**Built: 15 minutes, 96 slots.** Twenty cars is about 1,900 variables and HiGHS solves it in
single-digit milliseconds. Slot 0 is partial: only the time left in it counts. A session's
available hours in a slot are the overlap of its plugged-in window with that slot, so arrival and
deadline slots are credited exactly rather than rounded away.

## 3. Re-solve frequency

| Option | Trade-off |
|---|---|
| Every slot | Misses a car that plugs in thirty seconds after a solve |
| Event driven only | Blind to forecast drift and meter drift |
| Hybrid | Slightly more solving for a plan that is never far out of date |

**Built: hybrid.** Every plug-in, unplug, deadline change, charger connect/disconnect and flex
response triggers a solve, debounced so a burst collapses into one. A periodic solve runs every
five simulated minutes. The debounce is capped at one simulated minute, so a demo at 240x does not
leave a new car uncontrolled for four simulated hours.

## 4. Solver

| Option | Trade-off |
|---|---|
| `javascript-lp-solver` | Pure JS, slow and fragile at two thousand variables |
| `glpk.js` | WebAssembly GLPK, fine, older codebase |
| `highs` | WebAssembly HiGHS, actively developed, simple LP-text API |

**Built: HiGHS**, behind a `Scheduler` interface, wrapped in `ResilientScheduler` so any solver
failure falls back to the greedy plan and records why. Swapping to glpk.js means changing one file.

## 5. Impossible deadlines

**Built: both defences.** At intake, `checkDeadline` refuses a request that cannot physically be
met and returns the earliest deadline that can, so the driver app can offer it. Inside the LP,
each session also has a slack variable with a large penalty, so a site that becomes
over-subscribed still returns a usable plan with named shortfalls instead of an infeasible model.

## 6. Objective units

Mixing pounds, kilograms and kilowatts needs a conversion nobody can defend. **Built: normalised.**
Price and carbon are divided by their window mean absolute value, earliness is slot index over
horizon, and the peak term is scaled by total energy over the grid connection. Weights are then
dimensionless and the four modes are just weight presets.

## 7. Whose weights

Cost and carbon are the driver's concern; the demand charge is the site's. **Built: per-session
weights for cost, carbon and speed; the site's default mode supplies the peak weight.**

## 8. Minimum charger power

A charger cannot hold 400 W. Modelling that exactly makes it a mixed-integer problem.
**Built: continuous LP, and the dispatcher rounds any limit below the charger's minimum down to
zero.** The next re-solve sees the energy that was not delivered and makes it up.

## 9. OCPP framing

**Built: own framing on `ws`.** About 200 lines for CALL/CALLRESULT/CALLERROR with strict
validation, one outgoing call in flight per connection as the spec requires, and per-call
timeouts. `ocpp-rpc` remains a drop-in alternative.

## 10. Grid data

**Built: UK Carbon Intensity, Octopus Agile and Open-Meteo, all keyless**, behind a provider
interface, with a deterministic synthetic profile for offline work, tests and as the final
fallback. A key-based source such as Electricity Maps can be added as another provider.

## 11. Demo time

**Built: one `Clock` abstraction.** `SIM_START` and `SIM_TIME_SCALE` create a simulated clock;
the simulator syncs to the server's `/clock` so both agree on "now" and resyncs periodically. A
whole day plays out in minutes without changing any application logic.

## 12. Persistence

**Built: repository interfaces with an in-memory implementation**, plus the full Postgres schema
and row-level security in `supabase/migrations`. Nothing above the repository layer knows which
is in use.

## 13. Live dashboard updates

**Built: own WebSocket channel** at `/ws/sites/:id` carrying typed site events, with REST polling
as a fallback. Supabase realtime can replace the transport later; the event names already match.

---

## Changed during the build

**A car charges at full power until its first profile arrives.** The first run peaked at 78 kW on
a 65 kW connection because seven cars plugged in during the morning before the optimiser had
dispatched anything. Two fixes: the re-solve debounce is capped in simulated time, and every
charger is given a `TxDefaultProfile` at stack level 0 on connect, sized so that all bays at that
limit plus the worst hour of building load still fit inside the connection. The optimiser's own
profiles sit above it. A site now stays inside its connection even if the optimiser is late or
absent.

**Impact reports needed history, not the forecast.** Reports first scored a finished session
against the current forward-looking forecast, which clamps everything before "now" to one value
and made avoided CO2 come out at zero. Reports now read the stored grid signals for the session's
own window, falling back to the provider for gaps.

**The dashboard is dark, not light.** The plan said a light control room. Energy operations
screens are near-universally dark and the demo runs on a projector, so it was built dark with one
semantic carbon scale reused by the chart, the ribbon, the tiles and the table.

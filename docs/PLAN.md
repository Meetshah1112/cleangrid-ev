# CleanGrid EV — build plan

## Context

Hackathon project (theme: Renewable Energy Intelligence). EV chargers draw full power at plug-in regardless of grid carbon intensity or price. CleanGrid EV is a scheduler between grid signals, OCPP chargers and drivers: it shifts charging into clean, cheap slots inside each driver's parked window, never misses a deadline, keeps the site under its grid connection, flattens the peak, and reports verified avoided CO2 from meter data.

Team: user + me, 12–15 hours, this session. Location: `C:\dev\cleangrid-ev` (new, git init). Database: in-memory store behind a repository interface now; Supabase SQL migrations + RLS written and ready. Scope this session: engine (greedy + LP), OCPP gateway + simulator, forecast service, emissions calc, dispatcher, optimiser loop, Fastify REST/WS API, seed scenario, tests, docs, Next.js operator dashboard skeleton. Driver app: full screen design now, Expo scaffold as the final stretch phase.



---

## 1. Open decisions (options → tradeoff → recommendation)

| Decision | Options | Tradeoff | Recommendation |
|---|---|---|---|
| Planning window | 12h / 24h / until latest deadline | Longer sees the whole diurnal curve (evening peak vs overnight wind vs midday solar) but forecasts degrade and the LP grows; shorter can't plan overnight sessions | **24h rolling**, start = now floored to slot boundary. Deadlines past the horizon are clipped to horizon end (re-solves keep extending it) |
| Slot granularity | 5 / 15 / 30 / 60 min | Finer = tighter deadline handling but N×S variables; carbon APIs are 30-min, demand charges are metered on 15-min intervals | **15 min, 96 slots**. 20 sessions → ~1,900 LP variables, solves in tens of ms. Slot 0 is partial (usable hours = time left in the current slot); arrival rounds up, deadline rounds down (both conservative) |
| Re-solve frequency | every slot / every N min / event-driven / hybrid | Events (plug-in, unplug, flex request, forecast refresh) need an immediate answer; periodic catches meter drift and forecast changes; too frequent churns charger profiles | **Hybrid**: event-driven with 2s debounce + periodic every 5 min. Dispatch only setpoints that changed by >250 W (hysteresis) |
| Solver | `highs` (WASM HiGHS) / `glpk.js` / `javascript-lp-solver` (pure JS) | Pure JS simplex is slow and fragile at 2k vars; both WASM options are fast; HiGHS is the more modern solver with a simple LP-text API | **`highs`** behind a `Scheduler` interface; **greedy fallback** on load failure, solve error, or >2s timeout. One-file swap to glpk.js if needed |
| Infeasible deadlines | throw / reject at intake / soft constraint | A raw LP would be infeasible and return nothing; drivers must be told up front | **Both**: intake feasibility check (energy ÷ maxPower vs time to deadline → 422 with earliest reachable deadline) AND a per-session slack variable with a large penalty so the LP always returns a plan and flags `shortfalls` |
| Objective units | raw currency+kg+kW / normalised | Raw mixing makes weights meaningless across sites | **Normalised**: price and carbon divided by their window means; peak term scaled by total energy; weights are dimensionless and modes are just weight presets |
| Mode scope | site-wide / per-session | Drivers choose modes, but peak charge is a site cost | **Per-session weights for cost/CO2/speed; site-level weight for peak** (operator's default mode) |
| Minimum charger power (6A ≈ 1.4 kW) | MIP semi-continuous / ignore / round in dispatcher | MIP is slower and riskier | **Continuous LP; dispatcher rounds limits below `minPowerKw` to 0** and logs it |
| OCPP framing | `ocpp-rpc` library / `ws` + own ~100-line CALL/CALLRESULT/CALLERROR layer | Library has validation but adds a dependency we don't control; framing is trivial | **`ws` + own framing** in `packages/ocpp`, typed 1.6J payloads. `ocpp-rpc` noted as the drop-in alternative |
| Grid/price data | Electricity Maps (key) / WattTime (key) / UK CI API + Octopus Agile (keyless) | Keys cost time and rate-limit during a demo | **UK Carbon Intensity + Octopus Agile + Open-Meteo**, all keyless, plus a **synthetic profile** (≈200 midday / ≈700 evening gCO2/kWh, ToU prices) for offline and deterministic tests. Site modelled in GB, currency GBP |
| Demo time | real time / accelerated shared clock | A day must play in minutes | **`Clock` abstraction with `SIM_START` + `SIM_TIME_SCALE`** shared by server and simulator (scale 60 → a day in 24 real minutes). Live forecasts are fetched for real now and aligned by time-of-day onto the simulated grid |
| Persistence now | Supabase / in-memory | User has no project yet | **Repository interface + in-memory implementation**; Supabase migrations + RLS shipped; `SupabaseRepository` stub with the client wiring, filled in when keys exist |
| Dashboard live data | Supabase realtime / own WS | No Supabase yet | **Own WS channel `/ws/sites/:id`** + 2s polling fallback; Supabase realtime is a later swap on the same event names |

Prior art used as reference (well known, not fetched this session): Caltech ACN-Sim/adacharge for the LP formulation shape, SteVe for OCPP 1.6 CSMS behaviour, highs-js README for the solver API.

---

## 2. Repository layout (`C:\dev\cleangrid-ev`)

```
package.json                 npm workspaces: packages/*, apps/*   scripts: build, test, dev:server, dev:sim, demo, dev:dashboard
tsconfig.base.json           ESM, strict, NodeNext; typescript@5 pinned (TS 7 native port avoided for tooling safety)
packages/shared/             domain types, units (kW/kWh/W/Wh helpers), SlotGrid, Clock, zod schemas, ModeWeights presets
packages/engine/             pure, no IO: greedy.ts, lp.ts (HiGHS), scheduler.ts (interface + validate + fallback), objective.ts, feasibility.ts, emissions.ts, forecastBlend.ts
packages/ocpp/               OCPP 1.6J message types, RPC framing (CALL/CALLRESULT/CALLERROR), pending-call tracker
apps/server/                 Fastify: api/ (routes, auth, envelope), ws/ (dashboard channel), ocpp/ (gateway, registry), optimiser/ (loop, dispatcher), forecast/ (sources, cache, service), repo/ (interfaces, memory, supabase stub), seed/ (scenario loader), index.ts
apps/simulator/              charger simulator CLI (scenario-driven, vehicle model, profile obedience)
apps/dashboard/              Next.js 16 App Router operator dashboard (skeleton)
apps/driver/                 Expo app (stretch phase; SCREENS.md written regardless)
supabase/migrations/0001_schema.sql, 0002_rls.sql, seed.sql
scenarios/day-one.json       one site, 8 chargers, ~14 arrivals with deadlines
docs/DECISIONS.md, TASKS.md, RISKS.md, SCHEMA.md, API.md, SCREENS.md, DASHBOARD.md, REVIEW.md
```

Runtime: one `apps/server` process holds REST/WS + OCPP gateway (same port, upgrade-routed by path) + optimiser loop. Simulator is a separate process standing in for hardware. Dashboard is a separate Next dev server.

Pinned: fastify 5, @fastify/websocket 11, @fastify/cors 11, ws 8, highs 1.15, zod 4, pino 10, jose 6, vitest 5, tsx 4, next 16, react 19, recharts 3, commander 15.

---

## 3. Build order (dependency-ordered; ★ = end-to-end milestone)

| # | Task | Blocks | Est. |
|---|---|---|---|
| T1 | Scaffold monorepo, tsconfig, vitest, lint-free build, git init | everything | 0.5h |
| T2 | `shared`: types, units, SlotGrid (slotOf/timeOf/snap), Clock, mode presets, zod schemas | T3–T13 | 0.5h |
| T3 | `engine`: validate + feasibility + **greedy** scheduler + tests | T7, T8 | 1.0h |
| T4 | `ocpp`: framing + types + tests | T5, T6 | 0.5h |
| T5 | Gateway: WS server, Boot/Heartbeat/Status/Authorize/Start/Stop/MeterValues, outbound calls with timeouts, registry, event bus | T6, T7, T8 | 1.0h |
| T6 | Simulator: scenario runner, vehicle model, meter values, SetChargingProfile obedience, time scale | ★ | 1.0h |
| T7 | Dispatcher: plan → SetChargingProfile diffs, hysteresis, min-power rounding, dispatch log | T8 | 0.5h |
| T8 | Optimiser loop + in-memory repos + synthetic forecast + seed loader + `npm run demo` ★ **milestone 1: a simulated day runs in the terminal** | T9–T13 | 1.0h |
| T9 | `engine`: **LP** scheduler (HiGHS), fallback wiring, timeout, tests incl. clean-failure cases | – | 1.0h |
| T10 | Forecast service: UK CI, Octopus, Open-Meteo sources, cache/TTL, weather+history blend, resampling, snapshot persistence, tests with mocked fetch | – | 1.25h |
| T11 | Emissions: series integration, baseline simulation, session report, Green Score, tests | T12 | 0.75h |
| T12 | Fastify API: envelope, dev-auth + Supabase JWT (jose), all endpoints in §5, WS channel, flex events; Supabase migrations + RLS files | T13 | 1.5h |
| T13 | Dashboard skeleton: overview page with live KPIs, plan chart, charger grid, sessions table, flex panel; reports page ★ **milestone 2: dashboard shows the live simulated day** | – | 1.5h |
| T14 | Seed realism pass, full test run, coverage, `docs/REVIEW.md` drift review, remaining docs | – | 0.75h |
| T15 | Stretch: Expo driver app scaffold (setup → live session → summary) against the API | – | 1.5h |

Total ≈ 12.5h core + 1.5h stretch.

### Work split (user + me)

I do all code and docs sequentially in the order above. User, in parallel and unblocked:
- After T1: create a Supabase project (keep URL, anon key, service key for later), install Expo Go on a phone.
- After T8: run `npm run demo`, watch the terminal, sanity-check the plan output; provide site lat/lng and preferred site name.
- After T10: confirm the live data looks right for the chosen region.
- After T13: drive the dashboard while the demo plays; write the pitch/demo script from what it shows.
- Any time: review `docs/DECISIONS.md` and push back on choices.

---

## 4. Database schema (Supabase / Postgres) — written to `supabase/migrations`, summarised in `docs/SCHEMA.md`

| Table | Key columns | Notes |
|---|---|---|
| `sites` | id uuid pk, name, timezone, lat, lng, region_code, grid_connection_kw numeric, demand_charge_per_kw numeric, currency, default_mode enum, base_load_kw numeric[] (96), created_at | one row per site |
| `chargers` | id uuid pk, site_id fk, ocpp_identity text unique, vendor, model, max_power_kw, min_power_kw, num_connectors int, status enum(offline/available/occupied/faulted), last_seen_at | `ocpp_identity` is the WS path id |
| `connectors` | charger_id fk, connector_id int, status text, current_session_id fk null; pk(charger_id, connector_id) | |
| `profiles` | id uuid pk = auth.users.id, role enum(driver/operator/grid_operator), display_name, site_id fk null, id_tag text unique null | id_tag links RFID/idTag to a driver |
| `vehicles` | id uuid pk, driver_id fk, label, battery_kwh, max_charge_kw | |
| `sessions` | id uuid pk, site_id, charger_id, connector_id, driver_id null, vehicle_id null, ocpp_transaction_id int, id_tag, plugged_in_at, deadline_at, unplugged_at null, energy_needed_kwh, energy_delivered_kwh, mode enum, status enum(pending/active/complete/aborted), deadline_risk bool, created_at | remaining need = needed − delivered |
| `meter_readings` | id bigserial, session_id fk, recorded_at, energy_wh bigint, power_w int, soc numeric null | raw register values |
| `grid_signals` | site_id, kind enum(carbon/price/renewable/actual_carbon), slot_start timestamptz, value numeric, source text, fetched_at; pk(site_id, kind, slot_start) | forecasts upserted; actuals kept separately |
| `plans` | id uuid pk, site_id, solved_at, horizon_start, slot_minutes, solver enum(lp/greedy), status enum(optimal/feasible/infeasible/error), objective jsonb, peak_kw, solve_ms | |
| `plan_schedules` | plan_id fk, session_id fk, power_kw numeric[] (96); pk(plan_id, session_id) | array form keeps rows small |
| `dispatch_log` | id bigserial, plan_id, charger_id, connector_id, session_id, sent_at, limit_w int, profile jsonb, response_status text, error text null | |
| `flex_events` | id uuid pk, site_id, requested_by fk, starts_at, ends_at, cap_kw, status enum(requested/accepted/declined/active/completed), created_at | grid operator asks a site to cut load |
| `session_reports` | session_id pk, energy_kwh, cost, co2_kg, baseline_co2_kg, baseline_cost, avoided_co2_kg, cost_saved, renewable_share, green_score int, verified bool, computed_at | verified = meter + actual CI |

Indexes that matter: `sessions(site_id, status)`, `sessions(driver_id, plugged_in_at desc)`, `sessions(ocpp_transaction_id)`, `meter_readings(session_id, recorded_at)`, `plans(site_id, solved_at desc)`, `dispatch_log(charger_id, sent_at desc)`, `flex_events(site_id, status)`, `chargers(ocpp_identity)` unique.

RLS: drivers read/update own `sessions` (deadline, need, mode only), own `vehicles`, own `session_reports`; operators read everything for their `site_id` and update `sites`, `sessions`, `flex_events`; grid_operator reads site aggregates + reads/inserts `flex_events`; backend uses the service role. Realtime enabled on `sessions`, `chargers`, `plans`, `session_reports`.

---

## 5. REST API (Fastify, `docs/API.md`)

Auth: `Authorization: Bearer <Supabase JWT>` verified with `jose`; role from `profiles`. Dev mode `DEV_AUTH=1` accepts `x-dev-role` + `x-dev-user` headers. Envelope `{ ok, data, error, meta }`. Validation with zod at every boundary.

| Method + path | Role | Request → Response |
|---|---|---|
| GET `/health` | any | `{ status, clock, chargersOnline, lastSolveAt }` |
| GET `/me` | any | profile |
| GET `/sites/:id/forecast?hours=24` | any | aligned series: carbon, price, renewableShare, sources, best window |
| POST `/sessions/preview` | driver | `{ siteId, energyKwh, deadlineAt, maxPowerKw }` → per-mode estimate `{ cost, co2Kg, renewableShare, finishBy }` + feasibility |
| POST `/sessions/:id/claim` | driver | `{ vehicleId, energyKwh \| targetSoc, deadlineAt, mode }` → session (links the pending OCPP transaction; 422 `deadline_unreachable` with `earliestDeadlineAt`) |
| POST `/sessions` | driver | `{ chargerId, connectorId, ...claim fields }` → sends RemoteStartTransaction, returns pending session |
| GET `/sessions/current` · GET `/sessions/:id` · GET `/sessions` | driver (own) / operator (site) | session (+ `plan` power series, `deadlineRisk`) |
| PATCH `/sessions/:id` | driver (own) / operator | `{ deadlineAt?, energyKwh?, mode? }` → triggers re-solve |
| POST `/sessions/:id/stop` | driver (own) / operator | RemoteStopTransaction |
| GET `/sessions/:id/report` | driver (own) / operator | session report (verified flag) |
| GET/POST `/vehicles` | driver | own vehicles |
| GET `/sites/:id/overview` | operator | live KPIs (see §7) |
| GET `/sites/:id/chargers` · `/sessions?status=` · `/plans/latest` · `/dispatch-log?limit=` | operator | lists |
| POST `/sites/:id/replan` | operator | forces a solve, returns plan summary |
| PATCH `/sites/:id/settings` | operator | `{ defaultMode?, gridConnectionKw?, demandChargePerKw? }` |
| GET `/sites/:id/reports?from&to` | operator | aggregated impact (energy, cost vs baseline, CO2 avoided, peak reduction, verified share) |
| POST `/chargers/:id/reset` | operator | OCPP Reset |
| GET `/grid/sites` | grid_operator | per-site current draw, planned peak, flex capacity |
| POST `/grid/flex-events` · GET `/grid/flex-events` · GET `/grid/flex-events/:id` | grid_operator | `{ siteId, startsAt, endsAt, capKw }` |
| POST `/sites/:id/flex-events/:eventId/respond` | operator | `{ accept: boolean }` → accepted events become per-slot caps in the next solve |
| POST `/admin/clock` | operator (dev) | `{ scale?, now? }` demo clock control |
| WS `/ws/sites/:id` | operator | events: `session.updated`, `charger.updated`, `plan.solved`, `forecast.updated`, `dispatch.sent`, `flex.updated`, `clock.tick` |
| WS `/ocpp/:chargePointId` | chargers | OCPP 1.6J, subprotocol `ocpp1.6` |

---

## 6. Driver app screens (`docs/SCREENS.md`; Expo scaffold in T15)

1. **Sign in** — email OTP via Supabase.
2. **Home / Plug in** — scan charger QR or enter code; 24h "green window" strip for the site (carbon colour scale), "Best time to charge: 11:00–15:00, 62% renewable"; current session card if one exists.
3. **Session setup** — energy need (kWh or target SoC slider from vehicle battery), deadline time picker, four mode cards each showing preview cost / CO2 / finish time from `/sessions/preview`; unreachable deadline shows the earliest reachable one inline; Confirm.
4. **Live session** — provisional Green Score dial; status line ("Charging at 7.2 kW" / "Waiting for cleaner power, resumes 11:15"); timeline bar over the parked window coloured by carbon intensity with planned blocks; kWh delivered / needed; "Guaranteed by 17:00"; actions: Need it sooner (deadline), Charge now (switch to fastest), Stop.
5. **Session summary** — final Green Score, kWh, cost, % renewable, avoided CO2 with a plain-language equivalence, "Verified from meter data" badge, share.
6. **History / Impact** — session list, cumulative avoided CO2 and money saved.
7. **Vehicles & settings** — vehicles (battery kWh, max kW), default mode, default deadline.

Green Score = position of the session's energy-weighted carbon intensity within the range available during its parked window (100 = charged at the cleanest moments available, 0 = the dirtiest; 100 if the range is flat). Renewable share shown separately.

---

## 7. Operator dashboard (`docs/DASHBOARD.md`, `apps/dashboard`)

Visual direction: light "control room" — dense tabular numerals, one semantic carbon scale (green → amber → red) reused across the chart, charger cards and timeline; no decorative colour.

| Region | Content | Live? |
|---|---|---|
| KPI strip | vehicles charging / plugged in; site demand kW vs grid cap (gauge); renewable share now; carbon intensity now; projected cost today; peak so far vs planned peak; CO2 avoided today | yes (WS + 2s poll) |
| Main chart (24h) | stacked planned charging power by session over slots, site cap line, base load, carbon intensity + price overlays, "now" marker | on `plan.solved`, `forecast.updated` |
| Charger grid | card per charger: status, current kW / limit, driver, deadline countdown, progress | on `charger.updated`, `session.updated` |
| Sessions table | driver, need, delivered, deadline, mode, status, risk flag; row action: override deadline/mode | yes |
| Right rail | forecast sources + last fetch, site default mode selector, Re-plan now, flex requests (accept/decline with projected impact), dispatch log stream | yes |
| Reports page | daily/weekly avoided CO2, cost vs baseline, peak reduction, verified vs estimated share | on load |

---

## 8. Engine specification (`packages/engine`)

Interfaces (in `shared`): `SlotGrid { startMs, slotMinutes, slots, slotHours: number[] }`; `SessionNeed { sessionId, arrivalSlot, deadlineSlot (exclusive), energyKwh (remaining), maxPowerKw, minPowerKw?, weights? }`; `SiteLimits { gridConnectionKw, baseLoadKw[], demandChargePerKw, slotCapsKw? }`; `ForecastSeries { grid, carbonGPerKwh[], pricePerKwh[], renewableShare[] }`; `ScheduleProblem`; `ScheduleResult { status: optimal|feasible|infeasible|error, solver, allocationsKw: Record<sessionId, number[]>, peakKw, shortfalls[], totals { energyKwh, cost, co2Kg }, solveMs }`; `Scheduler { name; solve(p): Promise<ScheduleResult> }`.

Mode presets (dimensionless): cheapest (cost 1, co2 0.1, peak 0.3, speed 0.01), greenest (0.1, 1, 0.1, 0.01), fastest (0, 0, 0, 1), balanced (0.5, 0.5, 0.3, 0.01). Speed weight always ≥0.01 as an earlier-is-safer tie-break.

**LP** (HiGHS, CPLEX LP text): variables `p_s_t ≥ 0` only for t in the session window, `u_s ≥ 0` shortfall, `P ≥ 0` peak.
- Σ_t p_s_t·h_t + u_s = E_s
- p_s_t ≤ Pmax_s
- Σ_s p_s_t + base_t ≤ cap_t (cap_t = min(gridConnection, flex cap))
- Σ_s p_s_t + base_t ≤ P
- min Σ_s Σ_t p_s_t·h_t·(w_cost_s·price_t/mean + w_co2_s·ci_t/mean + w_speed_s·t/N) + w_peak·(P/gridConnection)·ΣE + 1000·Σ u_s
- Status: `optimal` if all u=0, `feasible` with `shortfalls` otherwise; solver error/timeout (2s) → greedy fallback with `solver: 'greedy'`.

**Greedy**: score_t = same blended per-slot score; sessions ordered by laxity (window length − slots needed); each session fills its best reachable slots with min(Pmax, remaining cap, remaining/h_t); peak-shaving pass tries progressively lower per-slot caps (10 steps) and keeps the lowest with no shortfall; reports shortfalls.

**Validation** (throws `ScheduleValidationError` with a code): non-finite/negative energy, maxPower ≤ 0, gridConnection ≤ 0, arrival ≥ deadline after snapping, forecast length ≠ slots, NaN in series, duplicate session ids. **Feasibility** (`earliestFinish(need)`): used by the API to reject impossible deadlines cleanly.

**Emissions**: `integrate(readings, series)` splits each meter delta across slot boundaries; `simulateBaseline(plugInAt, energyKwh, maxPowerKw, series)` = full power from plug-in until need met; `buildSessionReport(...)` → cost, CO2, baseline, avoided, renewable share, Green Score, `verified` (meter + actual CI) vs estimated. Register decrease → error; missing readings → estimated from plan, flagged.

---

## 9. Server components (`apps/server`)

**OCPP gateway**: `ws` server (noServer, routed on `/ocpp/:id`), subprotocol `ocpp1.6`. Inbound: BootNotification → Accepted/interval 300; Heartbeat; StatusNotification → connector status; Authorize → Accepted; StartTransaction → create session from idTag (driver + booking from seed, or pending claim), return transactionId; MeterValues → append readings, update delivered kWh; StopTransaction → close session, compute report. Outbound with 10s timeouts: SetChargingProfile, ClearChargingProfile, RemoteStart/StopTransaction, Reset. Typed `EventBus` (`session.started`, `session.stopped`, `meter.updated`, `charger.connected`, `charger.disconnected`) feeds the optimiser loop and WS channel.

**Optimiser loop**: on event (debounced 2s) or every 5 min: build `ScheduleProblem` from active sessions (remaining energy from meters, snapped slots, accepted flex caps), current `ForecastSeries`, site limits and modes → `scheduler.solve` (LP with greedy fallback) → persist plan → dispatcher → emit `plan.solved`. Sends only the immediate slot as the binding decision, with the next 3 planned periods included as a fallback the next re-solve overwrites (`lookaheadPeriods`, default 3, can be set to 1).

**Dispatcher**: pure `buildDispatch(plan, sessions, grid, now, lastSent)` → TxProfile per active session: `chargingProfileId = session ordinal, stackLevel 1, kind Absolute, startSchedule = slot start, chargingRateUnit W, periods [{startPeriod 0, limit}, ...]`; skip if unchanged within 250 W; limits below `minPowerKw` → 0; `DispatchService` sends, records `dispatch_log`, retries once on Rejected then marks the charger `uncontrolled` (full power; deadline still met).

**Forecast service**: `CarbonSource` (UkCarbonIntensity: `/intensity/{from}/fw48h` + `/generation/{from}/{to}`; Synthetic), `PriceSource` (OctopusAgile product `AGILE-24-10-01`, region C, p/kWh inc VAT → £/kWh; SyntheticToU), `WeatherSource` (OpenMeteo hourly `shortwave_radiation`, `wind_speed_10m`, `cloud_cover`). `renewableFromWeather` = clamp(k_solar·irradiance/1000 + k_wind·min(1,(v/12)^3) + historical hourly mean) where the historical profile is computed once at startup from the past 7 days of `/generation` (fallback: baked-in GB profile). Blend 0.6 API + 0.4 weather when the API is available; weather-only otherwise; carbon from share when no CI source (450·(1−share)+30·share). Cache with TTL (carbon 30 min, price 6h, weather 60 min), resample 30-min/hourly → 15-min step, persist snapshots to `grid_signals`, background refresh, keep-last-good on failure, synthetic as final fallback. In sim mode the live series is aligned by time-of-day onto the simulated grid.

**Repositories**: `SiteRepo`, `ChargerRepo`, `SessionRepo`, `MeterRepo`, `PlanRepo`, `SignalRepo`, `FlexRepo`, `ReportRepo` interfaces; `memory/` implementations (immutable updates); `supabase/` stub wired to `@supabase/supabase-js`, selected by `REPO=supabase`.

**Seed** (`scenarios/day-one.json`, also `supabase/seed.sql`): site "Riverside Office Car Park", GB, 100 kW grid connection, 8 × 22 kW AC chargers (dumb total 176 kW > cap, so spreading is forced), office base load 10–30 kW, demand charge £12/kW-month prorated per day. ~14 arrivals: commuters 07:30–09:00 needing 15–40 kWh by 17:00–18:00 (vehicles 40–80 kWh, 7–11 kW max), two lunchtime short stops, four evening residents 18:00–20:00 with 07:00 next-day deadlines (shows evening-peak avoidance), one impossible request (60 kWh in 1h) to demonstrate the clean 422.

**Simulator** (`apps/simulator`): `--url --scenario --time-scale --start`; per charger: connect, Boot, Heartbeat, StatusNotification; per arrival: Preparing → Authorize → StartTransaction → MeterValues every 60 sim-seconds (Energy.Active.Import.Register Wh, Power.Active.Import W, SoC) → StopTransaction at departure. Vehicle: power = min(profile limit, vehicle max, charger max), linear taper above 85% SoC, energy register integrates per tick. Obeys SetChargingProfile / ClearChargingProfile (Accepted), RemoteStart/Stop, Reset, GetConfiguration.

---

## 10. Risks and fallbacks (`docs/RISKS.md`)

| Risk | Fallback |
|---|---|
| `highs` WASM fails to load on Node 25 / Windows | greedy scheduler behind the same interface; swap to `glpk.js` is one file |
| LP infeasible or slow | slack variables (always feasible); 2s timeout → greedy |
| External API down or rate-limited mid-demo | cache + keep-last-good + synthetic profile; sources pluggable |
| SetChargingProfile rejected | retry once, then charger runs uncontrolled at full power (deadline still met); logged |
| Server and simulator clocks disagree | one `Clock` config (`SIM_START`, `SIM_TIME_SCALE`) read by both; slot-math tests |
| Slot snapping loses a deadline | arrival rounds up, deadline rounds down; partial slot 0; tests on boundaries |
| Unit confusion (W/kW, Wh/kWh) | suffixed field names, `units.ts` converters, tests |
| Profile churn on chargers | 250 W hysteresis, per-slot dispatch |
| Supabase auth/RLS eats hours | in-memory repos + `DEV_AUTH=1`; migrations ready to apply later |
| Serverless kills OCPP sockets | single long-lived Node process; deploy to a VM/Railway/Fly if hosted |
| Meter register resets or gaps | register decrease → error; gaps → estimated report, flagged not verified |
| Dashboard/Expo scaffolding time | dashboard first (demo value); driver app is the last, cuttable phase |
| Dumb baseline exceeds site cap | baseline is per-session at full power (standard counterfactual); documented |
| TypeScript 7 native port breaks tooling | pin typescript@5 |
| Demo day too slow/fast | `SIM_TIME_SCALE` env + `/admin/clock` |

---

## 11. Verification

- `npm test` at the root runs vitest across workspaces: engine (greedy, LP, validation failures, feasibility, emissions, slot grid), ocpp (framing), server (dispatcher, forecast service with mocked fetch, gateway ↔ in-process simulator integration). Coverage report for `packages/engine` ≥ 80%.
- Scheduler test cases: single car trivial; deadline exactly reachable; site cap forces spreading; greenest vs cheapest pick different slots on a synthetic curve; fastest front-loads; flex cap respected; impossible deadline → `feasible` with shortfall (LP) and 422 at intake; validation errors for negative energy, zero power, deadline before arrival, mismatched forecast length; LP and greedy agree on totals within tolerance; HiGHS timeout triggers fallback.
- `npm run demo`: starts server with seed at time scale 60 and the simulator; prints each solve (mode, solver, peak, cost, CO2), each dispatch, and a final per-session report table (energy, cost, % renewable, avoided CO2, Green Score, verified). Expected: no missed deadlines, site draw never above 100 kW, evening arrivals shifted overnight.
- API smoke with curl under `DEV_AUTH=1`: preview, claim, patch deadline (re-solve fires), report, flex event round trip.
- Dashboard at `localhost:3000` shows KPIs changing while the demo plays.
- `docs/REVIEW.md`: pass over the built code against the architecture in the brief, listing every drift (e.g. own WS instead of Supabase realtime, lookahead periods vs "immediate decision only", per-session vs site-wide modes) with the reason and the switch-back cost.

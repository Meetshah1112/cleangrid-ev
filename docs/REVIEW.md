# Review: where the build stands against the brief

Reviewed by reading the diff four times, once per lens: correctness, security, TypeScript idiom,
and test coverage. Then separately against the architecture in the brief, to find drift.

## 1. Drift from the brief

| The brief said | What was built | Why | Cost to switch back |
|---|---|---|---|
| Supabase for Postgres, auth and realtime | Repository interfaces with an in-memory implementation; the full schema and RLS are written but not applied | No Supabase project existed at build time, and auth plus RLS is the classic way to lose a hackathon day | One file: a Supabase implementation of the same interfaces. Nothing above them changes |
| Supabase realtime pushes to the dashboard | Own WebSocket channel at `/ws/sites/:id` carrying typed site events | Realtime needs the database first, and the server already had to hold long-lived sockets for OCPP | Swap the transport in one hook; the event names already match table changes |
| Only the immediate next decision goes to hardware | The immediate slot is binding, and the next two slots ride along in the same profile | If the server pauses, a charger holding a 45-minute schedule behaves sanely instead of running at full power. Every re-solve overwrites it | Set `LOOKAHEAD_PERIODS=1` |
| Light "control room" dashboard | Dark control room | Energy operations screens are dark, and the demo runs on a projector | Palette tokens are in one CSS block |
| Modes are a site setting | Cost, carbon and speed weights are per session; the peak weight is the site's | Drivers pick their own trade-off; the demand charge is the site's bill, not any one driver's | Read all four weights from the site |
| Charging simply starts when a car plugs in | Each charger is given a stack-level-0 default profile on connect | Without it a car draws full power until the first plan arrives, which put the site 13 kW over its connection in the first run | Remove one method; accept the overshoot |

Everything else follows the brief: 15-minute slots over a rolling 24 hours, an LP with a greedy
fallback, four modes, deadline guarantee with a slack variable, OCPP 1.6J over WebSocket with
SetChargingProfile, a charger simulator, avoided emissions measured from meter readings against a
dumb-charger baseline, and one long-lived Node process holding the API, the gateway and the loop.

## 2. Correctness

| Finding | Severity | Status |
|---|---|---|
| A car drew full power between StartTransaction and its first charging profile; seven morning arrivals took the site to 78 kW on a 65 kW connection | high | fixed: safety default profile per charger, and the re-solve debounce is capped in simulated time |
| Impact reports scored a finished session against the forward forecast, which clamps everything before now to one value, so avoided CO2 came out at zero | high | fixed: reports read stored grid signals for the session's own window |
| Peak demand was computed by summing each session's last reported power, which adds readings taken at different moments and overstated the peak by about 10 kW | medium | fixed: `DemandMeter` integrates energy per 15-minute interval, which is how a demand charge is billed |
| `POST /sessions` recorded the caller as the driver whoever they were, so an operator could open a session that looked like a driver's | medium | fixed: the endpoint is driver-only |
| An empty body with a JSON content type produced a 500 | low | fixed: empty bodies parse as `{}`, and Fastify's own 4xx errors keep their status |
| The dispatcher remembered setpoints for sessions that had ended | low | fixed: it forgets on `session.ended` |
| The greedy scheduler's peak shaving is a search over candidate ceilings, not an optimum | low | open by design; it is the fallback, and the LP is exact |
| `existingPeakKw` resets when the process restarts | low | open; it belongs in the database with the rest of the day's meter data |
| The dumb-charger baseline ignores the site's grid connection | none | deliberate and documented: it is the counterfactual, not a claim about what the site could physically draw |

## 3. Security

| Finding | Severity | Status |
|---|---|---|
| `DEV_AUTH=1` is the default, and it trusts `x-dev-role` and `x-dev-user` headers. Anyone who can reach the API can claim to be an operator | high if deployed | open by design for local work. Set `DEV_AUTH=0` in anything reachable; the config then refuses to start without a JWT secret |
| CORS reflects any origin | medium if deployed | open; restrict to the dashboard origin in production |
| No rate limiting on any endpoint | medium if deployed | not built |
| The OCPP endpoint accepts any charge point that knows a seeded identity | medium | partly mitigated: unknown identities are refused. Real deployments add TLS client certificates or per-charger basic auth |
| Inbound OCPP payloads are schema-validated before they touch domain state, and unknown actions answer `NotImplemented` | — | good |
| Row-level security separates drivers, operators and grid operators, with column grants so a driver can only change their deadline, need and mode | — | good, but unexercised until Supabase is wired |
| No secrets in the repository; `.env.example` carries names only | — | good |

## 4. TypeScript idiom

Strict mode with `noUncheckedIndexedAccess` across every package, which is why array access reads
defensively throughout. Domain types are `readonly` and repositories hand back frozen objects, so
state changes have to go through a repository. Classes are used only where something owns state
(services, the clock, the RPC connection); everything else is a pure function, which is what makes
the engine and the problem builder testable without any IO.

What a fluent reader would still object to: a handful of `as unknown as Payload` casts where typed
OCPP messages meet the JSON wire format, and `apps/server/src/api/routes/sites.ts` doing light
shaping inline that will want extracting once there is more than one site.

## 5. Tests

202 tests. The engine is the best covered: one behavioural contract runs against both the greedy
and the LP scheduler, so the two can never drift apart, and it includes the cases where scheduling
should fail cleanly. The OCPP gateway is tested over a real WebSocket, boot to stop. The forecast
providers are tested with a fake fetch, including each source failing independently.

Gaps, in order of how much they matter:

1. The optimiser loop itself has no unit test. It is covered end to end by the demo, which is
   weaker but not nothing.
2. No dashboard tests. Visual regression is the right tool here and it is not wired up.
3. The driver app is typechecked but has not been run against a device in this session.

## 6. Not built

Vehicle-to-grid, more than one site, real hardware, a Supabase repository implementation, rate
limiting, and visual regression tests. The first three are out of scope by the brief; the last
three are the next things to add.

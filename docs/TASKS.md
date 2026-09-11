# Task list

Ordered so that something runs end to end as early as possible. "Blocks" names the tasks that
cannot start until this one is done.

| # | Task | Blocks | Status |
|---|---|---|---|
| T1 | Monorepo scaffold: npm workspaces, strict TypeScript, Vitest, env example | everything | done |
| T2 | `shared`: units, slot grid, simulated clock, mode weights, domain types, scheduler contract, request schemas, scenario format | T3–T13 | done |
| T3 | `engine`: validation, deadline feasibility, greedy scheduler, shared objective | T7, T8 | done |
| T4 | `ocpp`: CALL/CALLRESULT/CALLERROR framing, typed 1.6J messages, meter-value parsing | T5, T6 | done |
| T5 | OCPP gateway: WebSocket server, inbound handlers, outbound calls, charger registry, event bus | T6, T7, T8 | done |
| T6 | Charger simulator: scenario replay, vehicle model with taper, profile obedience, driver-app actor | milestone 1 | done |
| T7 | Dispatcher: plan to SetChargingProfile, hysteresis, minimum-power rounding, dispatch log | T8 | done |
| T8 | Optimiser loop, in-memory repositories, synthetic forecast, seeding, `npm run demo` | T9–T13 | done (milestone 1) |
| T9 | LP scheduler on HiGHS, resilient fallback, same test contract as greedy | – | done |
| T10 | Forecast service: provider interface, caching, historical signals, persistence | T11 | done (synthetic provider; live sources are the next step) |
| T11 | Avoided emissions: meter integration, dumb-charger baseline, Green Score, site impact | T12 | done |
| T12 | REST and WebSocket API, dev and JWT auth, flex events, Supabase schema and RLS | T13 | done |
| T13 | Operator dashboard: live KPIs, plan chart, bays, sessions, flex, impact page | – | done (milestone 2) |
| T14 | Seed realism, full test run, drift review, documentation | – | in progress |
| T15 | Driver app (Expo) against the same API | – | stretch |

## Milestones

- **Milestone 1**: a simulated day runs end to end in the terminal. Reached at T8.
- **Milestone 2**: the dashboard shows that day as it happens. Reached at T13.

## Who does what

The build ran as one person plus one agent, so the split is by lane rather than by person. With
more people the natural cut is:

| Lane | Tasks | Depends on |
|---|---|---|
| Engine | T3, T9, T11 | T2 only, no IO, fully testable alone |
| Protocol | T4, T5, T6, T7 | T2, and a charger simulator to talk to |
| Platform | T8, T10, T12 | the engine and protocol interfaces, not their implementations |
| Surfaces | T13, T15 | the API shape, which is fixed in T2 as schemas |

Every lane depends only on interfaces defined in T2, so once the shared package exists nobody is
blocked waiting for anybody else's implementation.

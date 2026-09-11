# Database

Postgres on Supabase. `supabase/migrations/0001_schema.sql` creates it,
`0002_rls.sql` locks it down. The server runs on in-memory repositories until Supabase
credentials are supplied; nothing above the repository layer changes.

## Tables

| Table | Holds | Notes |
|---|---|---|
| `sites` | one car park | grid connection, demand charge, currency, default mode, 24-hour building load profile |
| `chargers` | physical bays | `ocpp_identity` is the WebSocket path segment and is unique; `uncontrolled` marks a charger that refuses profiles |
| `connectors` | per-connector state | OCPP status verbatim, current session |
| `profiles` | people | role, site, `id_tag` linking an RFID card to a driver, defaults used for walk-up sessions |
| `vehicles` | cars | battery size and maximum charging power |
| `sessions` | one plug-in | the driver's need and deadline, the OCPP transaction, meter registers, delivered energy, last dispatched limit, deadline risk |
| `meter_readings` | raw registers | monotonic Wh, power, state of charge |
| `grid_signals` | carbon, price, renewable share, measured carbon | keyed by site, kind and slot start; forecasts are upserted, measurements kept separately |
| `plans` | one solve | solver, status, timings, totals, the signals it used and the load it produced |
| `plan_schedules` | per session power | one array per session per plan, so a plan is two rows plus one per car |
| `dispatch_log` | what reached the hardware | the profile sent and the charger's answer |
| `flex_events` | grid requests | window, cap, and the operator's answer |
| `session_reports` | verified impact | measured energy, cost, CO2, the dumb-charger counterfactual, Green Score, `verified` |

## Relationships

A site has chargers, sessions and plans. A charger has connectors and sessions. A driver profile
has vehicles and sessions. A session has meter readings, one report, and a row in each plan's
schedule. Flex events belong to a site and are raised by a grid operator profile.

## Indexes that matter

| Index | Why |
|---|---|
| `sessions (site_id, status)` and the partial index on active sessions | the optimiser reads active sessions on every solve |
| `sessions (driver_id, plugged_in_at desc)` | the driver app's history |
| `sessions (transaction_id)` unique | every MeterValues message looks up its session by transaction id |
| `meter_readings (session_id, recorded_at)` | building a report walks one session's readings in order |
| `plans (site_id, solved_at desc)` | the dashboard always wants the latest |
| `dispatch_log (charger_id, sent_at desc)` | debugging a charger that is not obeying |
| `grid_signals (site_id, kind, slot_start desc)` | reports read historical signals for a window |
| `chargers (ocpp_identity)` unique | every WebSocket connection resolves an identity to a charger |

## Row-level security

- **Drivers** read and update their own sessions, and read their own vehicles, meter readings and
  reports. Column grants limit their updates to deadline, energy needed and mode; everything else
  on a session is the server's to write.
- **Operators** read and update everything for the site named on their profile.
- **Grid operators** read site-level rows and raise flex events; they never see a driver's name or
  history.
- **The backend** uses the service role and bypasses these policies, because it acts on behalf of
  chargers that have no user identity.

Policies that need the caller's role or site use security-definer helpers, so reading the
`profiles` table inside a `profiles` policy cannot recurse.

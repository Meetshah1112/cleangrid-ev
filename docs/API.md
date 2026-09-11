# API

Base URL `http://localhost:8080`. Every response is `{ ok: true, data }` or
`{ ok: false, error: { code, message, details } }`.

**Auth.** With `DEV_AUTH=1` (the default) the headers `x-dev-role` and `x-dev-user` identify the
caller; if the user id matches a seeded profile, that profile's role and site win. With
`DEV_AUTH=0` a Supabase JWT is required in `Authorization: Bearer`, and the role comes from the
stored profile rather than from the token.

## Everyone

| Method | Path | Returns |
|---|---|---|
| GET | `/health` | status, simulated time, chargers online, active sessions, last plan |
| GET | `/clock` | `{ nowMs, scale, iso }`; the simulator syncs to this |
| GET | `/me` | the caller's profile |
| GET | `/sites/:siteId/forecast?hours=24` | carbon, price and renewable share in 15-minute steps, source names, and the cleanest three-hour window |

## Driver

| Method | Path | Body / notes |
|---|---|---|
| POST | `/sessions` | `{ chargerId, connectorId?, vehicleId?, energyKwh, deadlineAt, mode? }`. 422 `deadline_unreachable` carries `earliestDeadlineAt` and `maxDeliverableKwh` |
| GET | `/sessions` | own history, newest first, each with its impact report when one exists |
| GET | `/sessions/current` | the live session with its planned power per slot |
| GET | `/sessions/:id` | one session, with the plan's power series |
| PATCH | `/sessions/:id` | `{ deadlineAt?, energyKwh?, mode? }`, re-checked for feasibility, triggers a re-solve |
| POST | `/sessions/:id/stop` | RemoteStopTransaction to the charger |
| GET | `/sessions/:id/report` | energy, cost, CO2, avoided CO2, Green Score, verified flag |
| GET/POST | `/vehicles` | own vehicles |

## Operator

| Method | Path | Returns |
|---|---|---|
| GET | `/sites` | sites |
| GET | `/sites/:siteId/overview` | live KPIs: demand against connection, cars charging, carbon now, price now, peak so far, planned peak and cost |
| GET | `/sites/:siteId/sessions?status&limit` | sessions with driver names and remaining energy |
| GET | `/sites/:siteId/chargers` | chargers with connector state |
| GET | `/sites/:siteId/plans/latest` | the current plan: allocations per session, site load, caps, signals |
| GET | `/sites/:siteId/dispatch-log?limit` | what was sent to which charger and whether it was accepted |
| GET | `/sites/:siteId/reports?from&to` | verified impact for the period |
| GET | `/sites/:siteId/flex-events` | flexibility requests for this site |
| POST | `/sites/:siteId/flex-events/:eventId/respond` | `{ accept }`; accepting becomes a per-slot cap in the next solve |
| POST | `/sites/:siteId/replan` | force a solve |
| POST | `/admin/clock` | `{ scale?, nowAt? }`, demo control, only when the clock is simulated |

## Grid operator

| Method | Path | Returns |
|---|---|---|
| GET | `/grid/sites` | per site: current draw, planned peak, how much load is flexible right now |
| POST | `/grid/flex-events` | `{ siteId, startsAt, endsAt, capKw, reason? }` |
| GET | `/grid/flex-events?siteId` | requests and their answers |

## WebSocket

| Path | Who | Messages |
|---|---|---|
| `/ws/sites/:siteId` | dashboards | `session.updated`, `meter.updated`, `charger.updated`, `plan.solved`, `dispatch.sent`, `flex.updated`, `report.ready`, `forecast.updated`, `clock.tick` |
| `/ocpp/:chargePointId` | chargers | OCPP 1.6J, subprotocol `ocpp1.6` |

## OCPP support

Inbound: BootNotification, Heartbeat, StatusNotification, Authorize, StartTransaction,
StopTransaction, MeterValues, DataTransfer. Outbound: SetChargingProfile, ClearChargingProfile,
RemoteStartTransaction, RemoteStopTransaction, Reset, GetConfiguration, ChangeConfiguration,
TriggerMessage. Unknown actions answer `NotImplemented`; malformed payloads answer
`FormationViolation`.

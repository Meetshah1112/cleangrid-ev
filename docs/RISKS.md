# What could go wrong, and what happens then

Each risk has a fallback that is built, not imagined. The ones marked "hit" actually happened
during the build.

| Risk | Fallback | Status |
|---|---|---|
| HiGHS WebAssembly fails to load or crashes mid-solve | `ResilientScheduler` catches it, the greedy scheduler produces the plan, the reason is recorded on the plan and shown on the dashboard. The cached module is dropped so the next solve gets a fresh one | built, tested |
| Solver takes too long | HiGHS is given a two second time limit; anything but `Optimal` is treated as a failure and falls back to greedy | built |
| A deadline cannot be met | Slack variables keep the model solvable; the plan comes back with named shortfalls, the sessions are flagged at risk, and the intake check refuses impossible requests up front with the earliest reachable deadline | built, tested |
| External data source down or rate limited | Cache, then last good snapshot, then the deterministic synthetic profile. The dashboard names the source in use | built |
| A charger rejects SetChargingProfile | Retried on the next solve; after two refusals the charger is marked uncontrolled, runs at full power, and the optimiser plans around it as fixed load so other cars still meet their deadlines | built |
| Server and simulator disagree about the time | One clock, exposed at `/clock`; the simulator syncs on start and every thirty seconds | built |
| A car charges at full power before its first plan arrives | **Hit.** The first run peaked at 78 kW on a 65 kW connection. Every charger now gets a stack-level-0 default profile on connect, sized so every bay at that limit plus the worst building hour still fits the connection | fixed |
| Impact reports read the wrong grid data | **Hit.** Reports scored past sessions against the forward forecast and showed zero avoided CO2. They now read stored signals for the session's own window | fixed |
| Unit confusion between kW and kWh, W and Wh | Field names carry units, one conversion module, and the meter parser converts kWh/kW inputs | built |
| Charging profiles churn every solve | 250 W hysteresis per period; unchanged setpoints are not resent | built |
| Meter register resets or goes backwards | The reading is rejected with a warning rather than turned into negative energy; reports refuse to guess and mark themselves unverified | built, tested |
| A car plugs in between solves and pushes the site over its connection | **Hit.** Idle bays now share only the headroom the current plan leaves spare, and plans are held two percent below the connection because no control loop reacts instantly | fixed |
| Metered demand misreads because readings straddle interval boundaries | **Hit.** Energy is split across the intervals it spans, and an interval is scored one interval later so every charger has reported | fixed |
| Supabase auth and RLS eat the build | In-memory repositories and dev-header auth by default; the schema and policies are written and ready to apply | built |
| Serverless kills long-lived OCPP sockets | One long-lived Node process holds the gateway, the API and the loop. Deploy on a VM or a container host, not a function | by design |
| A dumb-charging baseline would exceed the connection | Stated plainly: the baseline is per session at full power from plug-in, which is what a dumb charger does. It is a counterfactual, not a claim about what the site could physically do | documented |
| Demo runs too slow or too fast for the room | `SIM_TIME_SCALE` and a `/admin/clock` endpoint change speed live | built |
| Node 25 refuses a dependency | Vitest warns that it does not support Node 25; it runs. If it ever refuses, pin Vitest 4 | watched |

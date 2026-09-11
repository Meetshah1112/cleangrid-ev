# Demo script

Three minutes, three claims: we never miss a deadline, we never breach the connection, and the
carbon saving is measured rather than asserted.

## Before you start

```bash
npm install
npm run demo -- --scale 240        # one terminal, a simulated day in about six minutes
npm run dev:dashboard              # second terminal, http://localhost:3000
```

If port 8080 is busy, run `node scripts/demo.mjs --scale 240 --port 8085` and start the dashboard
with `NEXT_PUBLIC_API_URL=http://127.0.0.1:8085 npm run dev -w apps/dashboard`.

## The story, in order

**1. The problem, on screen (20 seconds).** Point at the carbon ribbon under the plan chart. Green
at midday, red through the evening peak. "Same electricity, three times the emissions, depending
only on when you draw it."

**2. The morning rush (40 seconds).** Seven cars arrive between 07:30 and 09:00. Watch the site
demand tile: it climbs and then holds below the 65 kW line. "Plugged in together they would want
90 kW. The connection is 65. Nobody gets cut off; they get sequenced."

**3. A driver's choice (30 seconds).** Open the sessions table. Chloe is on greenest and her
charging lands in the solar hours; Ben is on cheapest and his lands overnight-cheap. Same car park,
same afternoon, different answers because they asked for different things.

**4. The refusal (20 seconds).** At 15:10 Jonas asks for 60 kWh in one hour on an 11 kW charger.
The terminal shows the API refusing it and the app settling for 10.4 kWh. "The one thing we will
not do is promise a deadline we cannot keep."

**5. The evening peak (30 seconds).** Four residents plug in between 18:15 and 19:45, the dirtiest
and most expensive hours of the day. The plan chart shows their charging pushed into the overnight
trough. This is where most of the saving comes from.

**6. The proof (40 seconds).** Open the Impact page, or read the table the demo prints at the end.
383 kWh delivered, every deadline met, 50 kg of CO2 avoided against charging on plug-in, about a
third off the bill, and all fourteen sessions verified from charger meter readings rather than from
the plan.

## If someone asks

**"What if the solver fails?"** It falls back to a greedy scheduler and the dashboard says which
one produced the plan. Kill the LP and the site keeps charging.

**"What if the data source is down?"** Cached, then last known good, then a synthetic profile. The
right rail names the source in use.

**"What if a charger ignores you?"** After two refusals it is marked uncontrolled and the optimiser
plans around it as fixed load, so the other cars still make their deadlines.

**"What if the server dies?"** Every charger holds a default profile sized so that all bays at that
limit plus the worst hour of building load still fit inside the connection.

**"Is this real OCPP?"** Yes, 1.6J over WebSocket. The simulator speaks the same protocol a real
charger does, and the plan reaches it as SetChargingProfile. Swapping in real hardware means
pointing it at the same URL.

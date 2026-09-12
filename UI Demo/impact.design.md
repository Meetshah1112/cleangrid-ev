# CleanGrid — Impact page design

## Purpose

Turn CleanGrid’s verified meter, price and carbon data into an emotionally clear proof of value. The user should feel that the product does not merely claim greener charging—it can demonstrate it session by session.

## Shared website shell

Use the common Forecast-style header. `Impact` is active. The page is a clean-energy outcome story with photographic landscapes, flowing white separators and clear comparison marks—not a reporting dashboard.

## Hero — “Every clean charge leaves proof.”

### Scenic backdrop

Use the same valley across a solar-to-wind transition.

- Solar panels and bright morning left.
- EV charging site and lake in the centre.
- evening wind/town lights on the right.
- A measured carbon comparison line is composited directly over the landscape; it must read as part of the environment.

### Copy

- Eyebrow: `VERIFIED IMPACT · TODAY`
- Headline: `Every clean charge leaves proof.`
- Supporting copy: `Measured from charger meters and matched to the grid’s real carbon intensity at the moment energy actually flowed.`
- Trust signal: `✓ Verified from 63 completed sessions`.

### Emissions comparison visual

Make the original `Measured emissions by charging strategy` chart the visual centre of the hero.

- Grey dotted/reference line: `Charge immediately`.
- Bright forest-green line/area: `CleanGrid plan`.
- Highlight the difference without using a generic bar-card: `24.7 kg CO₂ avoided · 16% less carbon`.
- State the counterfactual plainly: same energy, same fleet, same driver deadlines.

## Proof band

Flow a white metric ribbon across the next section:

- `1,983 kWh` — `Energy delivered · 63 sessions`
- `24.7 kg` — `CO₂ avoided · 16% below the baseline`
- `£81.80` — `Money saved · spent £443.88`
- `100%` — `Deadlines kept · 62 of 63 meter-verified`

These preserve the exact source values while making them editorial and visual rather than card-shaped.

## Baseline versus CleanGrid story

Use two broad, connected scenic visual moments rather than a traditional comparison dashboard.

### If every car charged immediately

- Value: `158 kg CO₂`.
- Meaning: same vehicles and energy, full power from plug-in.
- Visual language: muted grey energy trace, more heavily weighted toward the evening demand peak.

### With CleanGrid scheduling

- Value: `133.3 kg CO₂`.
- Meaning: sessions shift into renewable-rich availability within the actual parked windows.
- Visual language: green energy trace concentrated in daylight solar and overnight wind windows.

Show the direct bridge: `−24.7 kg` and `16% less carbon`.

## Audit trail

Retain the original audit table but make it a readable evidence ledger at the bottom of a flowing white section.

- Heading: `Audit trail`
- Supporting label: `latest verified sessions`
- Columns: `Session`, `Delivered`, `Finished`, `Day`.
- Preserve source rows:
  - `Jonas Weber · CP-08` — `12.8 kWh` — `16:20` — `18 Sept`
  - `Ivy Chen · CP-08` — `8.4 kWh` — `15:00` — `18 Sept`
  - `Hassan Ali · CP-08` — `12.1 kWh` — `13:30` — `18 Sept`
  - `Femi Adeyemi · CP-07` — `40.1 kWh` — `18:30` — `18 Sept`
  - `Elena Rossi · CP-06` — `21.9 kWh` — `17:45` — `18 Sept`
  - `Dev Patel · CP-05` — `25.1 kWh` — `17:00` — `18 Sept`
- Keep the source methodology statement: `Energy between meter readings, weighted by grid carbon intensity at the moment it was drawn, minus the same energy charged at full power from plug-in.`

## Period totals

Keep these as a compact final evidence line:

- `Renewable share of delivered energy` — `68%`
- `Average green score` — `70`
- `Cost if every car charged on plug-in` — `£525.68`
- `CO₂ if every car charged on plug-in` — `157.8 kg`
- Relevant peak context: `peak 68.7 kW of 65 kW`

## Verified-report behaviour

- Every impact result exposes a session-level report: energy, actual cost, actual carbon, baseline cost/carbon, avoided CO₂, cost saved, renewable share, Green Score, and verified/estimated state.
- The visual must distinguish `meter-verified` from estimated data in words and iconography, never only with colour.
- The user may click an audit-trail session to open its proof chain: charge point → meter readings → grid signal → baseline → final calculation.
- Live delivered energy and provisional avoided CO₂ update as new meter readings arrive. The page labels these figures `provisional` until a completed session has enough meter and actual-carbon data to be verified.
- The comparison traces progressively fill only as energy is delivered; on session completion, the final actual carbon point settles into place and the `meter-verified` marker appears.
- Date-range selection transitions the scenic comparison, totals and evidence ledger to the chosen period. It must use the same visual language rather than opening a separate report dashboard.
- Hovering a point on either comparison trace shows the real time, energy delivered, grid carbon intensity and the immediate-charge baseline for that interval.
- Filtering the audit trail by charger, driver, verified status or date updates the proof totals and never silently mixes estimated and verified sessions.

# CleanGrid — Grid Flex page design

## Purpose

Explain grid flexibility as a graceful, safe capability: the site can release capacity when the network needs it, while the optimiser keeps every driver’s departure promise intact.

## Shared website shell

Use the same Forecast-style header and scenic visual system. `Grid Flex` is active. The page should feel like an environmental-response story rather than a network map dashboard.

## Hero — “Give the grid room to breathe.”

### Scenic backdrop

Build one live energy landscape that transitions from a solar-rich afternoon into the early-evening demand peak.

- The foreground is the Riverside charging site and a softly lit road.
- The middle distance shows a city or community receiving power across the lake/valley.
- Thin energy paths move from the site to the wider grid horizon.
- When a request is active, use one restrained coral signal to show urgency; never flood the page with alert red.

### Copy

- Eyebrow: `GRID FLEX · LIVE RESPONSE`
- Headline: `Give the grid room to breathe.`
- Supporting copy: `CleanGrid makes capacity available when the network needs it, then moves flexible cars into a better moment without breaking a departure promise.`

### Current request state

The source screen’s baseline state must be supported:

- `No request in force`
- `This site is running to its own plan`
- Status: `standing by`

When a grid request is active, replace that with the active signal, for example:

- `Flex request received · 18:30–19:30`
- `40% site reduction requested`

### Integrated response visual

Show a single data path across the landscape:

1. Network call arrives at `18:30`.
2. Flexible sessions glide into clean alternative slots.
3. Urgent sessions remain charging.
4. Site draw is held at the revised cap until `19:30`.
5. The original optimised plan resumes.

Use direct labels: `network calls`, `CleanGrid releases 34 kW`, `cars resume cleaner later`. This visual replaces the original `Automated response plan` panel and its line chart while preserving the underlying explanation.

## Capacity proof band

Use a dark forest-green ribbon below the hero:

- `Available to shed 0.0 kW across 0 sessions` in the no-request state.
- `Deadline risk 0 drivers affected`.
- `Drawing now 10.0 kW of 65 kW connection`.
- `Would hold below 6 kW · 40% below the 10 kW drawn now`.

For an accepted flex request, show `34 kW released`, `0 drivers at risk`, and `12 sessions reshaped` as the live equivalent.

## Network sites scene

Replace the original blank geographic scatter-grid with a beautiful, map-informed network landscape.

- Plot all source sites as softly glowing points across a real regional basemap/terrain silhouette.
- Keep source site names and values visible on selection:
  - `Riverside Office Car Park` — `10.0 of 65 kW · 0.0 kW flexible · 4 cars`
  - `Gandhinagar Secretariat Car Park` — `97.0 kW / 120 kW · 0.0 kW flexible · 5 cars`
  - `Ahmedabad Ashram Road Plaza` — `84.0 kW / 200 kW · 0.0 kW flexible · 0 cars`
  - `Vadodara Alkapuri Depot` — `46.0 kW / 150 kW · 0.0 kW flexible · 0 cars`
  - `Surat Textile Park Yard` — `118.6 kW / 180 kW · 0.0 kW flexible · 2 cars`
- Retain the original visual intent: point size reflects share of connection being used.
- Provide the source location detail for Riverside: `GB · 05:23 local · 51.51°, −0.13°` only where appropriate to the selected GB demo site.

## Automated response plan

Use a single clean line flowing across a white section:

- Connection ceiling: `65 kW connection` as a thin coral dashed horizon.
- Current/revised site power: solid forest-green line and pale green fill.
- Planned steps: `05:29 ramp down`, `held at 6 kW`, `06:29 restore`.
- Preserve source explanation: `If accepted: 0 flexible sessions step from 0.0 kW to 0.0 kW each. Cars that cannot move without missing a deadline keep charging and are counted as deadline risk.`

## Flex request control

Use an elegant, purposeful interaction zone—not a form card.

- Heading: `Ask for a reduction`
- Choices: `20%`, `40%`, `60%` and `1 h`, `2 h`, `3 h`.
- Main action: `Reduce site load 40% for one hour`.
- Supporting truth from source: `The optimiser moves charging out of the window rather than cutting cars off. Anything that cannot move without missing a deadline keeps charging, and shows up as deadline risk above.`

## Connected sites and requests

Keep the original information but place it as a calm lower-page operational appendix.

- Heading: `Connected sites`
- Columns: `Site`, `Drawing`, `Connection`, `Flexible`, `Cars`.
- Heading: `Requests`
- Empty state: `Nothing asked for yet.`

## Dynamic behaviour

- A new `flex.updated` event should change the hero from the quiet `standing by` state to an active response story: request line appears, capacity path shifts, released kW counts up once, and the affected charge ribbons update.
- The reduction controls are real scenario inputs. Selecting `20%`, `40%`, `60%` and `1 h`, `2 h`, `3 h` immediately previews released capacity, affected sessions and deadline risk before the operator sends the request.
- The primary action starts a request/response workflow. Its label and state must progress through `requesting`, `accepted`, `active`, `completed` or `declined`; never imply that a grid request succeeded before the optimiser accepts it.
- Clicking a network site reveals its current draw, connection ceiling, accepted flex capacity, session count and the forecasted effect of the request.
- The response line animates only when the revised site cap actually changes. Urgent sessions visibly remain on their existing track to prove that driver constraints win over flexibility.
- The requests appendix updates in real time with request status and the final verified response result.

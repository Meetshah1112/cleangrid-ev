# CleanGrid — Overview page design

## Purpose

Give an operator an immediate, visually persuasive answer to one question: **is the site charging at the cleanest possible time without putting a departure at risk?** The page should feel like a living renewable-energy landscape, not an admin dashboard.

## Shared website shell

Use the Forecast reference as the fixed visual system.

- White, airy desktop canvas with a thin horizontal header.
- Left: CleanGrid leaf mark and `CleanGrid` wordmark.
- Centre navigation: `Overview`, `Forecast`, `Schedules`, `Grid Flex`, `Impact`.
- Right: green live indicator, current demo time, `Riverside Office Car Park` selector, circular `NO` avatar.
- `Overview` is active with a small forest-green underline.
- Forest green is the primary ink. Use sun-gold, lime green and pale cyan only to explain energy states.
- Large editorial type, scenic photography, soft flowing white section boundaries, almost no boxed UI.

## Hero — “Let the sun set the schedule.”

Use a full-width photorealistic valley: solar panels in the lower-left foreground, a lake and hills in the middle distance, a clean office-car-park charging lane curving along the lower edge, wind turbines on the ridge, and late-morning sunlight behind the central ridge.

**Copy**

- Eyebrow: `LIVE SITE · RIVERSIDE OFFICE CAR PARK`
- Headline: `Let the sun set the schedule.`
- Supporting line: `Cleaner energy. Happier drivers. A brighter tomorrow.`

On the upper-right, integrate the promise into the scenery instead of putting it in a card:

- `14 / 14 departures protected`
- `All drivers on track. No missed deadlines.`

### Integrated live-plan visual

Arc a translucent 24-hour energy landscape from left to right across the valley. It is a single visual, not a chart component dropped into a panel.

- Lime, stepped filled area: renewable availability.
- Fine white arc: the day’s clean-energy curve.
- Pale cyan descending edge after sunset: diminishing solar availability.
- Direct labels: `06:00`, `12:00`, `18:00`, `24:00`.
- Centre labels: `78% renewable`, `82 kW of 100 kW`, `11:00 clean run`.
- Include the actual current-site state from the overview screenshot: `Charging now 0 of 4 plugged in`, `10 of 10 bays online`, `Site load 9.0 kW of 65`, `56.0 kW of headroom`, `89 gCO₂/kWh, very clean`, `Saved so far £81.80`, `24.7 kg CO₂ avoided, 63 sessions`.

### Charger lane

Show the charger lane organically in the foreground, with eight charger moments placed on the curve. These are direct labels in the scene; do not create a charger-card grid.

| Bay | State | Supporting state |
| --- | --- | --- |
| 1 | Charging | live green energy line |
| 2 | Waiting | blue pause indicator |
| 3 | Charging | live green energy line |
| 4 | Clean window | waiting for cleaner power |
| 5 | Urgent | warm coral state, departure protected |
| 6 | Charging | live green energy line |
| 7 | Waiting | blue pause indicator |
| 8 | Clean window | low-carbon scheduled run |

The charger-status legend must still exist: `Charging`, `Holding`, `Free`. It sits as a tiny line of keys close to the lane.

### Bottom proof strip

Use a dark forest-green strip across the bottom of the hero:

- `1.42 MWh shifted`
- `−38% carbon`
- `31.5 kg CO₂ avoided · meter verified`

## “The site is charging into a cleaner hour” section

This preserves all of the original Overview content in a lighter editorial chapter below the hero.

### Measured site demand

Place the measured demand chart on a wide, transparent scenic band instead of a white card.

- Title: `Measured site demand`
- Green stepped line/fill for measured site draw.
- Fine coral dashed connection line: `connection limit 65 kW`.
- Direct legend: `measured site draw`, `over the connection`.
- Include original values: `peak so far 68.7 kW · 1 intervals over`.
- Axis range keeps the source meaning: `0`, `18`, `36`, `55`, `73` kW and time labels from `08:00` through `02:00`.

### Scheduler activity

Place this as a tall aligned typographic list with a subtle green signal line, not a boxed panel.

- `Schedules 1 session around the cleanest hours` — `2.0 kWh`
- `Holds the site under its connection` — `64 kW`
- `Serves the cars with least slack first` — `0 due < 2h`
- `Solving as a linear program` — `1.8 ms`
- Closing reassurance: `✓ All driver deadlines protected`

## Live charging scene

Use the actual car-park layout from the source screen but render it as a landscaped site plan over photography.

- Two gently curved rows of bays separated by a landscaped central lane.
- Preserve all ten identifiers: `1`–`10`.
- The selected-bay interaction reveals driver, current draw, remaining energy, deadline and latest dispatch cap in a small floating detail layer.
- Keep source instructional copy: `Point at a bay for its driver and current draw`.

## Sessions and exceptions

This is the operational close of the page, kept calm and compact.

- Title: `Sessions and exceptions`
- Sort marker: `deadline order`
- Empty state from the screenshot: `Nothing plugged in right now.`
- When sessions exist, each row shows driver, bay, energy needed/delivered, deadline, selected mode, current charging state and one meaningful warning only when a deadline is at risk.

## Live behaviour

- The hero energy field, site-load trace, charger lane and session rows respond to `plan.solved`, `charger.updated`, `session.updated`, `dispatch.sent`, `forecast.updated` and `clock.tick`.
- The page must never imply that it controls a car manually. Copy should always explain the safe result: shifting flexible energy while protecting the departure promise.
- The 24-hour energy arc should advance a subtle `now` marker; values already in the past fade slightly while the next clean window is gently emphasised.
- Charger nodes switch between `charging`, `waiting`, `clean window`, `urgent` and `available` from live OCPP/session data. State changes use a short line-flow or pulse, never a looping decorative animation.
- Hovering or tapping a charger reveals its driver, current kW/limit, remaining kWh, deadline and why it is charging or waiting. Clicking opens the existing session detail.
- The site-demand trace cross-fades to a newly solved plan and directly calls out only material changes: revised peak, avoided cap breach, or a deadline-risk change.
- The site selector replaces the entire scene, plan and evidence values for the selected site; it does not merely change the label.

# CleanGrid — Forecast page design

## Purpose

Make grid data emotionally legible: show the operator where energy will be clean, cheap and renewable enough for the scheduler to move flexible charging.

## Shared website shell

Use the common CleanGrid header exactly as defined in the Overview design. `Forecast` is active. The presentation must match the approved reference image: cinematic day-to-night panorama, large editorial headline, flowing white dividers, a small number of clear metrics, and no dashboard-card grid.

## Hero — “Read the weather. Move the energy.”

### Scenic backdrop

Use one continuous dawn-to-night panorama.

- Left: sunrise above solar arrays and rolling trees.
- Centre: bright lake valley and a sunlit clean-energy window.
- Right: blue evening, town lights, wind turbines and a moon.
- The image must feel like one place observed over a day, not a three-panel collage.

### Copy

- Eyebrow: `GRID FORECAST · NEXT 24 HOURS`
- Headline: `Read the weather. Move the energy.`
- Supporting copy: `Real-time grid insights for cleaner, cheaper charging. A brighter tomorrow, hour by hour.`
- Small handwritten-style scenic annotation: `Renewable today. Brighter tomorrow.`

### Integrated 24-hour forecast chart

Overlay the chart directly onto the lower half of the valley.

- Bright green solid area/line: `Renewable share`.
- Dark forest-green line: `Carbon intensity (gCO₂/kWh)`.
- Sun-gold dashed line: `Import price (£/kWh)`.
- Direct x-axis labels: `04:00`, `08:00`, `12:00`, `16:00`, `20:00`, `00:00`, `04:00`.
- Direct y-axis labels: `0%`, `25%`, `50%`, `75%`, `100%`.
- Highlight a translucent solar-green zone: `Best charging window · 11:00–15:00`.
- Explain the highlighted window with `78% renewable`, `£0.18/kWh`, and `94 gCO₂/kWh`.

The data must preserve the original forecast screen’s functional meaning:

- Title: `Next 24 hours`
- Status: `updated 04:37`
- Original source explanation: carbon comes from National Grid ESO; import price comes from Octopus Agile; renewable share combines measured carbon and Open-Meteo.

## Energy weather metric ribbon

Use a wide white flowing band, not separate KPI cards.

- `78% renewable`
- `£0.18/kWh`
- `94 gCO₂/kWh`

Each metric gets a small icon-like visual treatment: leaf, lightning, clean-energy leaf/line.

## Three forecast moments

Use three scenic crops separated only by flowing white forms.

### Solar lift

- Title: `Solar lift`
- Copy: `Rising solar generation from late morning brings cleaner, cheaper power.`
- Time: `11:00`

### Evening price peak

- Title: `Evening price peak`
- Copy: `Demand rises in the early evening, pushing prices higher and reducing the renewable share.`
- Time: `18:30`

### Wind returns overnight

- Title: `Wind returns overnight`
- Copy: `Stronger wind generation later in the night brings cleaner power back to the grid.`
- Time: `00:00+`

## Planning insight close

Use a broad scenic valley with the evening road curving into the distance.

- Eyebrow: `PLANNING INSIGHT`
- Headline: `Move 12 flexible cars before the 18:30 peak.`
- Supporting copy: `Shift charging into cleaner, cheaper hours and help balance the grid.`
- Action: `See charging schedules →`
- Supporting handwritten annotation: `Cleaner power, happier drivers.`

## Forecast source and live states

The original page’s planning-signal content must be available as a quiet expandable detail line below the chart:

- `Cleanest window` — `04:37–07:37 · 65% renewable`
- `Worst hour to draw` — `19:37 · 194 gCO₂/kWh`
- `Spread between best and worst` — `97 gCO₂/kWh`
- Explanatory note: flexible sessions move into the green band; drivers with earlier deadlines retain their own schedule.

Show forecast source name, last fetch time, and fallback state without making it the visual focus.

## Dynamic behaviour

- The forecast series updates from `forecast.updated`; its curve should morph to the new values while preserving a readable 24-hour time axis.
- Hovering or tapping any point on the landscape chart reveals the exact time, renewable share, forecast carbon intensity, import price and the scheduler recommendation for that moment.
- Selecting the highlighted clean window pins its full time range and reveals which current flexible sessions can safely move into it.
- A live `now` marker moves across the horizon. The active time’s values feed the header/live state without a page refresh.
- If a source is stale or synthetic fallback data is being used, show this plainly beside the source name and preserve the last-good curve rather than leaving the scene blank.
- The planning-insight action opens the Schedules page with the recommended window preselected.

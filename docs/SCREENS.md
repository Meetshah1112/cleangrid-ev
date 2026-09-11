# Driver app

Expo (React Native), talking to the same API as the dashboard. The app's job is to collect two
numbers the scheduler cannot guess, energy needed and deadline, and then to make the waiting
legible.

## 1. Sign in

Email one-time code through Supabase auth. Nothing else on the screen.

## 2. Home

- The site's next 24 hours as a carbon ribbon, the same colour scale the operator sees.
- One sentence that tells the driver what to do: "Cleanest window today is 11:00 to 15:00, 62%
  renewable."
- Scan a charger QR code or type its bay code.
- If a session is already running, this screen is replaced by the live session card.

## 3. Session setup

- **Energy**: a slider in kWh, or a target state of charge when the vehicle's battery size is
  known, which converts to kWh.
- **Deadline**: a time picker, defaulting to the driver's usual dwell time.
- **Mode**: four cards, each showing what it would mean for this session from
  `POST /sessions/preview`: estimated cost, CO2, renewable share and finish time.
- If the deadline cannot be met, the screen says so before the driver commits and offers the
  earliest time that can be met, or the most energy that fits. This is the 422 from the API,
  surfaced as a choice rather than an error.

## 4. Live session

- A Green Score dial, provisional until the session ends.
- One line of status in plain language: "Charging at 7.2 kW" or "Waiting for cleaner power,
  starts again at 11:15".
- The parked window as a timeline, coloured by grid carbon intensity, with the planned charging
  blocks drawn on it, so the driver can see why it is paused.
- kWh delivered against kWh needed, and "Guaranteed by 17:00".
- Actions: **Need it sooner** (move the deadline), **Charge now** (switch to fastest),
  **Stop**.

## 5. Session summary

- Final Green Score, kWh, cost, renewable share.
- CO2 avoided against charging on plug-in, with a plain-language equivalence.
- A "verified from meter data" badge, or a note that the figures are estimated when meter data was
  incomplete.
- Share.

## 6. History and impact

Session list with cumulative CO2 avoided and money saved.

## 7. Vehicles and settings

Vehicles (battery size, maximum charging power), default mode, default deadline.

## Green Score

The score is the session's energy-weighted carbon intensity placed inside the range of intensities
its own parked window offered. 100 means it used the cleanest power available to it; 0 means the
dirtiest. A window that offered no choice scores 100, because the driver could not have done
better. Renewable share is shown separately, because it answers a different question.

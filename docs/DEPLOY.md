# Deploying the demo

| Piece | Host | What it runs |
|---|---|---|
| Server and simulated chargers | Render (free web service) | `scripts/start.mjs`: the API, the OCPP gateway, one optimiser loop per site, and the simulator beside them |
| Storage | Supabase (Postgres) | Every write the server makes, read back when it starts |
| Operator console | Vercel | `apps/dashboard` |
| Driver app | An APK you install | `apps/driver`, built with `scripts/build-apk.mjs` |

## How people get in

There is no sign-up and no password. **Every account the scenarios seed has its own access code**,
and the code alone decides who signs in: nobody is shown a list of accounts to choose from.

| Account | Signs in on | Can |
|---|---|---|
| Network Operations | Operator console | See every site; re-plan, change a car's plan, accept or decline flex requests |
| A site's operator (Devika Trivedi, Gandhinagar, ...) | Operator console | The same, for their own site only |
| Regional Grid Control (grid operator) | Operator console | See every site and send Grid Flex requests; no site controls |
| A driver (Harsh Patel, ...) | Driver app | Their own car, sessions and preferences |

A driver's code is turned away by the console and an operator's by the app, each with a line saying
where it belongs. What an account may do is decided on the server from its stored role.

The codes are worked out from one secret, `ACCESS_CODE_SECRET`, so there is nothing to store. Print
them with the same secret the server has:

```bash
node --env-file=.env --import tsx scripts/access-codes.ts                   # every account
node --env-file=.env --import tsx scripts/access-codes.ts --account drv-harsh   # one
```

Hand each person their own code. Changing the secret changes every code at once, which is how to
lock everyone out after the event. Anyone holding the secret can work out every code, so it lives
only in Render and in your `.env`.

## Before you start

- **Rotate the Supabase keys** if they have ever been pasted anywhere outside `.env`: Project
  Settings → API → reset the `service_role` key, and Database → reset the database password. Put the
  new values in your local `.env`.
- **Make the access-code secret** and put it in your local `.env` as `ACCESS_CODE_SECRET`:

  ```bash
  node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
  ```

- The branch Render and Vercel deploy from must be pushed to GitHub.

## 1. Supabase

The schema is already applied to the existing project. For a new project, apply it once from your
machine:

```bash
node --env-file=.env scripts/migrate.mjs     # needs SUPABASE_DB_URL in .env
```

It is safe to run again; applied files are recorded in `schema_migrations` and skipped.

Values Render needs, from Project Settings → API:

- `SUPABASE_URL`: the project URL
- `SUPABASE_SERVICE_KEY`: the `service_role` key. It bypasses row-level security, so it only ever goes
  into the server's environment, never into the console or the app.

**Clear old demo sessions first.** Sessions recorded on a sped-up local clock carry dates days in
the future. On the real clock they would sit at the top of every history as if they had not
happened yet.

## 2. Render

1. Render dashboard → **New → Blueprint** → choose the repository. Render reads `render.yaml`.
2. It asks for the values marked `sync: false`:

   | Variable | Value |
   |---|---|
   | `ACCESS_CODE_SECRET` | the secret from your `.env` |
   | `SUPABASE_URL` | from step 1 |
   | `SUPABASE_SERVICE_KEY` | from step 1 |
   | `CORS_ORIGINS` | leave empty for now; set it after step 3 |

   `OCPP_AUTH_KEY` is generated for you. Everything else is set by the blueprint.
3. Deploy. The first build takes a few minutes. When it is live, open
   `https://<service>.onrender.com/health`: it should say `"status":"ok"`, `"storage":{"kind":"supabase"}`,
   and after half a minute `chargersOnline` above zero.

What the blueprint chooses, and why:

- **Real time** (`SIM_START=real`, `SIM_TIME_SCALE=1`) with the scenarios replayed on today's date
  (`SIM_REBASE=today`). A sped-up clock restarts at the same instant on every deploy, so stored
  sessions would land in the future and then in the past. When the server starts mid-afternoon, the
  cars that already left are skipped and the ones still parked plug in.
- **Access checks everywhere a stranger could reach**: the REST API and console sockets need an
  account's code (and a console socket only opens for an operator allowed at that site); chargers
  need `OCPP_AUTH_KEY` (OCPP 1.6 security profile 1, HTTP Basic). The server refuses to start with
  access codes on and no charger key. Wrong codes are limited to 20 per address every 10 minutes,
  and `TRUST_PROXY=1` makes that address the visitor's rather than Render's proxy. The demo clock
  cannot be changed through the API.
- **The free plan sleeps** after 15 minutes without visitors, and the first request after that waits
  up to a minute while it starts. The console and the app say so while they wait. To keep it awake
  during judging, point an uptime monitor at `/health` every 10 minutes. One always-on service
  fits inside the free monthly hours.

## 3. Vercel (operator console)

1. Vercel → **Add New → Project** → import the repository.
2. **Root Directory**: `apps/dashboard`. Framework preset: Next.js (detected).
3. Environment variable: `NEXT_PUBLIC_API_URL` = `https://<service>.onrender.com` (a trailing slash
   is ignored). It is read at build time, so changing it means redeploying.
4. Deploy, then copy the console's address back into Render as `CORS_ORIGINS`
   (e.g. `https://cleangrid-ev.vercel.app`; comma separate several) and let Render redeploy.

Open the console and enter an operator's or the grid operator's code. The round badge at the top
right signs out.

## 4. Driver app (APK)

```bash
node scripts/build-apk.mjs --api https://<service>.onrender.com --abis arm64-v8a
```

The address is baked into the build. With a phone attached over USB the script installs it; the
APK is also left at `apps/driver/android/app/build/outputs/apk/release/app-release.apk` to share.
In the app, enter a driver's code; Profile → **Sign out** goes back to the code screen.

If the phone has no route to the server at all, the app offers the built-in demo data instead, and
labels every screen with it.

## Checking a deployment

```bash
B=https://<service>.onrender.com
curl -s $B/health                                     # open; status and storage
curl -s $B/me                                         # 401 access_code_required
curl -s $B/me -H "x-access-code: <a driver's code>"   # that driver, and nobody else
```

## Running the hosted setup locally

`scripts/start.mjs` is what Render runs, and it runs the same on a laptop:

```bash
PORT=8095 REPO=memory DEV_AUTH=0 ACCESS_CODE_SECRET=laptop-only-secret-never-deploy-this \
OCPP_AUTH_KEY=laptop-only-charger-key SIM_START=real SIM_TIME_SCALE=1 SIM_REBASE=today \
node scripts/start.mjs
```

A secret written in this repository gives every code away to anyone who reads it, so the deployed
server always gets a freshly generated one.

Leave out `ACCESS_CODE_SECRET` and `OCPP_AUTH_KEY` (with `DEV_AUTH=1`) for the open development mode,
where the console signs in with any code as Network Operations.

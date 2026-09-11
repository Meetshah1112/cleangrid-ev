-- CleanGrid EV schema.
-- One site, its chargers, the drivers who use them, and the plans that decide who charges when.
-- Times are timestamptz; the application works in epoch milliseconds and converts at the edge.

create extension if not exists "pgcrypto";

create type charging_mode as enum ('cheapest', 'greenest', 'fastest', 'balanced');
create type user_role as enum ('driver', 'operator', 'grid_operator');
create type session_status as enum ('pending', 'active', 'complete', 'aborted');
create type session_source as enum ('app', 'rfid', 'remote');
create type connector_status as enum (
  'Available', 'Preparing', 'Charging', 'SuspendedEVSE', 'SuspendedEV',
  'Finishing', 'Reserved', 'Unavailable', 'Faulted'
);
create type plan_status as enum ('complete', 'shortfall');
create type solver_name as enum ('lp', 'greedy');
create type dispatch_status as enum ('Accepted', 'Rejected', 'NotSupported', 'Timeout', 'Offline', 'Error');
create type flex_status as enum ('requested', 'accepted', 'declined', 'active', 'completed', 'cancelled');
create type signal_kind as enum ('carbon', 'price', 'renewable', 'actual_carbon');

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Europe/London',
  lat double precision not null,
  lng double precision not null,
  -- Distribution region letter used to pick a regional tariff.
  region_code text not null default 'C',
  grid_connection_kw numeric(8, 2) not null check (grid_connection_kw > 0),
  demand_charge_per_kw_month numeric(8, 2) not null default 0 check (demand_charge_per_kw_month >= 0),
  currency char(3) not null default 'GBP',
  default_mode charging_mode not null default 'balanced',
  -- Non-EV building load by local hour of day, 24 values in kW.
  base_load_kw numeric(8, 2)[] not null check (array_length(base_load_kw, 1) = 24),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role user_role not null default 'driver',
  display_name text not null,
  site_id uuid references sites (id) on delete set null,
  -- RFID card or app token presented to the charger; links OCPP transactions to this person.
  id_tag text unique,
  default_mode charging_mode not null default 'balanced',
  default_dwell_hours numeric(4, 1) not null default 8 check (default_dwell_hours > 0),
  default_energy_kwh numeric(6, 2) not null default 20 check (default_energy_kwh > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_site_idx on profiles (site_id) where site_id is not null;

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references profiles (id) on delete cascade,
  label text not null,
  battery_kwh numeric(6, 2) not null check (battery_kwh > 0),
  max_charge_kw numeric(6, 2) not null check (max_charge_kw > 0),
  created_at timestamptz not null default now()
);
create index vehicles_driver_idx on vehicles (driver_id);

create table chargers (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id) on delete cascade,
  -- Charge point identity: the last path segment of its OCPP WebSocket URL.
  ocpp_identity text not null unique,
  label text not null,
  max_power_kw numeric(6, 2) not null check (max_power_kw > 0),
  min_power_kw numeric(6, 2) not null default 1.4 check (min_power_kw >= 0),
  connector_count int not null default 1 check (connector_count between 1 and 8),
  online boolean not null default false,
  -- Set when the charger will not honour charging profiles; the optimiser then plans around it.
  uncontrolled boolean not null default false,
  vendor text,
  model text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index chargers_site_idx on chargers (site_id);

create table connectors (
  charger_id uuid not null references chargers (id) on delete cascade,
  connector_id int not null check (connector_id >= 0),
  status connector_status not null default 'Unavailable',
  error_code text not null default 'NoError',
  current_session_id uuid,
  updated_at timestamptz not null default now(),
  primary key (charger_id, connector_id)
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id) on delete cascade,
  charger_id uuid not null references chargers (id) on delete cascade,
  connector_id int not null default 1,
  driver_id uuid references profiles (id) on delete set null,
  vehicle_id uuid references vehicles (id) on delete set null,
  id_tag text not null,
  -- OCPP transaction id, assigned when the charger reports StartTransaction.
  transaction_id bigint unique,
  source session_source not null default 'app',
  status session_status not null default 'pending',
  mode charging_mode not null default 'balanced',
  plugged_in_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  -- True while the deadline is the driver's default rather than a deliberate choice.
  deadline_is_default boolean not null default false,
  unplugged_at timestamptz,
  energy_needed_kwh numeric(7, 3) not null check (energy_needed_kwh >= 0),
  energy_delivered_kwh numeric(7, 3) not null default 0 check (energy_delivered_kwh >= 0),
  -- Lower of charger rating and vehicle limit.
  max_power_kw numeric(6, 2) not null check (max_power_kw > 0),
  meter_start_wh bigint,
  last_meter_wh bigint,
  current_power_kw numeric(6, 2) not null default 0,
  -- Last limit dispatched to the charger.
  limit_kw numeric(6, 2),
  deadline_risk boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (deadline_at > plugged_in_at)
);
create index sessions_site_status_idx on sessions (site_id, status);
create index sessions_driver_idx on sessions (driver_id, plugged_in_at desc);
create index sessions_charger_idx on sessions (charger_id, plugged_in_at desc);
create index sessions_active_idx on sessions (site_id) where status = 'active';

alter table connectors
  add constraint connectors_session_fk foreign key (current_session_id) references sessions (id) on delete set null;

create table meter_readings (
  id bigserial primary key,
  session_id uuid not null references sessions (id) on delete cascade,
  recorded_at timestamptz not null,
  -- Energy.Active.Import.Register, monotonic within a transaction.
  energy_wh bigint not null check (energy_wh >= 0),
  power_w int not null default 0,
  soc numeric(4, 3) check (soc between 0 and 1)
);
create index meter_readings_session_idx on meter_readings (session_id, recorded_at);

create table grid_signals (
  site_id uuid not null references sites (id) on delete cascade,
  kind signal_kind not null,
  slot_start timestamptz not null,
  value numeric(10, 4) not null,
  source text not null,
  fetched_at timestamptz not null default now(),
  primary key (site_id, kind, slot_start)
);
create index grid_signals_lookup_idx on grid_signals (site_id, kind, slot_start desc);

create table plans (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id) on delete cascade,
  solved_at timestamptz not null default now(),
  -- What prompted this solve: a plug-in, a deadline change, a flex request, the interval.
  trigger text not null,
  horizon_start timestamptz not null,
  slot_minutes int not null default 15,
  slots int not null default 96,
  solver solver_name not null,
  status plan_status not null,
  fallback_reason text,
  solve_ms numeric(8, 2) not null default 0,
  peak_kw numeric(8, 2) not null default 0,
  -- { energyKwh, cost, co2Kg, objective } and the per-session shortfalls.
  totals jsonb not null default '{}'::jsonb,
  shortfalls jsonb not null default '[]'::jsonb,
  site_load_kw numeric(8, 2)[] not null default '{}',
  base_load_kw numeric(8, 2)[] not null default '{}',
  cap_kw numeric(8, 2)[] not null default '{}',
  carbon_g_per_kwh numeric(8, 2)[] not null default '{}',
  price_per_kwh numeric(8, 4)[] not null default '{}',
  renewable_share numeric(5, 4)[] not null default '{}'
);
create index plans_site_idx on plans (site_id, solved_at desc);

create table plan_schedules (
  plan_id uuid not null references plans (id) on delete cascade,
  session_id uuid not null references sessions (id) on delete cascade,
  -- Power for each slot of the plan's grid, kW.
  power_kw numeric(6, 2)[] not null,
  primary key (plan_id, session_id)
);
create index plan_schedules_session_idx on plan_schedules (session_id);

create table dispatch_log (
  id bigserial primary key,
  plan_id uuid references plans (id) on delete set null,
  site_id uuid not null references sites (id) on delete cascade,
  charger_id uuid not null references chargers (id) on delete cascade,
  connector_id int not null default 1,
  session_id uuid references sessions (id) on delete set null,
  sent_at timestamptz not null default now(),
  limit_w int not null,
  profile jsonb not null,
  status dispatch_status not null,
  error text
);
create index dispatch_log_charger_idx on dispatch_log (charger_id, sent_at desc);
create index dispatch_log_site_idx on dispatch_log (site_id, sent_at desc);

create table flex_events (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id) on delete cascade,
  requested_by uuid references profiles (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  cap_kw numeric(8, 2) not null check (cap_kw >= 0),
  reason text,
  status flex_status not null default 'requested',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (ends_at > starts_at)
);
create index flex_events_site_idx on flex_events (site_id, status);

create table session_reports (
  session_id uuid primary key references sessions (id) on delete cascade,
  energy_kwh numeric(7, 3) not null,
  cost numeric(9, 4) not null,
  co2_kg numeric(9, 4) not null,
  renewable_share numeric(5, 4) not null,
  avg_carbon_g_per_kwh numeric(8, 2) not null,
  -- Counterfactual: the same energy at full power from the moment of plug-in.
  baseline_cost numeric(9, 4) not null,
  baseline_co2_kg numeric(9, 4) not null,
  avoided_co2_kg numeric(9, 4) not null,
  cost_saved numeric(9, 4) not null,
  green_score int not null check (green_score between 0 and 100),
  window_min_carbon_g_per_kwh numeric(8, 2) not null,
  window_max_carbon_g_per_kwh numeric(8, 2) not null,
  -- True when the figures come from meter readings rather than from the plan.
  verified boolean not null default false,
  carbon_basis text not null default 'forecast' check (carbon_basis in ('actual', 'forecast')),
  computed_at timestamptz not null default now()
);

create trigger sites_touch before update on sites for each row execute function public.touch_updated_at();
create trigger profiles_touch before update on profiles for each row execute function public.touch_updated_at();
create trigger chargers_touch before update on chargers for each row execute function public.touch_updated_at();
create trigger sessions_touch before update on sessions for each row execute function public.touch_updated_at();

-- The dashboard follows these tables over Supabase realtime.
alter publication supabase_realtime add table sessions;
alter publication supabase_realtime add table chargers;
alter publication supabase_realtime add table connectors;
alter publication supabase_realtime add table plans;
alter publication supabase_realtime add table session_reports;
alter publication supabase_realtime add table flex_events;

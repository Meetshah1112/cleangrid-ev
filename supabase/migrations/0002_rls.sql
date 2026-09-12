-- Row level security.
-- Drivers see their own charging and nothing else. Operators see their site.
-- Grid operators see site-level aggregates and may ask for flexibility, never personal data.
-- The backend uses the service role and bypasses all of this.
--
-- A profile's primary key is its readable id ("drv-amara"), so nothing here compares against
-- auth.uid() directly: every check goes through current_profile_id(), which resolves the signed-in
-- auth user to their profile row. A seeded profile with no auth_user_id simply matches nobody.

create or replace function public.current_profile_id() returns text
  language sql stable security definer set search_path = public as $$
  select id from profiles where auth_user_id = auth.uid();
$$;

create or replace function public.current_role_of_caller() returns user_role
  language sql stable security definer set search_path = public as $$
  select role from profiles where auth_user_id = auth.uid();
$$;

create or replace function public.current_site_of_caller() returns text
  language sql stable security definer set search_path = public as $$
  select site_id from profiles where auth_user_id = auth.uid();
$$;

create or replace function public.is_operator_of(target_site text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where auth_user_id = auth.uid() and role = 'operator' and site_id = target_site
  );
$$;

alter table sites enable row level security;
alter table profiles enable row level security;
alter table vehicles enable row level security;
alter table chargers enable row level security;
alter table connectors enable row level security;
alter table sessions enable row level security;
alter table meter_readings enable row level security;
alter table grid_signals enable row level security;
alter table plans enable row level security;
alter table plan_schedules enable row level security;
alter table dispatch_log enable row level security;
alter table flex_events enable row level security;
alter table session_reports enable row level security;

-- Sites and chargers are readable by any signed-in user: a driver needs to know where they are
-- plugging in and how clean the site is.
create policy sites_read on sites for select to authenticated using (true);
create policy sites_update on sites for update to authenticated
  using (public.is_operator_of(id)) with check (public.is_operator_of(id));

create policy chargers_read on chargers for select to authenticated using (true);
create policy chargers_update on chargers for update to authenticated
  using (public.is_operator_of(site_id)) with check (public.is_operator_of(site_id));

create policy connectors_read on connectors for select to authenticated using (true);
create policy grid_signals_read on grid_signals for select to authenticated using (true);

-- Profiles: your own row, plus the drivers at a site you operate.
create policy profiles_read_self on profiles for select to authenticated
  using (id = public.current_profile_id() or public.is_operator_of(site_id));
create policy profiles_update_self on profiles for update to authenticated
  using (id = public.current_profile_id()) with check (id = public.current_profile_id());

create policy vehicles_owner on vehicles for all to authenticated
  using (driver_id = public.current_profile_id()) with check (driver_id = public.current_profile_id());

-- Sessions: a driver's own, or any at a site you operate.
create policy sessions_read on sessions for select to authenticated
  using (driver_id = public.current_profile_id() or public.is_operator_of(site_id));
create policy sessions_update on sessions for update to authenticated
  using (driver_id = public.current_profile_id() or public.is_operator_of(site_id))
  with check (driver_id = public.current_profile_id() or public.is_operator_of(site_id));

-- RLS controls which rows; column grants control which fields a driver may change.
-- Everything else (energy delivered, meter registers, status) is the server's to write.
revoke update on sessions from authenticated;
grant update (deadline_at, energy_needed_kwh, mode, deadline_is_default) on sessions to authenticated;

create policy meter_readings_read on meter_readings for select to authenticated
  using (
    exists (
      select 1 from sessions s
      where s.id = meter_readings.session_id
        and (s.driver_id = public.current_profile_id() or public.is_operator_of(s.site_id))
    )
  );

create policy session_reports_read on session_reports for select to authenticated
  using (
    exists (
      select 1 from sessions s
      where s.id = session_reports.session_id
        and (s.driver_id = public.current_profile_id() or public.is_operator_of(s.site_id))
    )
  );

-- Plans and dispatch are operational detail: operators only.
create policy plans_read on plans for select to authenticated using (public.is_operator_of(site_id));
create policy plan_schedules_read on plan_schedules for select to authenticated
  using (exists (select 1 from plans p where p.id = plan_schedules.plan_id and public.is_operator_of(p.site_id)));
create policy dispatch_log_read on dispatch_log for select to authenticated using (public.is_operator_of(site_id));

-- Flex: grid operators raise requests and watch them; site operators answer their own.
create policy flex_read on flex_events for select to authenticated
  using (public.is_operator_of(site_id) or public.current_role_of_caller() = 'grid_operator');
create policy flex_insert on flex_events for insert to authenticated
  with check (public.current_role_of_caller() = 'grid_operator' and requested_by = public.current_profile_id());
create policy flex_respond on flex_events for update to authenticated
  using (public.is_operator_of(site_id)) with check (public.is_operator_of(site_id));

#!/usr/bin/env node
/**
 * Reads back what the server wrote to Postgres. This is the other half of the mirror: the server
 * only ever writes there, so nothing proves the data landed until something outside the server
 * reads it. Run with: node --env-file=.env scripts/verify-supabase.mjs
 */

import pg from 'pg';

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30_000,
});

const TABLES = [
  'sites',
  'chargers',
  'connectors',
  'profiles',
  'vehicles',
  'sessions',
  'meter_readings',
  'grid_signals',
  'plans',
  'plan_schedules',
  'dispatch_log',
  'session_reports',
  'flex_events',
];

await client.connect();

console.log('row counts');
for (const table of TABLES) {
  const { rows } = await client.query(`select count(*)::int as n from ${table}`);
  console.log(`  ${table.padEnd(16)} ${String(rows[0].n).padStart(7)}`);
}

const sites = await client.query(`
  select s.name, s.country, s.currency, s.grid_connection_kw,
         count(distinct c.id)::int as chargers,
         count(distinct se.id)::int as sessions
  from sites s
  left join chargers c on c.site_id = s.id
  left join sessions se on se.site_id = s.id
  group by s.id, s.name, s.country, s.currency, s.grid_connection_kw
  order by s.name
`);
console.log('\nsites');
for (const row of sites.rows) {
  console.log(
    `  ${row.name} (${row.country}, ${row.currency}) ${row.grid_connection_kw} kW · ` +
      `${row.chargers} chargers · ${row.sessions} sessions`,
  );
}

const plans = await client.query(`
  select site_id, solver, status, peak_kw, solve_ms, solved_at
  from plans order by solved_at desc limit 5
`);
console.log('\nlatest plans');
for (const row of plans.rows) {
  console.log(
    `  ${row.solved_at.toISOString()} ${row.site_id.padEnd(18)} ${row.solver} ${row.status} ` +
      `peak ${Number(row.peak_kw).toFixed(1)} kW in ${Number(row.solve_ms).toFixed(0)} ms`,
  );
}

const reports = await client.query(`
  select r.session_id, r.energy_kwh, r.avoided_co2_kg, r.cost_saved, r.green_score, r.verified, r.carbon_basis
  from session_reports r order by r.computed_at desc limit 5
`);
console.log('\nlatest session reports');
if (reports.rowCount === 0) console.log('  none yet (sessions are still running)');
for (const row of reports.rows) {
  console.log(
    `  ${row.session_id.slice(0, 8)} ${Number(row.energy_kwh).toFixed(1)} kWh · ` +
      `${Number(row.avoided_co2_kg).toFixed(2)} kg avoided · saved ${Number(row.cost_saved).toFixed(2)} · ` +
      `score ${row.green_score} · ${row.verified ? 'verified' : 'estimated'} (${row.carbon_basis})`,
  );
}

const meters = await client.query(`
  select s.id, s.status, count(m.session_id)::int as readings, max(m.energy_wh)::int as last_wh
  from sessions s left join meter_readings m on m.session_id = s.id
  group by s.id, s.status order by readings desc limit 5
`);
console.log('\nbusiest sessions by meter readings');
for (const row of meters.rows) {
  console.log(`  ${row.id.slice(0, 8)} ${row.status.padEnd(9)} ${row.readings} readings, last ${row.last_wh ?? 0} Wh`);
}

const rls = await client.query(`
  select tablename, count(*)::int as policies
  from pg_policies where schemaname = 'public'
  group by tablename order by tablename
`);
console.log(`\nRLS policies on ${rls.rowCount} tables: ${rls.rows.map((r) => `${r.tablename}(${r.policies})`).join(' ')}`);

await client.end();

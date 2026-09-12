#!/usr/bin/env node
/**
 * Applies supabase/migrations/*.sql in filename order against SUPABASE_DB_URL.
 *
 * Each file runs inside one transaction and is recorded in schema_migrations, so a second run is a
 * no-op and a failed file leaves nothing behind. Pass --reset to drop the public schema first;
 * that is destructive and only sensible while the schema is still being shaped.
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'supabase', 'migrations');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Put it in ${join(root, '.env')} and run with --env-file=.env`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const reset = process.argv.includes('--reset');
  const client = new pg.Client({
    connectionString: requireEnv('SUPABASE_DB_URL'),
    ssl: { rejectUnauthorized: false },
    // A cold Supabase project can take a while to accept the first connection.
    connectionTimeoutMillis: 30_000,
    statement_timeout: 120_000,
  });

  await client.connect();
  console.log('connected');

  if (reset) {
    console.log('resetting public schema');
    await client.query('drop schema if exists public cascade');
    await client.query('create schema public');
    await client.query('grant usage on schema public to anon, authenticated, service_role');
    await client.query('grant all on schema public to postgres, service_role');
    // Recreating the schema drops Supabase's default privileges with it. Tables, sequences and
    // functions all need putting back, or PostgREST cannot insert a row that uses a sequence.
    for (const kind of ['tables', 'sequences', 'functions']) {
      await client.query(
        `alter default privileges in schema public grant all on ${kind} to postgres, anon, authenticated, service_role`,
      );
    }
  }

  await client.query(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const applied = new Set(
    (await client.query('select name from schema_migrations')).rows.map((row) => row.name),
  );
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip  ${file} (already applied)`);
      continue;
    }
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    process.stdout.write(`apply ${file} ... `);
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations (name) values ($1)', [file]);
      await client.query('commit');
      console.log('ok');
    } catch (error) {
      await client.query('rollback');
      console.log('FAILED');
      console.error(`\n${error.message}`);
      if (error.position) {
        const upto = sql.slice(0, Number(error.position));
        console.error(`at line ${upto.split('\n').length}: ${upto.split('\n').at(-1)}`);
      }
      await client.end();
      process.exit(1);
    }
  }

  const tables = await client.query(`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  `);
  console.log(`\n${tables.rowCount} tables: ${tables.rows.map((row) => row.table_name).join(', ')}`);
  await client.end();
}

await main();

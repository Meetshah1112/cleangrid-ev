/**
 * Prints the access code of every account the demo seeds, to hand out one person at a time.
 *
 *   node --env-file=.env --import tsx scripts/access-codes.ts [--account drv-harsh]
 *
 * Needs the same ACCESS_CODE_SECRET the server runs with, and SCENARIO too if the server was given
 * its own list. The codes come from the secret, so this prints exactly what the server will accept.
 * Treat the output like the secret: anyone holding a code is signed in as that account.
 */

import { DEFAULT_SCENARIOS, SystemClock, accessCodeFor, type UserProfile } from '@cleangrid/shared';
import { createMemoryRepositories } from '../apps/server/src/repo/memory';
import { loadScenarioFiles, seedFromScenario, seedNetworkOperator } from '../apps/server/src/seed/scenario';

const WHERE = { operator: 'Operator console', grid_operator: 'Operator console', driver: 'Driver app' } as const;
const ROLE = { operator: 'operator', grid_operator: 'grid operator', driver: 'driver' } as const;

async function main(): Promise<void> {
  const secret = process.env.ACCESS_CODE_SECRET?.trim();
  if (!secret) {
    console.error('ACCESS_CODE_SECRET is not set. Put the server\'s value in .env and run with --env-file=.env');
    process.exit(1);
  }
  const only = process.argv.includes('--account') ? process.argv[process.argv.indexOf('--account') + 1] : undefined;

  const repos = createMemoryRepositories();
  const scenarios = await loadScenarioFiles(process.env.SCENARIO ?? DEFAULT_SCENARIOS);
  for (const scenario of scenarios) await seedFromScenario(repos, scenario, new SystemClock());
  await seedNetworkOperator(repos);
  const siteNames = new Map(scenarios.map((scenario) => [scenario.site.id, scenario.site.name]));

  const order = { operator: 0, grid_operator: 1, driver: 2 };
  const accounts = (await repos.profiles.list())
    .filter((profile) => only === undefined || profile.id === only)
    .sort((a, b) => order[a.role] - order[b.role] || (a.siteId ?? '').localeCompare(b.siteId ?? '') || a.displayName.localeCompare(b.displayName));
  if (accounts.length === 0) {
    console.error(only ? `No account called ${only}.` : 'No accounts found.');
    process.exit(1);
  }

  const row = (profile: UserProfile) => ({
    code: accessCodeFor(secret, profile.id),
    name: profile.displayName,
    role: ROLE[profile.role],
    site: profile.siteId ? (siteNames.get(profile.siteId) ?? profile.siteId) : 'every site',
    'sign in on': WHERE[profile.role],
    account: profile.id,
  });
  console.table(accounts.map(row));
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});

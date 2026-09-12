/**
 * Which sites the demo network runs, in one place.
 *
 * The server seeds these and the charger simulator dials into them, so the two lists have to
 * agree: a charger that boots for a site the server never seeded is refused, and a site with no
 * chargers sits empty. Keeping one constant means they cannot drift apart by a typo in an
 * argument.
 *
 * The order matters. The first entry is the default site — what the driver app opens on and what
 * the console selects first — so Gandhinagar leads.
 */
export const DEFAULT_SCENARIOS = [
  './scenarios/gandhinagar-secretariat.json',
  './scenarios/ahmedabad-ashram-road.json',
  './scenarios/vadodara-alkapuri-depot.json',
  './scenarios/surat-textile-park.json',
  './scenarios/day-one.json',
].join(',');

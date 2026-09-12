#!/usr/bin/env node
/**
 * Serves the built APK over the LAN so a phone can install it without a working USB connection.
 *
 *   node scripts/serve-apk.mjs [--port 8099]
 *
 * Android blocks installs from unknown sources by default, so the landing page says so rather than
 * leaving someone staring at a refused download.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APK = join(root, 'apps', 'driver', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const PORT = Number(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 8099);

if (!existsSync(APK)) {
  console.error(`No APK at ${APK}. Run scripts/build-apk.mjs first.`);
  process.exit(1);
}

const page = (bytes) => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CleanGrid EV</title>
<style>
  body{font:16px/1.55 system-ui;background:#eef5f0;color:#0f2a20;margin:0;padding:48px 24px;text-align:center}
  h1{font-size:1.4rem;margin:0 0 6px}
  p{color:#5f7d70;font-size:.9rem;max-width:34ch;margin:10px auto}
  a{display:inline-block;margin-top:22px;background:#1f8a5c;color:#fff;text-decoration:none;
    padding:16px 30px;border-radius:14px;font-weight:600}
</style>
<h1>CleanGrid EV</h1>
<p>Driver app &middot; ${(bytes / 1048576).toFixed(1)} MB</p>
<a href="/cleangrid.apk">Download APK</a>
<p>Android will warn that this is not from the Play Store. Allow installs for your browser once, then open the
downloaded file.</p>`;

createServer((request, response) => {
  const { size } = statSync(APK);
  if (request.url === '/cleangrid.apk') {
    response.writeHead(200, {
      'content-type': 'application/vnd.android.package-archive',
      'content-length': size,
      'content-disposition': 'attachment; filename="cleangrid.apk"',
    });
    createReadStream(APK).pipe(response);
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(page(size));
}).listen(PORT, '0.0.0.0', () => console.log(`apk server on :${PORT}`));

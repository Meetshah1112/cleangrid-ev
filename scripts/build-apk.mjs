#!/usr/bin/env node
/**
 * Builds an installable release APK of the driver app and, if a phone is attached, installs it.
 *
 *   node scripts/build-apk.mjs --api http://192.168.1.20:8095 [--driver drv-amara] [--site site-riverside]
 *                              [--abis arm64-v8a,x86_64]
 *
 * The APK is standalone: there is no Metro to fetch JavaScript from, so the API address is compiled
 * into the bundle. That is the one thing you must get right — a phone cannot reach 127.0.0.1 on your
 * machine, so pass the LAN address the phone can see.
 *
 * Three things this encodes, each learned by getting it wrong:
 *  - one CPU architecture, not four. Building all of them ran the NDK's clang out of memory.
 *    Phones are arm64-v8a; add x86_64 with --abis when the target is an emulator, or the app
 *    dies on launch with "couldn't find DSO to load: libreactnative.so".
 *  - the JDK that ships with Android Studio, because `java` is usually not on PATH on Windows.
 *  - cleartext HTTP must be declared in app.json (expo-build-properties), or a release build
 *    refuses to talk to a plain-HTTP server while Expo Go happily would.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const driver = join(root, 'apps', 'driver');
const android = join(driver, 'android');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

/** The Android SDK and a JDK, in the places Windows and macOS actually put them. */
function toolchain() {
  const home = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk');
  const java =
    process.env.JAVA_HOME ??
    ['C:/Program Files/Android/Android Studio/jbr', '/Applications/Android Studio.app/Contents/jbr/Contents/Home'].find(
      existsSync,
    );
  if (!existsSync(home)) throw new Error(`Android SDK not found at ${home}. Set ANDROID_HOME.`);
  if (!java) throw new Error('No JDK found. Install Android Studio or set JAVA_HOME.');
  return { home, java };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: true, ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const api = arg('api');
if (!api) {
  console.error('--api is required, e.g. --api http://10.0.0.5:8095');
  console.error('A phone cannot reach 127.0.0.1 on this machine; give it the LAN address.');
  process.exit(1);
}

const { home, java } = toolchain();
const env = {
  ...process.env,
  ANDROID_HOME: home,
  ANDROID_SDK_ROOT: home,
  JAVA_HOME: java,
  PATH: `${join(java, 'bin')}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`,
  EXPO_PUBLIC_API_URL: api,
  EXPO_PUBLIC_DRIVER_ID: arg('driver', 'drv-amara'),
  EXPO_PUBLIC_SITE_ID: arg('site', 'site-riverside'),
  // The C++ codegen compile is the memory-hungry part; two jobs keeps it inside a laptop.
  CMAKE_BUILD_PARALLEL_LEVEL: '2',
  GRADLE_OPTS: '-Dorg.gradle.jvmargs=-Xmx3072m',
};

console.log(`building against ${api}`);
run('npx', ['expo', 'prebuild', '--platform', 'android'], { cwd: driver, env });

// The wrapper lives in the working directory, which is not on PATH on Windows.
const gradlew = join(android, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const abis = arg('abis', 'arm64-v8a');
console.log(`architectures: ${abis}`);
run(gradlew, ['assembleRelease', '--no-daemon', '--max-workers=2', `-PreactNativeArchitectures=${abis}`], {
  cwd: android,
  env,
});

const apk = join(android, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
console.log(`\nAPK: ${apk}  (${(statSync(apk).size / 1048576).toFixed(1)} MB)`);

// Install only if exactly one device is attached and authorised.
const adb = join(home, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
try {
  const devices = execFileSync(adb, ['devices'], { encoding: 'utf8' })
    .split('\n')
    .slice(1)
    .filter((line) => line.trim().endsWith('device'));
  if (devices.length === 1) {
    console.log('installing to the attached phone');
    run(adb, ['install', '-r', apk], { env });
  } else if (devices.length === 0) {
    console.log('no authorised device attached; copy the APK across by hand');
  } else {
    console.log(`${devices.length} devices attached; install by hand with: adb -s <serial> install -r "${apk}"`);
  }
} catch {
  console.log('adb not usable; copy the APK across by hand');
}

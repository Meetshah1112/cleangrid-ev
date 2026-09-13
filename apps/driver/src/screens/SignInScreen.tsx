import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { accountFor, serverNow } from '../api';
import type { DriverAccess } from '../access';
import { fonts, theme, type } from '../theme';
import { Valley } from '../components/Valley';
import { Button, Notice, Screen, Section } from '../components/ui';

const HOUR = 3_600_000;
/** How long a check may take before the driver is told the server is probably waking up. */
const SLOW_CHECK_MS = 4_000;

/**
 * The way into the demo: the driver's own access code, and nothing else. The code says which driver
 * is signing in, so there is no list of people to pick from, and one driver's code opens their car
 * and no one else's.
 *
 * If no server can be reached at all, the driver can still look around on the built-in snapshot,
 * which the app labels as demo data on every screen.
 */
export function SignInScreen({ onSignedIn }: { onSignedIn: (access: DriverAccess) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; offline: boolean } | null>(null);
  const [slow, setSlow] = useState(false);
  const nowMs = serverNow();

  useEffect(() => {
    if (!busy) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), SLOW_CHECK_MS);
    return () => clearTimeout(timer);
  }, [busy]);

  const signIn = (): void => {
    const trimmed = code.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    void accountFor(trimmed)
      .then((account) => {
        if (account.role !== 'driver') {
          setError({ message: 'That code is for the operator console. Drivers have codes of their own.', offline: false });
          return;
        }
        onSignedIn({ code: trimmed, driverId: account.id, driverName: account.displayName, siteId: account.siteId });
      })
      .catch((caught: Error & { code?: string }) => setError({ message: caught.message, offline: caught.code === 'offline' }))
      .finally(() => setBusy(false));
  };

  const hero = (
    <Valley startMs={Math.floor(nowMs / HOUR) * HOUR - 4 * HOUR} spanMs={20 * HOUR} nowMs={nowMs} height={300} horizon={0.62}>
      {(geometry) => (
        <View style={styles.heroCopy}>
          <Text style={[type.eyebrow, { color: geometry.tone === 'light' ? theme.onForestMuted : theme.stone }]}>CleanGrid EV</Text>
          <Text style={[type.display, geometry.tone === 'light' && { color: theme.onForest }]} accessibilityRole="header" textBreakStrategy="balanced">
            Charge when the grid is clean.
          </Text>
        </View>
      )}
    </Valley>
  );

  return (
    <Screen hero={hero}>
      <Section label="Access code" first>
        <Text style={[type.body, styles.lede]}>{"This is a live demo. Enter the access code you were given; it opens that driver's car and plan."}</Text>
        <TextInput
          style={styles.input}
          value={code}
          onChangeText={setCode}
          onSubmitEditing={signIn}
          placeholder="XXXX-XXXX-XXXX"
          placeholderTextColor={theme.pebble}
          autoCapitalize="characters"
          autoCorrect={false}
          secureTextEntry
          returnKeyType="go"
          editable={!busy}
          accessibilityLabel="Access code"
        />
        {error ? (
          <View style={styles.gap}>
            <Notice tone={error.offline ? 'warn' : 'risk'}>{error.message}</Notice>
          </View>
        ) : null}
        {slow ? (
          <Text style={[type.caption, styles.gap]} accessibilityLiveRegion="polite">
            Waking the demo server. It sleeps when nobody is using it, and can take up to a minute to start.
          </Text>
        ) : null}
        <View style={styles.actions}>
          <Button title={busy ? 'Signing in' : 'Sign in'} onPress={signIn} disabled={busy || code.trim().length === 0} />
          {error?.offline ? (
            <Button
              title="Explore the built-in demo"
              tone="quiet"
              onPress={() => onSignedIn({ code: '', driverId: 'drv-harsh', driverName: 'Demo driver', siteId: null, offline: true })}
            />
          ) : null}
        </View>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroCopy: { paddingHorizontal: theme.space(5), paddingTop: theme.space(6), gap: theme.space(2) },
  lede: { color: theme.stone, marginBottom: theme.space(4) },
  input: {
    minHeight: 54,
    borderRadius: theme.radiusControl,
    borderWidth: 1,
    borderColor: theme.rule,
    backgroundColor: theme.paper,
    paddingHorizontal: theme.space(4),
    fontFamily: fonts.sans,
    fontSize: 17,
    letterSpacing: 1,
    color: theme.forest,
  },
  gap: { marginTop: theme.space(3) },
  actions: { marginTop: theme.space(4), gap: theme.space(2) },
});

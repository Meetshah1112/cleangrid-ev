import { StyleSheet, Text, View } from 'react-native';
import { getApiBase, type ChargingMode, type SiteSummary, type Vehicle } from '../api';
import { clockTime, getTimezone } from '../format';
import { MODE_COPY, theme, type } from '../theme';
import { ChoiceRow, PageHead, Screen, Section } from '../components/ui';

const MODES: ChargingMode[] = ['greenest', 'cheapest', 'balanced', 'fastest'];

/**
 * Where you charge, what you drive, and how you like it charged. The site switcher is the one that
 * changes everything downstream: forecast, bays, currency and time zone all follow it.
 */
export function ProfileScreen({
  driverName,
  sites,
  siteId,
  onSelectSite,
  vehicles,
  defaultMode,
  onDefaultMode,
  hasLiveSession,
  nowMs,
  clockScale,
}: {
  driverName: string;
  sites: SiteSummary[];
  siteId: string;
  onSelectSite: (id: string) => void;
  vehicles: Vehicle[];
  defaultMode: ChargingMode;
  onDefaultMode: (mode: ChargingMode) => void;
  hasLiveSession: boolean;
  nowMs: number;
  clockScale: number;
}) {
  return (
    <Screen>
      <PageHead eyebrow="Account" title={driverName} lede="Your sites, your car, and how you like it charged." />

      <Section label="Where you charge">
        {sites.length === 0 ? (
          <Text style={type.body}>No sites available. Check the connection below.</Text>
        ) : (
          sites.map((site) => (
            <ChoiceRow
              key={site.id}
              title={site.name}
              subtitle={`${site.timezone.replace('_', ' ')}, ${site.gridConnectionKw} kW connection, ${site.currency}`}
              selected={site.id === siteId}
              trailing={site.id === siteId ? 'Current' : undefined}
              onPress={() => onSelectSite(site.id)}
            />
          ))
        )}
      </Section>

      <Section label="Your vehicles">
        {vehicles.length === 0 ? (
          <Text style={type.body}>No vehicle on file. Sessions use the charger's own limit instead.</Text>
        ) : (
          vehicles.map((vehicle) => (
            <View key={vehicle.id} style={styles.vehicle}>
              <Text style={type.subtitle}>{vehicle.label}</Text>
              <Text style={type.caption}>
                {vehicle.batteryKwh} kWh battery, charges at up to {vehicle.maxChargeKw} kW
              </Text>
            </View>
          ))
        )}
      </Section>

      <Section label="Charging preference">
        <Text style={[type.caption, { marginBottom: theme.space(2) }]}>
          {hasLiveSession ? 'Saved to your profile and applied to the session running now.' : 'Saved to your profile and used for your next session.'}
        </Text>
        {MODES.map((mode) => (
          <ChoiceRow
            key={mode}
            title={MODE_COPY[mode]?.title ?? mode}
            subtitle={MODE_COPY[mode]?.blurb}
            selected={mode === defaultMode}
            trailing={mode === defaultMode ? 'Chosen' : undefined}
            onPress={() => onDefaultMode(mode)}
          />
        ))}
      </Section>

      <Section label="Connection">
        <View style={styles.line}>
          <Text style={type.caption}>Server</Text>
          <Text style={type.strong}>{getApiBase().replace(/^https?:\/\//, '')}</Text>
        </View>
        <View style={styles.line}>
          <Text style={type.caption}>Site time</Text>
          <Text style={type.strong}>
            {clockTime(nowMs)} {getTimezone()}
          </Text>
        </View>
        <View style={styles.line}>
          <Text style={type.caption}>Demo clock</Text>
          <Text style={type.strong}>{clockScale === 1 ? 'real time' : `${clockScale}x accelerated`}</Text>
        </View>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  vehicle: { paddingVertical: theme.space(2), borderBottomWidth: 1, borderBottomColor: theme.rule, gap: 2 },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: theme.space(3),
    paddingVertical: theme.space(2),
    borderBottomWidth: 1,
    borderBottomColor: theme.rule,
  },
});

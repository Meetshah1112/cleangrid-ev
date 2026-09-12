import { StyleSheet, Text, View } from 'react-native';
import { getApiBase, type ChargingMode, type SiteSummary, type Vehicle } from '../api';
import { clockTime, getTimezone } from '../format';
import { MODE_COPY, theme } from '../theme';
import { Card, ChoiceRow, Divider, Label, Screen, ScreenHeader } from '../components/ui';

const MODES: ChargingMode[] = ['cheapest', 'greenest', 'fastest', 'balanced'];

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
  nowMs: number;
  clockScale: number;
}) {
  return (
    <Screen>
      <ScreenHeader eyebrow="Account" title={driverName} subtitle="Your sites, your car, your default preference." />

      <Card>
        <Label>Where you charge</Label>
        {sites.length === 0 ? (
          <Text style={styles.muted}>No sites available. Check the connection below.</Text>
        ) : (
          sites.map((site) => (
            <ChoiceRow
              key={site.id}
              title={site.name}
              subtitle={`${site.timezone.replace('_', ' ')} · ${site.gridConnectionKw} kW connection · ${site.currency}`}
              selected={site.id === siteId}
              trailing={site.id === siteId ? 'Current' : undefined}
              onPress={() => onSelectSite(site.id)}
            />
          ))
        )}
      </Card>

      <Card>
        <Label>Your vehicles</Label>
        {vehicles.length === 0 ? (
          <Text style={styles.muted}>No vehicle on file — sessions will use the charger's limit instead.</Text>
        ) : (
          vehicles.map((vehicle, index) => (
            <View key={vehicle.id}>
              {index > 0 ? <Divider /> : null}
              <View style={styles.vehicleRow}>
                <Text style={styles.vehicleName}>{vehicle.label}</Text>
                <Text style={styles.vehicleFacts}>
                  {vehicle.batteryKwh} kWh · up to {vehicle.maxChargeKw} kW
                </Text>
              </View>
            </View>
          ))
        )}
      </Card>

      <Card>
        <Label>Default preference</Label>
        <Text style={styles.muted}>The mode a new session starts on. You can still change it per session.</Text>
        <View style={{ height: theme.space(3) }} />
        {MODES.map((mode) => (
          <ChoiceRow
            key={mode}
            title={MODE_COPY[mode]?.title ?? mode}
            subtitle={MODE_COPY[mode]?.blurb}
            selected={mode === defaultMode}
            onPress={() => onDefaultMode(mode)}
          />
        ))}
      </Card>

      <Card>
        <Label>Connection</Label>
        <View style={styles.line}>
          <Text style={styles.lineLabel}>Server</Text>
          <Text style={styles.lineValue}>{getApiBase().replace(/^https?:\/\//, '')}</Text>
        </View>
        <View style={styles.line}>
          <Text style={styles.lineLabel}>Site time</Text>
          <Text style={styles.lineValue}>
            {clockTime(nowMs)} {getTimezone()}
          </Text>
        </View>
        <View style={styles.line}>
          <Text style={styles.lineLabel}>Demo clock</Text>
          <Text style={styles.lineValue}>{clockScale === 1 ? 'real time' : `${clockScale}× accelerated`}</Text>
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: 13, color: theme.muted, lineHeight: 19 },
  vehicleRow: { paddingVertical: theme.space(2) },
  vehicleName: { fontSize: 15.5, fontWeight: '600', color: theme.ink },
  vehicleFacts: { fontSize: 12.5, color: theme.muted, marginTop: 2, fontVariant: ['tabular-nums'] },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: theme.space(2) },
  lineLabel: { fontSize: 13, color: theme.muted },
  lineValue: { fontSize: 13, color: theme.ink, fontWeight: '600' },
});

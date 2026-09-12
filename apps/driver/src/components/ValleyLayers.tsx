import { G, Line, Rect, Text as SvgText } from 'react-native-svg';
import type { CurrentSession, Forecast } from '../api';
import { axisTime, clockTime, localHourExact } from '../format';
import { fonts, theme } from '../theme';
import type { ValleyGeometry } from './Valley';

/**
 * What each screen draws into its valley. Nothing here is invented to fill the picture: where the
 * forecast or the plan has no value, nothing is drawn.
 */

function Ticks({ geometry, startMs, spanMs, y }: { geometry: ValleyGeometry; startMs: number; spanMs: number; y: number }) {
  // Roughly four labels across the frame, on round hours.
  const every = (spanMs <= 12 * 3_600_000 ? 2 : spanMs <= 16 * 3_600_000 ? 4 : 6) * 3_600_000;
  // On the site's own round hours, which in India are not round hours of UTC.
  const localStart = localHourExact(startMs);
  const everyHours = every / 3_600_000;
  const first = startMs + (Math.ceil(localStart / everyHours) * everyHours - localStart) * 3_600_000;
  const ticks: number[] = [];
  for (let ms = first; ms <= startMs + spanMs; ms += every) ticks.push(ms);
  return (
    <G>
      {ticks
        .map((ms) => ({ ms, x: geometry.x(ms) }))
        .filter((tick) => tick.x > 30 && tick.x < geometry.width - 30)
        .map((tick) => (
          <SvgText key={tick.ms} x={tick.x} y={y} fill="rgba(252,253,251,0.9)" fontSize={11} fontFamily={fonts.sansSemiBold} textAnchor="middle">
            {axisTime(tick.ms)}
          </SvgText>
        ))}
    </G>
  );
}

/**
 * Renewable availability as a stepped lime ridge standing on the meadow, the hours already gone
 * faded, and the cleanest window the scheduler is aiming at drawn brighter than the rest.
 */
export function ForecastRidge({ forecast, geometry, startMs, spanMs }: { forecast: Forecast; geometry: ValleyGeometry; startMs: number; spanMs: number }) {
  const baseline = geometry.height - 28;
  const tall = geometry.height * 0.26;
  const stepMs = forecast.stepMinutes * 60_000;
  const window = forecast.greenWindow;
  const now = geometry.nowX ?? -1;

  return (
    <G>
      {forecast.renewableShare.map((share, index) => {
        const from = forecast.startMs + index * stepMs;
        const x0 = geometry.x(from);
        const x1 = geometry.x(from + stepMs);
        if (x1 < 0 || x0 > geometry.width) return null;
        const inWindow = window !== null && from >= window.startMs && from < window.endMs;
        const past = x1 <= now;
        const h = Math.max(1, share * tall);
        return (
          <Rect
            key={index}
            x={x0}
            y={baseline - h}
            width={Math.max(0.5, x1 - x0 + 0.4)}
            height={h}
            fill={theme.lime}
            opacity={past ? 0.2 : inWindow ? 0.78 : 0.42}
          />
        );
      })}
      <Line x1={0} x2={geometry.width} y1={baseline + 0.5} y2={baseline + 0.5} stroke="rgba(252,253,251,0.35)" strokeWidth={1} />
      {geometry.nowX !== null ? (
        <Line x1={geometry.nowX} x2={geometry.nowX} y1={baseline - tall - 8} y2={baseline} stroke="rgba(252,253,251,0.8)" strokeWidth={1} strokeDasharray="2 4" />
      ) : null}
      <Ticks geometry={geometry} startMs={startMs} spanMs={spanMs} y={baseline + 17} />
    </G>
  );
}

/**
 * The car's own plan as a ribbon along the meadow: power where the optimiser has committed it,
 * deeper where more flows, blocks behind now greyed, and a tick where the driver must leave.
 */
export function PlanRibbon({ current, geometry, startMs, spanMs }: { current: CurrentSession; geometry: ValleyGeometry; startMs: number; spanMs: number }) {
  const grid = current.planGrid;
  const planned = current.plannedKw;
  const baseline = geometry.height - 28;
  const lane = baseline - 22;
  const now = geometry.nowX ?? -1;
  const maxKw = Math.max(1, current.session.maxPowerKw);
  const deadlineX = geometry.x(current.session.deadlineMs);

  return (
    <G>
      <Line x1={0} x2={geometry.width} y1={lane} y2={lane} stroke="rgba(252,253,251,0.3)" strokeWidth={2} strokeLinecap="round" />
      {grid && planned
        ? planned.map((kw, slot) => {
            if (kw <= 0.05) return null;
            const from = grid.startMs + slot * grid.slotMinutes * 60_000;
            const x0 = geometry.x(from);
            const x1 = geometry.x(from + grid.slotMinutes * 60_000);
            if (x1 < 0 || x0 > geometry.width) return null;
            return (
              <Rect
                key={slot}
                x={x0}
                y={lane - 7}
                width={Math.max(1, x1 - x0 + 0.5)}
                height={14}
                rx={3}
                fill={x1 <= now ? 'rgb(214,226,218)' : theme.lime}
                opacity={x1 <= now ? 0.45 : 0.35 + 0.65 * Math.min(1, kw / maxKw)}
              />
            );
          })
        : null}
      {deadlineX > 0 && deadlineX < geometry.width ? (
        <>
          <Line x1={deadlineX} x2={deadlineX} y1={lane - 16} y2={lane + 16} stroke={current.session.deadlineRisk ? theme.coral : theme.onForest} strokeWidth={2} strokeLinecap="round" />
          <SvgText
            x={Math.min(geometry.width - 6, deadlineX + 6)}
            y={lane - 20}
            fill={theme.onForest}
            fontSize={11.5}
            fontFamily={fonts.sansSemiBold}
            textAnchor={deadlineX > geometry.width - 70 ? 'end' : 'start'}
          >
            ready {clockTime(current.session.deadlineMs)}
          </SvgText>
        </>
      ) : null}
      {geometry.nowX !== null ? (
        <Line x1={geometry.nowX} x2={geometry.nowX} y1={lane - 22} y2={baseline} stroke="rgba(252,253,251,0.8)" strokeWidth={1} strokeDasharray="2 4" />
      ) : null}
      <Line x1={0} x2={geometry.width} y1={baseline + 0.5} y2={baseline + 0.5} stroke="rgba(252,253,251,0.35)" strokeWidth={1} />
      <Ticks geometry={geometry} startMs={startMs} spanMs={spanMs} y={baseline + 17} />
    </G>
  );
}

/**
 * The stretch of day a car's plan is shown across: from an hour before now, or before its first
 * block if that is earlier, to an hour past its deadline, at least eight hours and at most a day.
 */
export function planFrame(current: CurrentSession, nowMs: number): { startMs: number; spanMs: number } {
  const hour = 3_600_000;
  const first = current.planGrid && current.plannedKw ? current.plannedKw.findIndex((kw) => kw > 0.05) : -1;
  const firstMs = first >= 0 && current.planGrid ? current.planGrid.startMs + first * current.planGrid.slotMinutes * 60_000 : nowMs;
  const startMs = Math.floor(Math.min(nowMs, firstMs) / hour) * hour - hour;
  const endMs = Math.max(current.session.deadlineMs + hour, startMs + 8 * hour);
  return { startMs, spanMs: Math.min(24 * hour, Math.ceil((endMs - startMs) / hour) * hour) };
}

/**
 * Sprint 12 phase 5 — Channel-distribution donut.
 *
 * Pure SVG (no Recharts dep — saves ~50 kb gzip on the dashboard
 * route). Renders 4 segments + an inner "other" slice when present,
 * plus a legend with the count and the percentage per channel.
 *
 * Stateless presentational component — the parent passes the counts
 * and the i18n-resolved labels.
 */
export type ChannelDonutSlice = {
  key: "email" | "linkedin" | "phone" | "visit" | "other";
  label: string;
  count: number;
  /** Tailwind-friendly hex (we don't go through theme variables here
   *  because SVG `stroke` attributes don't read CSS custom properties
   *  in all browsers — explicit hex keeps the donut visually stable). */
  color: string;
};

const DONUT_SIZE = 160;
const DONUT_RADIUS = 64;
const DONUT_STROKE_WIDTH = 22;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

export function ChannelDonut({
  slices,
  totalLabel,
  emptyLabel,
}: {
  slices: ChannelDonutSlice[];
  totalLabel: string;
  emptyLabel: string;
}) {
  const total = slices.reduce((sum, s) => sum + s.count, 0);

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  // Build the donut by chaining stroke-dasharray segments. Each slice
  // consumes a portion of the circumference proportional to its share ;
  // the accumulator (in `reduce`) carries the running offset so each
  // next slice starts where the previous one ended. Pure functional —
  // no mutable closure capture.
  const segments = slices
    .filter((s) => s.count > 0)
    .reduce<
      Array<ChannelDonutSlice & { length: number; gap: number; offset: number }>
    >((acc, s) => {
      const share = s.count / total;
      const length = share * DONUT_CIRCUMFERENCE;
      const gap = DONUT_CIRCUMFERENCE - length;
      const prevOffset = acc.length === 0 ? 0 : acc[acc.length - 1]!.offset - acc[acc.length - 1]!.length;
      acc.push({ ...s, length, gap, offset: prevOffset });
      return acc;
    }, []);

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative" style={{ width: DONUT_SIZE, height: DONUT_SIZE }}>
        <svg
          width={DONUT_SIZE}
          height={DONUT_SIZE}
          viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
          // Rotate -90° so the first slice starts at 12 o'clock instead
          // of 3 o'clock (the SVG default), matching how every other
          // donut on the web reads.
          style={{ transform: "rotate(-90deg)" }}
          aria-hidden
        >
          {/* Track */}
          <circle
            cx={DONUT_SIZE / 2}
            cy={DONUT_SIZE / 2}
            r={DONUT_RADIUS}
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth={DONUT_STROKE_WIDTH}
            opacity={0.35}
          />
          {/* Slices */}
          {segments.map((seg) => (
            <circle
              key={seg.key}
              cx={DONUT_SIZE / 2}
              cy={DONUT_SIZE / 2}
              r={DONUT_RADIUS}
              fill="none"
              stroke={seg.color}
              strokeWidth={DONUT_STROKE_WIDTH}
              strokeDasharray={`${seg.length} ${seg.gap}`}
              strokeDashoffset={seg.offset}
              strokeLinecap="butt"
            />
          ))}
        </svg>
        {/* Center : total. Positioned absolute over the SVG, NOT rotated. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-2xl font-serif font-bold">{total}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {totalLabel}
          </div>
        </div>
      </div>

      {/* Legend */}
      <ul className="w-full grid grid-cols-2 gap-x-4 gap-y-1.5">
        {slices.map((s) => {
          const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
          return (
            <li key={s.key} className="flex items-center gap-2 text-xs">
              <span
                className="h-2.5 w-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: s.color }}
                aria-hidden
              />
              <span className="text-foreground">{s.label}</span>
              <span className="ml-auto tabular-nums text-muted-foreground">
                {s.count} · {pct}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

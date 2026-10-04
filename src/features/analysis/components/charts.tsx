import { forwardRef, useId } from "react";

function lerp(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t);
}
// white -> steel blue (matches reference figure)
function blue(t: number) {
  const c0 = [255, 255, 255] as const;
  const c1 = [44, 111, 183] as const;
  return `rgb(${lerp(c0[0], c1[0], t)},${lerp(c0[1], c1[1], t)},${lerp(c0[2], c1[2], t)})`;
}

type HeatmapProps = {
  title: string;
  rows: string[];
  cols: string[];
  values: number[][];
  yLabel?: string;
  texts?: string[][];
  legendLabel?: string;
};

export const Heatmap = forwardRef<SVGSVGElement, HeatmapProps>(function Heatmap(
  { title, rows, cols, values, yLabel = "Peptide", texts, legendLabel = "Value" },
  ref,
) {
  const gradientId = useId().replace(/:/g, "");
  const cell = 34;
  const cw = 90;
  const labelW = Math.max(120, Math.max(0, ...rows.map((r) => r.length)) * 7.5 + 20);
  const colLabelH = Math.max(90, Math.max(0, ...cols.map((c) => c.length)) * 6 + 20);
  const left = labelW + 30;
  const top = 40;
  const gridW = cols.length * cw;
  const gridH = rows.length * cell;
  const relative = legendLabel === "Relative";
  const max = relative ? 1 : Math.max(1, ...values.flat());
  const legendX = left + gridW + 30;
  const width = legendX + 90;
  const height = top + gridH + colLabelH + 10;
  return (
    <svg
      ref={ref}
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block", maxWidth: "100%", height: "auto" }}
      fontFamily="Arial, sans-serif"
    >
      <title>{title}</title>
      <rect width={width} height={height} fill="#ffffff" />
      <text x={left} y={22} fontSize={14} fontWeight="bold" fill="#111">
        {title}
      </text>
      <text
        transform={`translate(14 ${top + gridH / 2}) rotate(-90)`}
        textAnchor="middle"
        fontSize={14}
        fontWeight="bold"
        fill="#111"
      >
        {yLabel}
      </text>
      {rows.map((r, i) => (
        <text
          key={r + i}
          x={left - 8}
          y={top + i * cell + cell / 2 + 4}
          textAnchor="end"
          fontSize={12}
          fill="#333"
        >
          {r}
        </text>
      ))}
      {rows.map((_, i) =>
        cols.map((_, j) => {
          const v = values[i]?.[j] ?? 0;
          const t = v / max;
          return (
            <g key={`${i}-${j}`}>
              <rect
                x={left + j * cw}
                y={top + i * cell}
                width={cw}
                height={cell}
                fill={blue(t)}
                stroke="#ffffff"
              />
              <text
                x={left + j * cw + cw / 2}
                y={top + i * cell + cell / 2 + 4}
                textAnchor="middle"
                fontSize={12}
                fill={t > 0.6 ? "#fff" : "#111"}
              >
                {texts?.[i]?.[j] ?? v}
              </text>
            </g>
          );
        }),
      )}
      <rect
        x={left}
        y={top}
        width={gridW}
        height={gridH}
        fill="none"
        stroke="#000"
        strokeWidth={1.5}
      />
      {cols.map((c, j) => (
        <text
          key={c}
          transform={`translate(${left + j * cw + cw / 2 + 4} ${top + gridH + 10}) rotate(-45)`}
          textAnchor="end"
          fontSize={12}
          fill="#333"
        >
          {c}
        </text>
      ))}
      <defs>
        <linearGradient id={gradientId} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={blue(0)} />
          <stop offset="1" stopColor={blue(1)} />
        </linearGradient>
      </defs>
      <text x={legendX} y={top + 4} fontSize={13} fontWeight="bold" fill="#111">
        {legendLabel}
      </text>
      <rect
        x={legendX}
        y={top + 14}
        width={18}
        height={120}
        fill={`url(#${gradientId})`}
        stroke="#ccc"
      />
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <text key={f} x={legendX + 24} y={top + 14 + 120 - f * 120 + 4} fontSize={11} fill="#333">
          {relative ? (max * f).toFixed(2) : Math.round(max * f)}
        </text>
      ))}
    </svg>
  );
});

function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  if (a1 - a0 >= Math.PI * 2 - 1e-6)
    return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`;
  const x0 = cx + r * Math.cos(a0),
    y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1),
    y1 = cy + r * Math.sin(a1);
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1} Z`;
}

type Slice = { label: string; value: number; color: string };

function Pie({
  cx,
  cy,
  r,
  slices,
  start,
  labelR,
}: {
  cx: number;
  cy: number;
  r: number;
  slices: Slice[];
  start: number;
  labelR: number;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  let a = start;
  return (
    <g>
      {slices.map((s) => {
        if (!s.value) return null;
        const a0 = a,
          a1 = a + (s.value / total) * Math.PI * 2;
        a = a1;
        const mid = (a0 + a1) / 2;
        return (
          <g key={s.label}>
            <path d={arc(cx, cy, r, a0, a1)} fill={s.color} stroke="#fff" strokeWidth={3} />
            <text
              x={cx + r * 0.62 * Math.cos(mid)}
              y={cy + r * 0.62 * Math.sin(mid) + 5}
              textAnchor="middle"
              fontSize={15}
              fill="#111"
            >
              {s.value}
            </text>
            <text
              x={cx + labelR * Math.cos(mid)}
              y={cy + labelR * Math.sin(mid) + 5}
              textAnchor={Math.cos(mid) < -0.2 ? "end" : Math.cos(mid) > 0.2 ? "start" : "middle"}
              fontSize={14}
              fill="#111"
            >
              {s.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export const LocationPie = forwardRef<
  SVGSVGElement,
  { counts: Record<string, number>; title: string }
>(function LocationPie({ counts, title }, ref) {
  const surface =
    (counts["Integral to membrane"] ?? 0) +
    (counts["Anchored to membrane"] ?? 0) +
    (counts["Cell wall"] ?? 0);
  const main: Slice[] = [
    { label: "Cell surface", value: surface, color: "#2f5597" },
    { label: "Extracellular", value: counts["Extracellular"] ?? 0, color: "#b4b4b4" },
    { label: "Cytoplasm", value: counts["Cytoplasm"] ?? 0, color: "#c55a11" },
    { label: "Unknown", value: counts["Unknown"] ?? 0, color: "#d9d9d9" },
  ];
  const sub: Slice[] = [
    { label: "Integral to membrane", value: counts["Integral to membrane"] ?? 0, color: "#203864" },
    { label: "Cell wall", value: counts["Cell wall"] ?? 0, color: "#4472c4" },
    { label: "Anchored to membrane", value: counts["Anchored to membrane"] ?? 0, color: "#c0c0e0" },
  ];
  const total = main.reduce((s, x) => s + x.value, 0) || 1;
  const surfAngle = (surface / total) * Math.PI * 2;
  const start = -surfAngle / 2; // centre the cell-surface slice on the right
  const W = 900,
    H = 380;
  return (
    <svg
      ref={ref}
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      style={{ display: "block", maxWidth: "100%", height: "auto" }}
      fontFamily="Arial, sans-serif"
    >
      <rect width={W} height={H} fill="#ffffff" />
      <text x={20} y={26} fontSize={14} fontWeight="bold" fill="#111">
        {title}
      </text>
      <Pie cx={250} cy={200} r={120} slices={main} start={start} labelR={150} />
      {surface > 0 && (
        <>
          <line
            x1={250 + 120 * Math.cos(start)}
            y1={200 + 120 * Math.sin(start)}
            x2={560}
            y2={200 - 85}
            stroke="#aaa"
          />
          <line
            x1={250 + 120 * Math.cos(-start)}
            y1={200 + 120 * Math.sin(-start)}
            x2={560}
            y2={200 + 85}
            stroke="#aaa"
          />
          <Pie cx={590} cy={200} r={85} slices={sub} start={-Math.PI / 2} labelR={110} />
        </>
      )}
    </svg>
  );
});

export const HorizontalBar = forwardRef<
  SVGSVGElement,
  { items: { label: string; value: number }[]; title: string }
>(function HorizontalBar({ items, title }, ref) {
  const rowH = 24,
    top = 44,
    barMax = 360,
    left = 40;
  const max = Math.max(1, ...items.map((i) => i.value));
  const labelW = Math.max(200, Math.max(0, ...items.map((i) => i.label.length)) * 7.2);
  const W = left + barMax + labelW + 30,
    H = top + items.length * rowH + 20;
  const axis = left + barMax;
  return (
    <svg
      ref={ref}
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      style={{ display: "block", maxWidth: "100%", height: "auto" }}
      fontFamily="Arial, sans-serif"
    >
      <rect width={W} height={H} fill="#ffffff" />
      <text x={20} y={26} fontSize={14} fontWeight="bold" fill="#111">
        {title}
      </text>
      {items.map((it, i) => {
        const w = (it.value / max) * barMax;
        const y = top + i * rowH;
        return (
          <g key={it.label}>
            <rect x={axis - w} y={y} width={w} height={rowH - 6} fill="#808080" />
            <text
              x={axis - w - 6}
              y={y + rowH / 2 + 1}
              textAnchor="end"
              fontSize={13}
              fontWeight="bold"
              fill="#111"
            >
              {it.value}
            </text>
            <text x={axis + 4} y={y + rowH / 2 + 1} fontSize={13} fill="#111">
              {it.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
});

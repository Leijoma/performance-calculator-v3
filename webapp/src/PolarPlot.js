// PolarPlot.js – ritar polar diagram med rundade kurvor och etiketter
import React, { useMemo, useRef, useEffect, useState } from "react";

export default function PolarPlot({ size = 250, polarData, targetAngle, targetSpeed }) {
  const [smoothedAngle, setSmoothedAngle] = useState(null);
  const [smoothedSpeed, setSmoothedSpeed] = useState(null);
  const angleBuffer = useRef([]);
  const speedBuffer = useRef([]);

  useEffect(() => {
    if (targetAngle == null) return;
    const now = Date.now();
    angleBuffer.current.push({ angle: targetAngle, time: now });
    angleBuffer.current = angleBuffer.current.filter(e => now - e.time <= 3000);
    const sum = angleBuffer.current.reduce((acc, e) => acc + e.angle, 0);
    const avg = sum / angleBuffer.current.length;
    setSmoothedAngle(avg);
  }, [targetAngle]);

  useEffect(() => {
    if (targetSpeed == null) return;
    const now = Date.now();
    speedBuffer.current.push({ speed: targetSpeed, time: now });
    speedBuffer.current = speedBuffer.current.filter(e => now - e.time <= 3000);
    const sum = speedBuffer.current.reduce((acc, e) => acc + e.speed, 0);
    const avg = sum / speedBuffer.current.length;
    setSmoothedSpeed(avg);
  }, [targetSpeed]);

  const processed = useMemo(() => {
    if (!polarData || polarData.length === 0) return null;

    const grouped = {};
    polarData.forEach(({ twa, tws, speed }) => {
      const twsRounded = Math.round(tws); // redan i knop, ingen konvertering
      if (!grouped[twsRounded]) grouped[twsRounded] = [];
      grouped[twsRounded].push({ twa, speed });
    });

    const maxSpeed = Math.max(...Object.values(grouped).flat().map(p => p.speed));
    return { grouped, maxSpeed };
  }, [polarData]);

  if (!processed) return <div>No polar to display</div>;

  const { grouped, maxSpeed } = processed;
  const colors = ["#44f", "#2c2", "#e91e63", "#ffa500", "#0ff", "#ccc", "#0f0", "#f0f", "#0ff", "#fff"];
  const center = size / 2;
  const maxRadius = center - 10;

  function polarToCartesian(cx, cy, r, angleDeg) {
    const angleRad = (angleDeg * Math.PI) / 180;
    return {
      x: cx + r * Math.sin(angleRad),
      y: cy - r * Math.cos(angleRad),
    };
  }

  function lineToSmoothPath(points, mirror = false) {
    const path = points.map(({ twa, speed }) => {
      const r = (speed / (maxSpeed)) * maxRadius;
      const angle = mirror ? -twa : twa;
      return polarToCartesian(center, center, r, angle);
    });

    if (path.length < 2) return "";

    let d = `M ${path[0].x} ${path[0].y}`;
    for (let i = 1; i < path.length; i++) {
      const midX = (path[i - 1].x + path[i].x) / 2;
      const midY = (path[i - 1].y + path[i].y) / 2;
      d += ` Q ${path[i - 1].x} ${path[i - 1].y}, ${midX} ${midY}`;
    }
    return d;
  }

  return (
    <svg width={size} height={size} style={{ backgroundColor: "#111" }}>
      {[0.25, 0.5, 0.75, 1].map(frac => {
        const r = frac * maxRadius;
        return (
          <circle key={frac} cx={center} cy={center} r={r} stroke="#222" fill="none" strokeDasharray="2,2" />
        );
      })}
      <text x={center + maxRadius + 5} y={center} fontSize="10" fill="#999">{maxSpeed.toFixed(1)} kn</text>

      {Object.entries(grouped).map(([twsKnots, points], idx) => {
        if (points.length < 3) return null;
        const color = colors[idx % colors.length];
        const pathData = lineToSmoothPath(points, false);
        const mirrorData = lineToSmoothPath(points, true);

        const last = points[points.length - 1];
        const rLast = (last.speed / maxSpeed) * maxRadius;
        const { x: lx, y: ly } = polarToCartesian(center, center, rLast, last.twa);

        return (
          <g key={twsKnots}>
            <path d={pathData} stroke={color} fill="none" strokeWidth="1" />
            <path d={mirrorData} stroke={color} fill="none" strokeWidth="1" />
            <text x={lx + 4} y={ly} fontSize="10" fill={color}>{twsKnots} kn</text>
          </g>
        );
      })}

      {smoothedAngle != null && (() => {
        const angleDeg = smoothedAngle * 180 / Math.PI;
        const { x, y } = polarToCartesian(center, center, maxRadius, angleDeg);
        return (
          <line x1={center} y1={center} x2={x} y2={y} stroke="#ff0" strokeDasharray="4" strokeWidth={1} />
        );
      })()}

      {smoothedSpeed != null && smoothedAngle != null && (() => {
        const angleDeg = smoothedAngle * 180 / Math.PI;
        const r = ((smoothedSpeed * 1.94384) / maxSpeed) * maxRadius;
        const { x, y } = polarToCartesian(center, center, r, angleDeg);
        return (
          <>
            <circle cx={x} cy={y} r={4} fill="#f00" />
            <text x={x + 5} y={y - 5} fontSize="10" fill="#f00">
              {(smoothedSpeed * 1.94384).toFixed(1)} kn @ {Math.round(angleDeg)}°
            </text>
          </>
        );
      })()}
    </svg>
  );
}

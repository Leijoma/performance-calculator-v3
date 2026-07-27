import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { Card, CardContent, Typography, Grid, Box } from "@mui/material";
import usePolarData from "./getPolar";
import PolarPlot from "./PolarPlot";

// Formatvärden beroende på enhet
function formatValue(value, unit) {
  if (value == null) return "--";
  if (unit === "kn") return (value * 1.94384449).toFixed(1);
  if (unit === "%") return Math.round(value).toString();
  if (unit === "°") return Math.round((value * 180) / Math.PI).toString();
  return value.toFixed(1);
}

export function DataCard({ title, value, unit }) {
  return (
    <Card variant="outlined" sx={{ width: 150, textAlign: 'center', backgroundColor: '#111', color: '#fff', borderRadius: 3, p: 2 }}>
      <CardContent>
        <Typography variant="caption" color="gray" sx={{ textTransform: 'uppercase' }}>
          {title}
        </Typography>
        <Typography variant="h4" component="div">
          {formatValue(value, unit)}
          {unit && (
            <Typography variant="subtitle1" component="span" color="gray" sx={{ ml: 1 }}>
              {unit}
            </Typography>
          )}
        </Typography>
      </CardContent>
    </Card>
  );
}

function Section({ title, children }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="h6" sx={{ color: '#ccc', mb: 1 }}>{title}</Typography>
      <Grid container spacing={2}>{children}</Grid>
    </Box>
  );
}

function DashboardGrid({ data }) {
  const { polarData, error } = usePolarData();

  return (
    <Box sx={{ flexGrow: 1, p: 2 }}>
      <Section title="Performance">
        <Grid item xs={6} sm={4} md={3}><DataCard title="Polar Speed"       value={data.polarSpeed}       unit="kn" /></Grid>
        <Grid item xs={6} sm={4} md={3}><DataCard title="Polar Ratio"       value={data.polarRatio}       unit="%"  /></Grid>
        <Grid item xs={6} sm={4} md={3}><DataCard title="VMG"                value={data.vmg}              unit="kn" /></Grid>
        <Grid item xs={6} sm={4} md={3}><DataCard title="Target Boat Speed" value={data.targetBoatSpeed} unit="kn" /></Grid>
      </Section>

      <Section title="Wind">
        <Grid item xs={6} sm={4} md={3}><DataCard title="AWA" value={data.awa} unit="°" /></Grid>
        <Grid item xs={6} sm={4} md={3}><DataCard title="AWS" value={data.aws} unit="m/s" /></Grid>
        <Grid item xs={6} sm={4} md={3}><DataCard title="TWA" value={data.twa} unit="°" /></Grid>
        <Grid item xs={6} sm={4} md={3}><DataCard title="TWS" value={data.tws} unit="m/s" /></Grid>
        <Grid item xs={6} sm={4} md={3}><DataCard title="TWD" value={data.twd} unit="°" /></Grid>
        <Grid item xs={6} sm={4} md={3}><DataCard title="Optimum Wind Angle" value={data.optimumWindAngle} unit="°" /></Grid>
      </Section>

      <Section title="Attitude & Current">
        <Grid item xs={6} sm={4} md={3}><DataCard title="Heel"   value={data.heel}    unit="°" /></Grid>
        <Grid item xs={6} sm={4} md={3}><DataCard title="Pitch"  value={data.pitch}   unit="°" /></Grid>
        <Grid item xs={6} sm={4} md={3}><DataCard title="Leeway" value={data.leeway}  unit="°" /></Grid>
        <Grid item xs={6} sm={4} md={3}><DataCard title="Drift"  value={data.drift}   unit="kn" /></Grid>
        <Grid item xs={6} sm={4} md={3}><DataCard title="Set"    value={data.set}     unit="°" /></Grid>
      </Section>

      <PolarPlot
        size={500}
        polarData={polarData}
        targetAngle={data.twa}
        targetSpeed={data.polarSpeed}
      />
    </Box>
  );
}

export default function App() {
  const [data, setData] = useState({});

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.host;
    const ws = new WebSocket(`${proto}://${host}/signalk/v1/stream`);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        context: "vessels.self",
        subscribe: [
          { path: "performance.polarSpeed" },
          { path: "performance.polarSpeedRatio" },
          { path: "performance.velocityMadeGood" },
          { path: "performance.targetBoatSpeed" },
          { path: "performance.optimumWindAngle" },
          { path: "environment.wind.speedApparent" },
          { path: "environment.wind.angleApparent" },
          { path: "environment.wind.speedTrue" },
          { path: "environment.wind.angleTrueWater" },
          { path: "environment.wind.directionMagnetic" },
          { path: "performance.heel" },
          { path: "performance.pitch" },
          { path: "performance.leeway" },
          { path: "environment.current.speed" },
          { path: "environment.current.set" }
        ]
      }));
    };

    ws.onmessage = (msg) => {
      const json = JSON.parse(msg.data);
      if (!json.updates) return;

      setData(prev => {
        const nd = { ...prev };
        json.updates.forEach(u => {
          u.values.forEach(v => {
            switch (v.path) {
              case "performance.polarSpeed":            nd.polarSpeed       = v.value; break;
              case "performance.polarSpeedRatio":       nd.polarRatio       = v.value * 100; break;
              case "performance.velocityMadeGood":      nd.vmg              = v.value; break;
              case "performance.targetBoatSpeed":       nd.targetBoatSpeed  = v.value; break;
              case "performance.optimumWindAngle":      nd.optimumWindAngle = v.value; break;

              case "environment.wind.speedApparent":    nd.aws    = v.value; break;
              case "environment.wind.angleApparent":    nd.awa    = v.value; break;
              case "environment.wind.speedTrue":        nd.tws    = v.value; break;
              case "environment.wind.angleTrueWater":   nd.twa    = v.value; break;
              case "environment.wind.directionMagnetic":nd.twd    = v.value; break;

              case "performance.heel":    nd.heel   = v.value; break;
              case "performance.pitch":   nd.pitch  = v.value; break;
              case "performance.leeway":  nd.leeway = v.value; break;

              case "environment.current.speed": nd.drift = v.value * 1.94384449; break;
              case "environment.current.set":   nd.set   = v.value; break;

              default: break;
            }
          });
        });
        return nd;
      });
    };

    return () => ws.close();
  }, []);

  return <DashboardGrid data={data} />;
}

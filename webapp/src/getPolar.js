import { useEffect, useState } from "react";
import axios from "axios";
import Papa from "papaparse";

// Läser auth-inställningar från .env
const useAuth = process.env.REACT_APP_USE_AUTH === "true";
const username = process.env.REACT_APP_SIGNALK_USERNAME;
const password = process.env.REACT_APP_SIGNALK_PASSWORD;

// Ange pluginens root-path – byt till "/plugin/performance-calculator-v3" om du använder /plugin/
const PLUGIN_BASE = "/performance-calculator-v3";

function parsePolarCSV(csv) {
  if (!csv) return [];

  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];

  const header = lines[0].split(","); // TWA,6,8,10,...
  const twsValues = header.slice(1).map((h) => parseFloat(h));

  const data = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const twa = parseFloat(cols[0]);
    if (isNaN(twa)) continue;

    for (let j = 1; j < cols.length; j++) {
      const tws = twsValues[j - 1];
      const speed = parseFloat(cols[j]);
      if (!isNaN(tws) && !isNaN(speed)) {
        data.push({ twa, tws, speed });
      }
    }
  }

  return data;
}

export default function usePolarData() {
  const [polarData, setPolarData] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchPolar() {
      try {
        let headers = {};
        console.log("📡 Fetching polar data", useAuth ? "with auth" : "no auth");

        if (useAuth && username && password) {
          const loginResp = await axios.post(
            `${window.location.origin}/signalk/v1/auth/login`,
            { username, password }
            );
          headers = { Authorization: `Bearer ${loginResp.data.token}` };
        }

        const response = await axios.get(
            `${window.location.origin}/plugins/performance-calculator-v3/polar`,
            { headers }
            );
                    const parsed = parsePolarCSV(response.data);
        setPolarData(parsed);
      } catch (e) {
        console.error("❌ Failed to fetch polar data", e);
        setError(e.message || "Failed to fetch polar data");
      }
    }

    fetchPolar();
  }, []);

  return { polarData, error };
}

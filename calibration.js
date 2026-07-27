// calibration.js
// Laddar och tillhandahåller kalibreringsdata, samt funktioner för justeringar

const fs = require("fs");
const path = require("path");

// Default calibration data matching the JSON structure
let calibrationData = {
  stwHeelCompensation: {
    enabled: false,
    curve: []
  },
  vmgLimits: {
    minUpwindAngle: 35,
    maxDownwindAngle: 170
  }
};

function loadCalibration(filePath) {
  const calibPath = filePath || path.join(__dirname, "calibration.json");

  try {
    if (fs.existsSync(calibPath)) {
      const raw = fs.readFileSync(calibPath, 'utf8');
      const loaded = JSON.parse(raw);

      // Validate structure
      if (loaded && typeof loaded === 'object') {
        calibrationData = loaded;
        console.log('[Calibration] Loaded from:', calibPath);
      } else {
        console.warn('[Calibration] Invalid data structure, using defaults');
      }
    } else {
      console.warn('[Calibration] File not found:', calibPath, '- using defaults');
    }
  } catch (err) {
    console.error('[Calibration] Error loading file:', err.message);
    console.warn('[Calibration] Using default calibration data');
  }
}

function saveCalibration(filePath) {
  const calibPath = filePath || path.join(__dirname, "calibration.json");

  try {
    fs.writeFileSync(calibPath, JSON.stringify(calibrationData, null, 2), 'utf8');
    console.log('[Calibration] Saved to:', calibPath);
  } catch (err) {
    console.error('[Calibration] Error saving file:', err.message);
  }
}

// Get heel compensation factor from calibration curve
function getHeelCompensationFactor(heelDeg) {
  if (!calibrationData.stwHeelCompensation ||
      !calibrationData.stwHeelCompensation.enabled ||
      !calibrationData.stwHeelCompensation.curve ||
      calibrationData.stwHeelCompensation.curve.length === 0) {
    return 1.0; // No compensation
  }

  const curve = calibrationData.stwHeelCompensation.curve;
  const absHeel = Math.abs(heelDeg);

  // Find the two points to interpolate between
  if (absHeel <= curve[0].heel) return curve[0].factor;
  if (absHeel >= curve[curve.length - 1].heel) return curve[curve.length - 1].factor;

  for (let i = 0; i < curve.length - 1; i++) {
    if (absHeel >= curve[i].heel && absHeel <= curve[i + 1].heel) {
      const t = (absHeel - curve[i].heel) / (curve[i + 1].heel - curve[i].heel);
      return curve[i].factor * (1 - t) + curve[i + 1].factor * t;
    }
  }

  return 1.0;
}

// Apply heel compensation to STW
function getCalibratedSTW(stw, heelRad) {
  if (stw == null) return null;

  const heelDeg = Math.abs(heelRad * 180 / Math.PI);
  const factor = getHeelCompensationFactor(heelDeg);

  return stw * factor;
}

function getVMGLimits() {
  return {
    upwind: calibrationData.vmgLimits?.minUpwindAngle || 35,
    downwind: calibrationData.vmgLimits?.maxDownwindAngle || 170
  };
}

// Initialize on module load
loadCalibration();

module.exports = {
  getCalibratedSTW,
  getVMGLimits,
  calibrationData,
  loadCalibration,
  saveCalibration
};

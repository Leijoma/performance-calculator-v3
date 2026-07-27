// polarReader.js – robust version with symmetric TWA handling
// -----------------------------------------------------------------------------
//  • Loads a polar CSV table and builds interpolators (cubic‑spline or linear).
//  • Guard‑clauses prevent runtime errors.
//  • NEW: TWA is now treated symmetriskt – lookup använder |TWA| så babord/styrbord
//    returnerar samma fart.
// -----------------------------------------------------------------------------

const fs = require('fs')
const { parse } = require('csv-parse/sync')
const { createInterpolator } = require('./interpolator')

let polarData     = null   // { 6: [ {twa,speed}, … ] }
let interpolators = {}     // { 6: fn(twaDeg) }
let polarMeta     = {}
let lastWarn      = 0
let cachedTWSKeys = []     // CACHE: Pre-sorted TWS keys for performance

// ────────────────────────────────────────────
function loadPolarCSV (filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      console.error('[PolarReader] File not found:', filePath);
      return;
    }

    const raw  = fs.readFileSync(filePath, 'utf8')
    const rows = parse(raw, { skip_empty_lines: true })

    if (!rows || rows.length < 2) {
      console.error('[PolarReader] Invalid polar file: too few rows');
      return;
    }

    const twsHeaders = rows[0].slice(1).map(Number)

    if (twsHeaders.length === 0 || twsHeaders.some(isNaN)) {
      console.error('[PolarReader] Invalid TWS headers in polar file');
      return;
    }

    const polar = {}
    const meta  = { beatAngle:{}, beatVMG:{}, runAngle:{}, runVMG:{} }
    twsHeaders.forEach(tws => (polar[tws] = []))

    for (let i = 1; i < rows.length; i++) {
      const label = rows[i][0]
      if (!isNaN(parseFloat(label))) {
        // normal polar line
        const twa = parseFloat(label)
        for (let j = 1; j < rows[i].length; j++) {
          const tws   = twsHeaders[j-1]
          const speed = parseFloat(rows[i][j])
          if (!isNaN(speed)) polar[tws].push({ twa, speed })
        }
      } else {
        // metadata rows
        const key = label.toLowerCase()
        for (let j = 1; j < rows[i].length; j++) {
          const tws = twsHeaders[j-1]
          const val = parseFloat(rows[i][j])
          if (isNaN(val)) continue
          if (key.includes('beatangle'))      meta.beatAngle[tws] = val
          else if (key.includes('beatvmg'))   meta.beatVMG[tws]   = val
          else if (key.includes('runangle'))  meta.runAngle[tws]  = val
          else if (key.includes('runvmg'))    meta.runVMG[tws]    = val
        }
      }
    }

    setPolarData(polar, meta)
    console.log('[PolarReader] Loaded polar data with', Object.keys(polar).length, 'TWS values');
  } catch (err) {
    console.error('[PolarReader] Error loading polar file:', err.message);
    throw err; // Re-throw so caller knows it failed
  }
}

function setPolarData (polar, meta = {}) {
  polarData     = polar
  polarMeta     = meta
  interpolators = {}
  for (const tws in polar) {
    const pts = polar[tws]
    const x   = pts.map(p => p.twa)
    const y   = pts.map(p => p.speed)
    interpolators[tws] = createInterpolator(x, y)
  }
  // CACHE: Pre-compute and sort TWS keys once instead of every lookup
  cachedTWSKeys = Object.keys(interpolators).map(Number).sort((a, b) => a - b)
}

// helper
const nearest = (v, arr) => arr.reduce((a, b) => Math.abs(b - v) < Math.abs(a - v) ? b : a)

function getPolarSpeed (tws, twaDeg) {
  if (!polarData) return null
  // ✱ NYTT: symmetri – använd absolut TWA
  twaDeg = Math.abs(twaDeg)

  // OPTIMIZED: Use cached pre-sorted keys instead of sorting every call
  const keys = cachedTWSKeys
  if (!keys.length) return null

  if (tws <= keys[0]) return safeInterp(keys[0], twaDeg)
  if (tws >= keys[keys.length - 1]) return safeInterp(keys[keys.length - 1], twaDeg)

  let t1, t2
  for (let i = 0; i < keys.length - 1; i++) {
    if (tws >= keys[i] && tws <= keys[i + 1]) { t1 = keys[i]; t2 = keys[i + 1]; break }
  }
  if (t1 == null || t2 == null) return null
  const f1 = safeInterp(t1, twaDeg)
  const f2 = safeInterp(t2, twaDeg)
  if (f1 == null || f2 == null) return f1 ?? f2 ?? null
  const ratio = (tws - t1) / (t2 - t1)
  return (1 - ratio) * f1 + ratio * f2
}

function safeInterp (tws, twa) {
  const fn = interpolators[tws]
  if (typeof fn !== 'function') return warn(`no interpolator for TWS ${tws}`)
  const val = fn(twa)
  if (val == null || Number.isNaN(val)) return warn(`interp NaN for TWS ${tws} TWA ${twa}`)
  return val
}

function warn (msg) {
  const now = Date.now()
  if (now - lastWarn > 30000) { console.warn('[polarReader] ' + msg); lastWarn = now }
  return null
}

function getTargetTWA (tws, mode) {
  const keys = Object.keys(polarMeta.beatAngle).map(Number)
  if (!keys.length) return null
  const near = nearest(tws, keys)
  if (mode === 'upwind')   return polarMeta.beatAngle[near]
  if (mode === 'downwind') return polarMeta.runAngle[near]
  return null
}

function getTargetBoatSpeed (tws, mode) {
  const twa = getTargetTWA(tws, mode)
  return twa != null ? getPolarSpeed(tws, twa) : null
}

module.exports = {
  loadPolarCSV,
  setPolarData,
  getPolarSpeed,
  getTargetTWA,
  getTargetBoatSpeed
}

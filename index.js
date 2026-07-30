const path  = require('path')
const fs    = require('fs')
const polarReader          = require('./polarReader')
const calibration          = require('./calibration')
const { calculatePerformance } = require('./performanceCalculator')
const PerfCalcN2K          = require('./n2k-perf-emulator')
const { createSmoother }   = require('./lib/Smoothers')

module.exports = function (app) {
  let unsubscribes = []
  let h5           = null
  let lastInput    = {}
  let lastRun      = 0
  let lastLog      = 0
  let smoothers    = null  // Smoother instances

  // OPTIMIZATION: Use constants for performance
  const CALC_THROTTLE_MS = 500   // Minimum time between calculations
  const LOG_THROTTLE_MS  = 10000 // Minimum time between debug logs
  const kts2mps = k => k / 1.94384449
  const ms2kts  = m => m * 1.94384449
  const deg2rad = d => d * Math.PI / 180
  const toVal   = v => (v == null || Number.isNaN(v) ? null : v)

  const plugin = {
    id:'performance-calculator-v3',
    name:'Performance Calculator v1.3.0',
    description:'Performance Calculator with Data Smoothing and Mast Movement Correction - v1.3.0 - Publishes performance metrics using the H5000 PGN layout',
    options: {}
  }

  plugin.schema = {
    title: 'Performance Calculator v1.3.0 (with Mast Movement Correction)',
    description: '🎯 NEW in v1.3.0: Mast Movement Correction! Corrects apparent wind for masthead motion in waves. v1.2.0: Data Smoothing with 4 algorithms.',
    type:'object',
    properties:{
      _version: {
        type: 'string',
        title: '📌 Plugin Version',
        default: 'v1.3.0 - Mast Movement Correction Edition',
        readOnly: true,
        description: 'Current version: 1.3.0 | Features: Mast Movement Correction (NEW!), Data Smoothing, Heel Compensation, Polar Performance, VMG, N2K broadcast (H5000-compatible PGN layout)'
      },
      awaPath:{type:'string',default:'environment.wind.angleApparent'},
      awsPath:{type:'string',default:'environment.wind.speedApparent'},
      stwPath:{type:'string',default:'navigation.speedThroughWater'},
      sogPath:{type:'string',default:'navigation.speedOverGround'},
      headingPath:{type:'string',default:'navigation.headingTrue'},
      cogPath:{type:'string',default:'navigation.courseOverGroundTrue'},
      attitudePath:{type:'string',default:'navigation.attitude'},
      yawRatePath:{type:'string',default:'navigation.rateOfTurn'},
      rollRatePath:{type:'string',default:'navigation.attitude.rollRate'},
      pitchRatePath:{type:'string',default:'navigation.attitude.pitchRate'},
      revolutionsPath:{type:'string',default:'propulsion.main.revolutions'},
      engineRpmThreshold:{type:'number',default:10,description:'RPM threshold (Hz*60) above which engine is considered running. Default 10 Hz = 600 RPM'},

      polarFile:{type:'string',default:'./polar_SY370_clean.csv'},
      calibrationFile:{type:'string',default:'./calibration.json'},
      useSTW:{type:'boolean',default:true},

      emulateN2K:{type:'boolean',default:true,description:'Broadcast device identity on the NMEA 2000 bus (addr 138, address claim + product info + keep-alive). Perf-data PGN 130824 sending has a known limitation — see README.'},
      canDevice:{type:'string',default:'can0'},
      n2kSourceAddress:{type:'number',default:138},

      leewayCoefficient: {type:'number', default:0.05, description:'H5000 leeway coefficient K'},
      maxLeeway: {type:'number', default:15, description:'Max leeway angle in degrees'},

      mastHeight: {
        type:'number',
        default: 15.0,
        title: 'Mast Height Above Deck (m)',
        description:'Height of wind sensor above deck level in meters - used for mast movement correction. Typical values: 12-20m for cruising boats, 15-25m for racing yachts'
      },
      enableMastCorrection: {
        type: 'boolean',
        default: true,
        title: 'Enable Mast Movement Correction',
        description: 'Correct apparent wind for masthead movement due to rolling/pitching (requires roll/pitch rate data from IMU)'
      },

      // Data smoothing configuration
      smoothing: {
        type: 'object',
        title: 'Data Smoothing',
        description: 'Configure smoothing/filtering for noisy sensor data',
        properties: {
          enabled: {
            type: 'boolean',
            default: false,
            title: 'Enable Data Smoothing',
            description: 'Enable smoothing filters for sensor inputs (reduces noise)'
          },

          // Wind smoothing
          wind: {
            type: 'object',
            title: 'Wind Data Smoothing',
            properties: {
              type: {
                type: 'string',
                default: 'exponential',
                enum: ['passthrough', 'exponential', 'movingaverage', 'kalman'],
                title: 'Smoother Type',
                description: 'Smoothing algorithm for wind data'
              },
              tau: {
                type: 'number',
                default: 1500,
                title: 'Time Constant (ms)',
                description: 'For exponential: smaller = faster response, larger = more smoothing'
              },
              windowSize: {
                type: 'number',
                default: 10,
                title: 'Window Size',
                description: 'For moving average: number of samples to average'
              },
              processNoise: {
                type: 'number',
                default: 0.01,
                title: 'Process Noise',
                description: 'For Kalman: how much the value can change (Q)'
              },
              measurementNoise: {
                type: 'number',
                default: 0.3,
                title: 'Measurement Noise',
                description: 'For Kalman: sensor noise level (R)'
              }
            }
          },

          // Speed smoothing
          speed: {
            type: 'object',
            title: 'Speed Data Smoothing',
            properties: {
              type: {
                type: 'string',
                default: 'exponential',
                enum: ['passthrough', 'exponential', 'movingaverage', 'kalman'],
                title: 'Smoother Type'
              },
              tau: {
                type: 'number',
                default: 2000,
                title: 'Time Constant (ms)'
              },
              windowSize: {
                type: 'number',
                default: 8,
                title: 'Window Size'
              },
              processNoise: {
                type: 'number',
                default: 0.005,
                title: 'Process Noise'
              },
              measurementNoise: {
                type: 'number',
                default: 0.2,
                title: 'Measurement Noise'
              }
            }
          },

          // Heading/attitude smoothing
          heading: {
            type: 'object',
            title: 'Heading/Attitude Smoothing',
            properties: {
              type: {
                type: 'string',
                default: 'exponential',
                enum: ['passthrough', 'exponential', 'movingaverage', 'kalman'],
                title: 'Smoother Type'
              },
              tau: {
                type: 'number',
                default: 3000,
                title: 'Time Constant (ms)'
              },
              windowSize: {
                type: 'number',
                default: 5,
                title: 'Window Size'
              },
              processNoise: {
                type: 'number',
                default: 0.002,
                title: 'Process Noise'
              },
              measurementNoise: {
                type: 'number',
                default: 0.1,
                title: 'Measurement Noise'
              }
            }
          }
        }
      }
    }
  }

  plugin.start = function (opt) {
    plugin.options = opt

    // Log version on startup
    app.debug('='.repeat(60))
    app.debug('[PerfCalc] Performance Calculator v1.3.0 starting...')
    app.debug('[PerfCalc] Features: Mast Movement Correction (NEW!), Data Smoothing, Heel Compensation, Polar Performance')
    app.debug('='.repeat(60))

    const polarPath = path.resolve(__dirname,opt.polarFile)
    if (fs.existsSync(polarPath)) polarReader.loadPolarCSV(polarPath)
    else app.error('[PerfCalc] Polar missing',polarPath)

    const calibPath = path.resolve(__dirname,opt.calibrationFile)
    if (fs.existsSync(calibPath)) calibration.loadCalibration(calibPath)
    else app.error('[PerfCalc] Calibration missing',calibPath)

    if (opt.emulateN2K) {
      if (h5) {
        try { h5.stop() } catch (err) { app.error('[PerfCalc] stopping stale N2K emu:', err.message) }
        h5 = null
      }
      h5 = new PerfCalcN2K({ app, canDevice:opt.canDevice, preferredAddress:opt.n2kSourceAddress })
      app.debug('[PerfCalc] N2K performance broadcast ON')
    }

    // Initialize smoothers if enabled
    if (opt.smoothing && opt.smoothing.enabled) {
      app.debug('[PerfCalc] Smoothing enabled')
      smoothers = {
        awa: createSmoother(opt.smoothing.wind || {}),
        aws: createSmoother(opt.smoothing.wind || {}),
        stw: createSmoother(opt.smoothing.speed || {}),
        sog: createSmoother(opt.smoothing.speed || {}),
        heading: createSmoother(opt.smoothing.heading || {}),
        cog: createSmoother(opt.smoothing.heading || {}),
        roll: createSmoother(opt.smoothing.heading || {}),
        pitch: createSmoother(opt.smoothing.heading || {})
      }
      app.debug('[PerfCalc] Smoothers initialized:', {
        wind: opt.smoothing.wind?.type || 'default',
        speed: opt.smoothing.speed?.type || 'default',
        heading: opt.smoothing.heading?.type || 'default'
      })
    } else {
      smoothers = null
      app.debug('[PerfCalc] Smoothing disabled')
    }

    const paths=[opt.awaPath,opt.awsPath,opt.stwPath,opt.sogPath,opt.headingPath,opt.cogPath,opt.attitudePath,opt.yawRatePath,opt.rollRatePath,opt.pitchRatePath,opt.revolutionsPath]
    unsubscribes = paths.map(p=> app.streambundle.getSelfStream(p,{period:200}).onValue(()=>handleDelta(opt)))
  }

  function handleDelta (opt) {
    const now=Date.now()
    if(now-lastRun<CALC_THROTTLE_MS) return  // OPTIMIZED: Use constant

    const g=p=>app.getSelfPath(p)?.value
    const att=g(opt.attitudePath)||{}

    // Get raw values
    let awa = g(opt.awaPath)
    let aws = g(opt.awsPath)
    let stw = g(opt.stwPath)
    let sog = g(opt.sogPath)
    let heading = g(opt.headingPath)
    let cog = g(opt.cogPath)
    let roll = att.roll
    let pitch = att.pitch

    // Apply smoothing if enabled
    if (smoothers) {
      if (awa != null) awa = smoothers.awa.update(awa, now)
      if (aws != null) aws = smoothers.aws.update(aws, now)
      if (stw != null) stw = smoothers.stw.update(stw, now)
      if (sog != null) sog = smoothers.sog.update(sog, now)
      if (heading != null) heading = smoothers.heading.update(heading, now)
      if (cog != null) cog = smoothers.cog.update(cog, now)
      if (roll != null) roll = smoothers.roll.update(roll, now)
      if (pitch != null) pitch = smoothers.pitch.update(pitch, now)
    }

    const inObj={
      awa, aws, stw, sog, heading, cog,
      attitude:{roll, pitch, yaw:att.yaw},
      yawRate:g(opt.yawRatePath),
      rollRate:g(opt.rollRatePath),
      pitchRate:g(opt.pitchRatePath),
      revolutions:g(opt.revolutionsPath),
      engineRpmThreshold: opt.engineRpmThreshold,

      leewayCoefficient: opt.leewayCoefficient,
      maxLeeway: opt.maxLeeway,
      mastHeight: opt.mastHeight,
      enableMastCorrection: opt.enableMastCorrection
    }

    // Fast shallow comparison instead of expensive JSON.stringify
    if(lastInput.awa===inObj.awa && lastInput.aws===inObj.aws &&
       lastInput.stw===inObj.stw && lastInput.sog===inObj.sog &&
       lastInput.heading===inObj.heading && lastInput.cog===inObj.cog &&
       lastInput.revolutions===inObj.revolutions &&
       lastInput.attitude?.roll===inObj.attitude?.roll &&
       lastInput.attitude?.pitch===inObj.attitude?.pitch) return

    lastInput=inObj; lastRun=now

    // ERROR HANDLING: Wrap calculation in try-catch to prevent crashes
    let r
    try {
      r=calculatePerformance(inObj)
      if(!r) return
    } catch(err) {
      app.error('[PerfCalc] Calculation error:', err.message)
      return
    }

    const deltaVals=[
      {path:'performance.polarSpeed',          value:toVal(kts2mps(r.polarSpeed))},
      {path:'performance.velocityMadeGood',    value:toVal(kts2mps(r.vmg))},
      {path:'performance.targetVMG',            value:toVal(kts2mps(r.targetVMG))},

      {path:'performance.polarSpeedRatio',     value:toVal(r.polarPerf)},
      {path:'performance.targetAngle',         value:toVal(deg2rad(r.targetTWA))},
      {path:'performance.targetBoatSpeed',     value:toVal(kts2mps(r.targetBoatSpeed))},
      {path:'performance.vmgPerformance',      value:toVal(r.vmgPerf)},
      {path:'performance.optimumWindAngle',    value:toVal(deg2rad(r.optimumWindAngle))},
      {path:'performance.leeway',               value:toVal(deg2rad(r.leeway))},

      {path:'environment.wind.speedTrue',      value:toVal(kts2mps(r.tws))},
      {path:'environment.wind.angleTrueWater', value:toVal(r.twa)},
      {path:'environment.wind.directionMagnetic', value:toVal(r.windDirectionMagnetic)},

      {path:'environment.current.speed',       value:toVal(r.currentSpeed)},
      {path:'environment.current.set',         value:toVal(r.currentSet)}
    ]

    app.handleMessage(plugin.id,{ updates:[{ source:{label:plugin.name}, timestamp:new Date().toISOString(), values:deltaVals }] })

    if(h5){
      const send=(name,val,scale)=>{ if(val!=null&&!Number.isNaN(val)) h5.send(name,val,scale) }

      // Scale factors follow the H5000/htool convention for PGN 130824
      // (see signalk-bandg-performance-plugin):
      //   rad / signedRad → *10000 (0.0001 rad/LSB)
      //   m/s             → *100   (cm/s)
      //   ratio (percent) → *1000  (per-mille)
      send('POLAR SPEED',       kts2mps(r.polarSpeed),        100)    // m/s
      send('POLAR SPEED RATIO', r.polarPerf,                  1000)   // ratio
      send('VMG TO WIND',       kts2mps(r.vmg),               100)    // m/s
      send('TARGET TWA',        deg2rad(r.targetTWA),         10000)  // signedRad

      // TWS KNOTS / TWA / TWD keys are not in htool's catalog — keep the
      // scale that has verified fine on Vulcan/Triton so far. Only change
      // if you observe wrong values.
      send('TWS KNOTS',         r.tws,                        100)
      send('TWA',               r.twa,                        100)
      send('TWD',               r.windDirectionMagnetic,      100)
      send('OPTIMUM WIND ANGLE',r.optimumWindAngle,           10000)  // signedRad (per htool)
      send('VMG PERFORMANCE',   r.vmgPerf,                    1000)   // ratio

      send('TIDAL DRIFT',       r.currentSpeed,               100)    // m/s (was ms2kts!)
      send('TIDAL SET',         r.currentSet,                 10000)  // rad
      send('LEEWAY',            r.leeway,                     10000)  // rad
    }

    if(now-lastLog>LOG_THROTTLE_MS){ app.debug('[PerfCalc] out',JSON.stringify(r)); lastLog=now }
  }

  plugin.registerWithRouter = router => {
    router.get('/polar',(_,res) => {
      const polarPath = path.resolve(__dirname, plugin.options.polarFile || './polar_SY370_clean.csv')
      if (fs.existsSync(polarPath)) {
        res.type('text/csv').send(fs.readFileSync(polarPath, 'utf8'))
      } else {
        res.status(404).send('Polar file not found')
      }
    })
    router.get('/calibration',(_,res)=> res.json(calibration.calibrationData))
  }

  plugin.stop = () => { 
    unsubscribes.forEach(f=>f()); 
    unsubscribes=[]; 
    if(h5) {
      try {
        h5.stop()
      } catch (err) {
        app.error('[PerfCalc] Error stopping N2K emulator:', err)
      }
      h5 = null
    }
    app.debug('[PerfCalc] stopped') 
  }

  return plugin
}

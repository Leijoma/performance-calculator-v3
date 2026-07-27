// lib/Smoothers.js
// Data smoothing/filtering implementations for noisy sensor data
// Based on advancedwind plugin approach
// -----------------------------------------------------------------------------

// Base class for all smoothers
class Smoother {
  constructor(name = 'Smoother') {
    this.name = name
    this.value = null
    this.ready = false
  }

  // Update with new value and return smoothed result
  update(newValue, timestamp = Date.now()) {
    throw new Error('update() must be implemented by subclass')
  }

  // Reset the smoother state
  reset() {
    this.value = null
    this.ready = false
  }

  // Get the current smoothed value
  getValue() {
    return this.value
  }

  // Check if smoother has received enough data to be reliable
  isReady() {
    return this.ready
  }
}

// Pass-through smoother - no filtering, just returns input value
class PassThroughSmoother extends Smoother {
  constructor() {
    super('PassThrough')
  }

  update(newValue) {
    this.value = newValue
    this.ready = newValue != null
    return this.value
  }
}

// Exponential smoother - good for general purpose smoothing
// Formula: smoothed = smoothed + α * (newValue - smoothed)
// where α = 1 - e^(-Δt / τ)
//
// τ (tau) = time constant in milliseconds
// - Smaller τ (e.g., 1000ms) = faster response, less smoothing
// - Larger τ (e.g., 5000ms) = slower response, more smoothing
//
// Typical values:
// - Fast sensors (wind): τ = 1000-2000ms
// - Medium (speed): τ = 2000-3000ms
// - Slow (heading): τ = 3000-5000ms
class ExponentialSmoother extends Smoother {
  constructor(tau = 2000) {
    super('Exponential')
    this.tau = tau  // Time constant in ms
    this.lastTimestamp = null
  }

  update(newValue, timestamp = Date.now()) {
    if (newValue == null) return this.value

    if (this.value == null) {
      // First value - no smoothing
      this.value = newValue
      this.lastTimestamp = timestamp
      this.ready = true
      return this.value
    }

    // Calculate time delta
    const dt = timestamp - this.lastTimestamp
    this.lastTimestamp = timestamp

    // Calculate smoothing factor
    // α approaches 1 as dt increases (more weight on new value)
    // α approaches 0 as tau increases (more smoothing)
    const alpha = 1 - Math.exp(-dt / this.tau)

    // Apply exponential smoothing
    this.value = this.value + alpha * (newValue - this.value)

    return this.value
  }

  reset() {
    super.reset()
    this.lastTimestamp = null
  }

  // Update time constant
  setTau(tau) {
    this.tau = tau
  }
}

// Moving average smoother - averages last N samples
// Good for removing high-frequency noise
//
// windowSize = number of samples to average
// - Smaller window (e.g., 5) = faster response
// - Larger window (e.g., 20) = more smoothing
//
// Typical values:
// - Fast data (10Hz): window = 10-20 samples
// - Medium data (5Hz): window = 5-10 samples
// - Slow data (1Hz): window = 3-5 samples
class MovingAverageSmoother extends Smoother {
  constructor(windowSize = 10) {
    super('MovingAverage')
    this.windowSize = windowSize
    this.buffer = []
  }

  update(newValue, timestamp = Date.now()) {
    if (newValue == null) return this.value

    // Add new value to buffer
    this.buffer.push(newValue)

    // Remove oldest value if buffer exceeds window size
    if (this.buffer.length > this.windowSize) {
      this.buffer.shift()
    }

    // Calculate average
    const sum = this.buffer.reduce((acc, val) => acc + val, 0)
    this.value = sum / this.buffer.length

    // Mark as ready when buffer is full
    this.ready = this.buffer.length >= this.windowSize

    return this.value
  }

  reset() {
    super.reset()
    this.buffer = []
  }

  // Update window size
  setWindowSize(size) {
    this.windowSize = size
    // Trim buffer if needed
    if (this.buffer.length > size) {
      this.buffer = this.buffer.slice(-size)
    }
  }
}

// Kalman filter - optimal for linear systems with Gaussian noise
// Simplified 1D Kalman filter with configurable process and measurement noise
//
// processNoise = how much the true value can change between samples (Q)
// measurementNoise = how noisy the sensor readings are (R)
//
// Typical starting values:
// - Process noise (Q): 0.001 to 0.01
// - Measurement noise (R): 0.1 to 1.0
//
// Higher Q/R ratio = trust measurements more (faster response)
// Lower Q/R ratio = trust model more (smoother output)
class KalmanSmoother extends Smoother {
  constructor(processNoise = 0.01, measurementNoise = 0.5) {
    super('Kalman')
    this.Q = processNoise      // Process noise covariance
    this.R = measurementNoise  // Measurement noise covariance
    this.P = 1.0               // Estimation error covariance
    this.K = 0                 // Kalman gain
  }

  update(newValue, timestamp = Date.now()) {
    if (newValue == null) return this.value

    if (this.value == null) {
      // First measurement - initialize
      this.value = newValue
      this.P = 1.0
      this.ready = true
      return this.value
    }

    // Prediction step
    // Assuming constant value model (no velocity term)
    // P = P + Q
    this.P = this.P + this.Q

    // Update step
    // K = P / (P + R)
    this.K = this.P / (this.P + this.R)

    // value = value + K * (measurement - value)
    this.value = this.value + this.K * (newValue - this.value)

    // P = (1 - K) * P
    this.P = (1 - this.K) * this.P

    return this.value
  }

  reset() {
    super.reset()
    this.P = 1.0
    this.K = 0
  }

  // Update noise parameters
  setNoise(processNoise, measurementNoise) {
    this.Q = processNoise
    this.R = measurementNoise
  }
}

// Factory function to create smoothers from configuration
function createSmoother(config) {
  const type = config.type || 'passthrough'

  switch (type.toLowerCase()) {
    case 'passthrough':
    case 'none':
      return new PassThroughSmoother()

    case 'exponential':
    case 'exp':
      return new ExponentialSmoother(config.tau || 2000)

    case 'movingaverage':
    case 'ma':
      return new MovingAverageSmoother(config.windowSize || 10)

    case 'kalman':
      return new KalmanSmoother(
        config.processNoise || 0.01,
        config.measurementNoise || 0.5
      )

    default:
      console.warn(`[Smoothers] Unknown smoother type: ${type}, using PassThrough`)
      return new PassThroughSmoother()
  }
}

module.exports = {
  Smoother,
  PassThroughSmoother,
  ExponentialSmoother,
  MovingAverageSmoother,
  KalmanSmoother,
  createSmoother
}

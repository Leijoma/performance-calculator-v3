// interpolator.js
// Enkel 1D-interpolator med linjär interpolation

function createInterpolator(xs, ys) {
  return function(x) {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1];

    for (let i = 0; i < xs.length - 1; i++) {
      if (x >= xs[i] && x <= xs[i + 1]) {
        const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
        return ys[i] * (1 - t) + ys[i + 1] * t;
      }
    }
    return null; // borde aldrig hända
  };
}

module.exports = {
  createInterpolator
};

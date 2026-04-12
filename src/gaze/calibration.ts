// 9-point calibration: fit an affine map from raw gaze (range roughly
// [-1, 1]) to normalized screen coordinates [0, 1]. Pure math, no React.
//
// Model:
//     screenX = mxx * rawX + mxy * rawY + bx
//     screenY = myx * rawX + myy * rawY + by
//
// We fit it as two independent 2D linear regressions (one for X, one for Y)
// via the 3x3 normal equations. Over 9 points this is very over-determined
// and extremely cheap — a few hundred flops. Good enough for a prototype.

export interface RawPoint {
  x: number;
  y: number;
}

export interface CalibrationSample {
  /** Raw gaze estimate ∈ roughly [-1, 1]. */
  raw: RawPoint;
  /** Calibration target in normalized viewport coordinates ∈ [0, 1]. */
  target: RawPoint;
}

export interface CalibrationModel {
  mxx: number;
  mxy: number;
  bx: number;
  myx: number;
  myy: number;
  by: number;
}

export const IDENTITY_CALIBRATION: CalibrationModel = {
  mxx: 0.5,
  mxy: 0,
  bx: 0.5,
  myx: 0,
  myy: 0.5,
  by: 0.5,
};

/**
 * The 9 targets Lumen uses for calibration, in normalized [0, 1] coords.
 * Order: top-left → bottom-right, row major. Edge insets keep dots away
 * from the extreme corner where gaze estimation is least reliable.
 */
export const CALIBRATION_TARGETS: readonly RawPoint[] = [
  { x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.9, y: 0.1 },
  { x: 0.1, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.5 },
  { x: 0.1, y: 0.9 }, { x: 0.5, y: 0.9 }, { x: 0.9, y: 0.9 },
];

/**
 * Fit an affine model via 3x3 normal equations.
 * Throws if the samples are degenerate (e.g. all raw points collapse to a
 * single value). Caller should fall back to IDENTITY_CALIBRATION.
 */
export function fitAffine(samples: readonly CalibrationSample[]): CalibrationModel {
  if (samples.length < 3) {
    throw new Error(`Calibration needs at least 3 samples, got ${samples.length}`);
  }

  // Build A^T A (3x3) and A^T b for each axis.
  // A rows are [rawX, rawY, 1]; b is [targetX] or [targetY].
  let s_xx = 0;
  let s_xy = 0;
  let s_x = 0;
  let s_yy = 0;
  let s_y = 0;
  let n = 0;
  let atb_x_0 = 0;
  let atb_x_1 = 0;
  let atb_x_2 = 0;
  let atb_y_0 = 0;
  let atb_y_1 = 0;
  let atb_y_2 = 0;

  for (const sample of samples) {
    const rx = sample.raw.x;
    const ry = sample.raw.y;
    const tx = sample.target.x;
    const ty = sample.target.y;

    s_xx += rx * rx;
    s_xy += rx * ry;
    s_x += rx;
    s_yy += ry * ry;
    s_y += ry;
    n += 1;

    atb_x_0 += rx * tx;
    atb_x_1 += ry * tx;
    atb_x_2 += tx;

    atb_y_0 += rx * ty;
    atb_y_1 += ry * ty;
    atb_y_2 += ty;
  }

  // Normal equations matrix (same for both axes).
  const M: Matrix3 = [
    [s_xx, s_xy, s_x],
    [s_xy, s_yy, s_y],
    [s_x, s_y, n],
  ];

  const det = det3(M);
  if (Math.abs(det) < 1e-9) {
    throw new Error("Calibration samples are degenerate (zero determinant)");
  }

  const [mxx, mxy, bx] = solve3x3(M, [atb_x_0, atb_x_1, atb_x_2], det);
  const [myx, myy, by] = solve3x3(M, [atb_y_0, atb_y_1, atb_y_2], det);

  return { mxx, mxy, bx, myx, myy, by };
}

/**
 * Apply a calibration model. Returns normalized screen coords in [0, 1],
 * clamped so runaway predictions don't escape the viewport.
 */
export function applyCalibration(model: CalibrationModel, raw: RawPoint): RawPoint {
  const x = model.mxx * raw.x + model.mxy * raw.y + model.bx;
  const y = model.myx * raw.x + model.myy * raw.y + model.by;
  return { x: clamp01(x), y: clamp01(y) };
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// --- 3x3 linear algebra helpers --------------------------------------------

type Matrix3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

function det3(m: Matrix3): number {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

/** Solve M x = rhs via Cramer's rule, given the precomputed det. */
function solve3x3(m: Matrix3, rhs: [number, number, number], det: number): [number, number, number] {
  const replaceCol = (col: 0 | 1 | 2): Matrix3 => {
    const out: Matrix3 = [
      [m[0][0], m[0][1], m[0][2]],
      [m[1][0], m[1][1], m[1][2]],
      [m[2][0], m[2][1], m[2][2]],
    ];
    out[0][col] = rhs[0];
    out[1][col] = rhs[1];
    out[2][col] = rhs[2];
    return out;
  };
  const x = det3(replaceCol(0)) / det;
  const y = det3(replaceCol(1)) / det;
  const z = det3(replaceCol(2)) / det;
  return [x, y, z];
}

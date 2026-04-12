import { describe, expect, it } from "vitest";
import {
  applyCalibration,
  CALIBRATION_TARGETS,
  fitAffine,
  type CalibrationModel,
  type CalibrationSample,
  type RawPoint,
} from "./calibration";

/**
 * Build a synthetic set of samples by running each calibration target
 * through the inverse of a known affine transform, so that fitAffine
 * *must* recover it.
 *
 *   screen = M * raw + b
 *   raw    = M^{-1} * (screen - b)
 */
function synthesizeSamples(truth: CalibrationModel): CalibrationSample[] {
  // Invert the 2x2 M matrix analytically.
  const det = truth.mxx * truth.myy - truth.mxy * truth.myx;
  const inv = {
    m00: truth.myy / det,
    m01: -truth.mxy / det,
    m10: -truth.myx / det,
    m11: truth.mxx / det,
  };
  return CALIBRATION_TARGETS.map((target) => {
    const sx = target.x - truth.bx;
    const sy = target.y - truth.by;
    const raw: RawPoint = {
      x: inv.m00 * sx + inv.m01 * sy,
      y: inv.m10 * sx + inv.m11 * sy,
    };
    return { raw, target };
  });
}

describe("fitAffine", () => {
  it("recovers a known identity-like model exactly", () => {
    const truth: CalibrationModel = {
      mxx: 0.5, mxy: 0, bx: 0.5,
      myx: 0, myy: 0.5, by: 0.5,
    };
    const samples = synthesizeSamples(truth);
    const fit = fitAffine(samples);
    expect(fit.mxx).toBeCloseTo(truth.mxx, 9);
    expect(fit.mxy).toBeCloseTo(truth.mxy, 9);
    expect(fit.bx).toBeCloseTo(truth.bx, 9);
    expect(fit.myx).toBeCloseTo(truth.myx, 9);
    expect(fit.myy).toBeCloseTo(truth.myy, 9);
    expect(fit.by).toBeCloseTo(truth.by, 9);
  });

  it("recovers a skewed, asymmetric model", () => {
    const truth: CalibrationModel = {
      mxx: 0.42, mxy: 0.08, bx: 0.55,
      myx: -0.03, myy: 0.61, by: 0.47,
    };
    const samples = synthesizeSamples(truth);
    const fit = fitAffine(samples);
    expect(fit.mxx).toBeCloseTo(truth.mxx, 6);
    expect(fit.mxy).toBeCloseTo(truth.mxy, 6);
    expect(fit.bx).toBeCloseTo(truth.bx, 6);
    expect(fit.myx).toBeCloseTo(truth.myx, 6);
    expect(fit.myy).toBeCloseTo(truth.myy, 6);
    expect(fit.by).toBeCloseTo(truth.by, 6);
  });

  it("is robust to per-sample gaussian noise", () => {
    const truth: CalibrationModel = {
      mxx: 0.45, mxy: 0, bx: 0.5,
      myx: 0, myy: 0.55, by: 0.5,
    };
    const samples = synthesizeSamples(truth);
    // Deterministic pseudo-random jitter (±0.01 in raw space).
    const noisy = samples.map((s, i) => ({
      raw: {
        x: s.raw.x + jitter(i * 2) * 0.01,
        y: s.raw.y + jitter(i * 2 + 1) * 0.01,
      },
      target: s.target,
    }));
    const fit = fitAffine(noisy);
    // Coefficients should still be close to the truth within the noise
    // budget (~0.05). This is a smoke test for "fit is stable".
    expect(Math.abs(fit.mxx - truth.mxx)).toBeLessThan(0.1);
    expect(Math.abs(fit.myy - truth.myy)).toBeLessThan(0.1);
    expect(Math.abs(fit.bx - truth.bx)).toBeLessThan(0.05);
    expect(Math.abs(fit.by - truth.by)).toBeLessThan(0.05);
  });

  it("throws on too-few samples", () => {
    expect(() => fitAffine([])).toThrow();
    expect(() =>
      fitAffine([
        { raw: { x: 0, y: 0 }, target: { x: 0, y: 0 } },
        { raw: { x: 1, y: 1 }, target: { x: 1, y: 1 } },
      ]),
    ).toThrow();
  });

  it("throws on degenerate (collinear) samples", () => {
    // All raw points identical → normal equations are singular.
    const samples: CalibrationSample[] = CALIBRATION_TARGETS.map((target) => ({
      raw: { x: 0, y: 0 },
      target,
    }));
    expect(() => fitAffine(samples)).toThrow();
  });
});

describe("applyCalibration", () => {
  it("clamps results into [0, 1]", () => {
    const model: CalibrationModel = {
      mxx: 10, mxy: 0, bx: 0,
      myx: 0, myy: 10, by: 0,
    };
    const out = applyCalibration(model, { x: 1, y: -1 });
    expect(out.x).toBe(1);
    expect(out.y).toBe(0);
  });

  it("is the inverse of synthesized samples (round-trip)", () => {
    const truth: CalibrationModel = {
      mxx: 0.5, mxy: 0.05, bx: 0.5,
      myx: -0.02, myy: 0.52, by: 0.5,
    };
    const samples = synthesizeSamples(truth);
    const fit = fitAffine(samples);
    for (const sample of samples) {
      const screen = applyCalibration(fit, sample.raw);
      expect(screen.x).toBeCloseTo(sample.target.x, 6);
      expect(screen.y).toBeCloseTo(sample.target.y, 6);
    }
  });
});

// Deterministic zero-mean pseudo-noise in [-1, 1].
function jitter(i: number): number {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

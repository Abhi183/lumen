// One-Euro filter — Casiez, Roussel, Vogel (2012).
//
// A low-pass filter whose cutoff frequency adapts to signal speed:
//   - When the input is slow/still, the cutoff is very low → heavy smoothing.
//   - When the input moves fast (real eye saccade), the cutoff rises →
//     the filter "lets through" the fast motion with minimal lag.
//
// The tradeoff is governed by two knobs:
//   - minCutoff : baseline cutoff when the user is still (lower = smoother).
//   - beta      : how aggressively cutoff rises with speed (higher = less
//                 lag but more jitter during motion).
//
// This is the same filter that Windows, Oculus, and several iris trackers
// use for cursor smoothing. For AAC gaze we want a very conservative
// baseline so microsaccades don't move the dot.

export interface OneEuroConfig {
  /** Minimum cutoff frequency in Hz. Lower → smoother when still. */
  minCutoff: number;
  /** Speed coefficient. Higher → less lag when moving. */
  beta: number;
  /** Cutoff for the derivative low-pass (usually 1.0). */
  dCutoff: number;
}

export const DEFAULT_ONE_EURO: OneEuroConfig = {
  minCutoff: 1.0,
  beta: 0.05,
  dCutoff: 1.0,
};

export class OneEuroFilter {
  private config: OneEuroConfig;
  private prevX: number | null = null;
  private prevDx = 0;
  private prevT: number | null = null;

  constructor(config: OneEuroConfig = DEFAULT_ONE_EURO) {
    this.config = config;
  }

  setConfig(config: OneEuroConfig): void {
    this.config = config;
  }

  reset(): void {
    this.prevX = null;
    this.prevDx = 0;
    this.prevT = null;
  }

  /**
   * Push a new sample and return the filtered value.
   * `tMs` should be a monotonic timestamp in milliseconds (e.g. performance.now()).
   */
  filter(x: number, tMs: number): number {
    if (this.prevX === null || this.prevT === null) {
      this.prevX = x;
      this.prevT = tMs;
      this.prevDx = 0;
      return x;
    }

    const dtMs = tMs - this.prevT;
    // Guard against zero/negative dt (clock jumps, duplicate frames).
    const dt = Math.max(dtMs, 1) / 1000;

    const dxRaw = (x - this.prevX) / dt;
    const aD = alpha(this.config.dCutoff, dt);
    const dx = aD * dxRaw + (1 - aD) * this.prevDx;

    const cutoff = this.config.minCutoff + this.config.beta * Math.abs(dx);
    const a = alpha(cutoff, dt);
    const filtered = a * x + (1 - a) * this.prevX;

    this.prevX = filtered;
    this.prevDx = dx;
    this.prevT = tMs;
    return filtered;
  }
}

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

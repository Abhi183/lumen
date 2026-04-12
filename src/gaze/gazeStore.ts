// Module-level pub/sub for the gaze pipeline.
//
// One GazeEngine produces frames at rAF rate. Multiple screens subscribe
// to just what they need. Subscribers typically update refs/DOM directly
// and only call React setState when "interesting" state transitions happen
// (e.g. dwell fired) — we do not want 60 re-renders per second.
//
// Two parallel views of the gaze are published in every frame:
//   - `raw`          — pre-calibration, post-One-Euro smoothing. Use for
//                      the dot, the dwell detector, and any UI feedback.
//   - `rawUnsmoothed` — pre-calibration, pre-filter. Used by calibration
//                      so the filter's momentum doesn't bias per-target
//                      centroids. Calibration averages 600ms of frames,
//                      so it does its own low-pass implicitly.

import { applyCalibration, type CalibrationModel } from "./calibration";
import type { GazeEstimate } from "./gazeEstimator";
import { OneEuroFilter } from "./oneEuroFilter";

/** Slim diagnostics: just the points the gaze estimator actually reads. */
export interface DebugLandmarks {
  /** Eye A iris center, in normalized image coords [0, 1]. */
  irisA: { x: number; y: number };
  /** Eye B iris center. */
  irisB: { x: number; y: number };
  /** Eye A box center (mean of corner + lid landmarks). */
  centerA: { x: number; y: number };
  /** Eye B box center. */
  centerB: { x: number; y: number };
  /** Eye A bounding box (outer/inner/top/bottom envelope). */
  boxA: { x: number; y: number; width: number; height: number };
  /** Eye B bounding box. */
  boxB: { x: number; y: number; width: number; height: number };
}

export interface GazeFrame {
  /** Pre-calibration, post-smoothing gaze in roughly [-1, 1]. */
  raw: GazeEstimate;
  /** Pre-calibration, pre-filter gaze. Use for calibration sample capture. */
  rawUnsmoothed: GazeEstimate;
  /** Normalized viewport coords in [0, 1], null before calibration exists. */
  calibrated: { x: number; y: number } | null;
  /** Debug-only landmark snapshot. Always present so the overlay can draw it. */
  debug: DebugLandmarks | null;
  timestamp: number;
}

export type GazeListener = (frame: GazeFrame | null) => void;

class GazeStore {
  private calibration: CalibrationModel | null = null;
  private listeners = new Set<GazeListener>();
  private lastFrame: GazeFrame | null = null;

  // One filter per axis. Tuned for AAC: low baseline cutoff (1.2 Hz) so
  // microsaccades don't move the dot, modest beta (0.07) so deliberate
  // saccades still respond crisply.
  private filterX = new OneEuroFilter({ minCutoff: 1.2, beta: 0.07, dCutoff: 1.0 });
  private filterY = new OneEuroFilter({ minCutoff: 1.2, beta: 0.07, dCutoff: 1.0 });

  setCalibration(model: CalibrationModel | null): void {
    this.calibration = model;
    // Fresh filter state when calibration changes — no carry-over from
    // pre-calibration drift into the live keyboard.
    this.resetFilter();
  }

  hasCalibration(): boolean {
    return this.calibration !== null;
  }

  getLastFrame(): GazeFrame | null {
    return this.lastFrame;
  }

  /**
   * Reset the smoothing state — call when the user pauses or after a
   * deliberate jump (e.g. screen change), so the filter doesn't carry
   * stale momentum into a fresh fixation.
   */
  resetFilter(): void {
    this.filterX.reset();
    this.filterY.reset();
  }

  push(raw: GazeEstimate | null, timestamp: number, debug: DebugLandmarks | null = null): void {
    if (raw === null) {
      this.lastFrame = null;
      this.emit(null);
      return;
    }

    // Smooth raw gaze before publishing.
    const fx = this.filterX.filter(raw.x, timestamp);
    const fy = this.filterY.filter(raw.y, timestamp);
    const smoothed: GazeEstimate = {
      x: fx,
      y: fy,
      confidence: raw.confidence,
    };

    const calibrated = this.calibration
      ? applyCalibration(this.calibration, { x: smoothed.x, y: smoothed.y })
      : null;

    const frame: GazeFrame = {
      raw: smoothed,
      rawUnsmoothed: raw,
      calibrated,
      debug,
      timestamp,
    };
    this.lastFrame = frame;
    this.emit(frame);
  }

  subscribe(listener: GazeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(frame: GazeFrame | null): void {
    // Snapshot listeners so unsubscribe-during-emit is safe.
    const snapshot = Array.from(this.listeners);
    for (const l of snapshot) l(frame);
  }
}

export const gazeStore = new GazeStore();

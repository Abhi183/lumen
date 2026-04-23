// Pointer-driven gaze substitute. Plumbs mouse / touch coordinates into
// the same GazeFrame shape the rest of the app consumes, so the keyboard
// and dwell detector don't need to know whether the input is an eye or a
// cursor. Used when the user chooses "Try without webcam" on the boot
// screen, or when the webcam is blocked / unavailable.
//
// This is not a substitute for the real gaze pipeline for AAC users. It
// exists so reviewers, journalists, and caregivers can try the keyboard
// flow without camera access, and so the app is demonstrable offline.

import { gazeStore } from "./gazeStore";
import type { GazeEstimate } from "./gazeEstimator";

let active = false;
let lastPx = { x: 0, y: 0 };
let rafHandle: number | null = null;

function pumpFrame(): void {
  const w = window.innerWidth || 1;
  const h = window.innerHeight || 1;
  // Map pointer px → normalized [-1, 1] raw gaze so the calibrated path is
  // still exercised end-to-end. A pointer at screen center produces (0, 0);
  // a pointer at the right edge produces (+1, ?).
  const raw: GazeEstimate = {
    x: Math.max(-1, Math.min(1, (lastPx.x / w) * 2 - 1)),
    y: Math.max(-1, Math.min(1, (lastPx.y / h) * 2 - 1)),
    confidence: 1,
  };
  gazeStore.push(raw, performance.now(), null);
  rafHandle = requestAnimationFrame(pumpFrame);
}

function onPointerMove(e: PointerEvent): void {
  lastPx = { x: e.clientX, y: e.clientY };
}

/**
 * Activate pointer-as-gaze. Also installs an identity-ish calibration so
 * that pointerStore works without running the 9-point flow first. The
 * calibration maps raw [-1, 1] → [0, 1] one-to-one (really an affine
 * y = 0.5 x + 0.5 on each axis).
 */
export function startPointerMode(): void {
  if (active) return;
  active = true;
  gazeStore.setCalibration({
    mxx: 0.5,
    mxy: 0,
    bx: 0.5,
    myx: 0,
    myy: 0.5,
    by: 0.5,
  });
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  rafHandle = requestAnimationFrame(pumpFrame);
}

export function stopPointerMode(): void {
  if (!active) return;
  active = false;
  window.removeEventListener("pointermove", onPointerMove);
  if (rafHandle != null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
}

export function isPointerMode(): boolean {
  return active;
}

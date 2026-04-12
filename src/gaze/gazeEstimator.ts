// Convert a FaceLandmarkerResult into a normalized gaze estimate.
//
// Approach (rewritten 2026-04-11 to fix a horizontal-cancellation bug):
//
//   1. For each eye, find the iris center (mean of the iris ring) and the
//      eye-box center (mean of the four corner/lid landmarks).
//   2. Compute the displacement (irisCenter − eyeCenter) in IMAGE space,
//      and normalize it by the eye width (horizontal) and height (vertical).
//   3. Average displacements across both eyes. Both eyes move the same way
//      in image space when looking at the same point, so averaging works.
//   4. Convert image-space → user-space gaze: negate x because the webcam
//      feed is unmirrored, so "user looking right" = "iris moving image-left".
//
// The previous implementation projected each iris onto an outer→inner axis,
// but that axis points opposite ways in the two eyes. Averaging cancelled
// horizontal motion entirely, leaving the dot only able to move vertically.

import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import type { DebugLandmarks } from "./gazeStore";

// MediaPipe Face Landmarker landmark indices (canonical 478-point set).
// "Eye A" = anatomical right eye (appears on the LEFT of an unmirrored
// webcam image). "Eye B" = anatomical left eye (appears on the RIGHT).
// The names are deliberately neutral — the math below works in image
// space and doesn't depend on which is which.
const EYE_A = {
  outer: 33,
  inner: 133,
  top: 159,
  bottom: 145,
  irisRing: [469, 470, 471, 472],
};

const EYE_B = {
  outer: 263,
  inner: 362,
  top: 386,
  bottom: 374,
  irisRing: [474, 475, 476, 477],
};

// Empirical scale factor: iris travels roughly ±0.2 of the eye width when
// looking corner-to-corner of a typical laptop screen. Multiply to spread
// raw gaze across [-1, 1]. Calibration will absorb residual scale.
const HORIZONTAL_SCALE = 4.0;
const VERTICAL_SCALE = 3.5;

export interface GazeEstimate {
  /** Normalized x in [-1, 1] from the user's perspective. -1 = far left, +1 = far right. */
  x: number;
  /** Normalized y in [-1, 1]. -1 = looking up, +1 = looking down. */
  y: number;
  /** 0..1 confidence based on eye openness (blendshapes). Closed eye → 0. */
  confidence: number;
}

interface Pt {
  x: number;
  y: number;
}

function meanPoints(points: readonly Pt[]): Pt {
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

function distance(a: Pt, b: Pt): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export interface GazeWithDebug {
  estimate: GazeEstimate;
  debug: DebugLandmarks;
}

/**
 * Estimate raw gaze direction from a FaceLandmarker result.
 * Returns null if no face / eyes are visible.
 */
export function estimateGaze(result: FaceLandmarkerResult): GazeWithDebug | null {
  const faces = result.faceLandmarks;
  if (!faces || faces.length === 0) return null;
  const landmarks = faces[0] as Pt[];
  if (landmarks.length < 478) return null;

  const A = eyeDisplacementFull(landmarks, EYE_A);
  const B = eyeDisplacementFull(landmarks, EYE_B);

  // Average displacements across both eyes. Both eyes move the same way
  // in image space when looking at the same point, so this is now safe.
  const avgDx = (A.dx + B.dx) / 2;
  const avgDy = (A.dy + B.dy) / 2;

  // Convert image space → user-perspective gaze. Image x increases left
  // to right; the webcam is unmirrored, so "user looking right" means the
  // iris is moving left in the image (negative dx). Negate to flip.
  const x = clamp(-avgDx * HORIZONTAL_SCALE, -1, 1);
  const y = clamp(avgDy * VERTICAL_SCALE, -1, 1);

  // Eye openness from blendshapes. Closed eye → low confidence.
  const blendshapes = result.faceBlendshapes?.[0]?.categories ?? [];
  const blinkL = blendshapes.find((c) => c.categoryName === "eyeBlinkLeft")?.score ?? 0;
  const blinkR = blendshapes.find((c) => c.categoryName === "eyeBlinkRight")?.score ?? 0;
  const openness = 1 - Math.max(blinkL, blinkR);
  const confidence = clamp(openness, 0, 1);

  const debug: DebugLandmarks = {
    irisA: A.iris,
    irisB: B.iris,
    centerA: A.center,
    centerB: B.center,
    boxA: A.box,
    boxB: B.box,
  };

  return { estimate: { x, y, confidence }, debug };
}

/** Same as eyeDisplacement but also returns iris/center/box for debug overlay. */
function eyeDisplacementFull(
  landmarks: readonly Pt[],
  eye: typeof EYE_A,
): {
  dx: number;
  dy: number;
  iris: Pt;
  center: Pt;
  box: { x: number; y: number; width: number; height: number };
} {
  const outer = landmarks[eye.outer];
  const inner = landmarks[eye.inner];
  const top = landmarks[eye.top];
  const bottom = landmarks[eye.bottom];
  const eyeWidth = distance(outer, inner) || 1e-6;
  const eyeHeight = distance(top, bottom) || 1e-6;
  const iris = meanPoints(eye.irisRing.map((i) => landmarks[i]));
  const center = meanPoints([outer, inner, top, bottom]);
  const minX = Math.min(outer.x, inner.x, top.x, bottom.x);
  const maxX = Math.max(outer.x, inner.x, top.x, bottom.x);
  const minY = Math.min(outer.y, inner.y, top.y, bottom.y);
  const maxY = Math.max(outer.y, inner.y, top.y, bottom.y);
  return {
    dx: (iris.x - center.x) / eyeWidth,
    dy: (iris.y - center.y) / eyeHeight,
    iris,
    center,
    box: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

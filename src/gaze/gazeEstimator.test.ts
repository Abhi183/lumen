// Synthetic-landmark tests for gaze estimator.
//
// MediaPipe FaceLandmarker results contain 478 normalized landmarks. We
// fabricate the smallest set of points the estimator actually reads
// (eye corners, lids, iris ring) and verify directional outputs.
//
// In particular: this test guards the bug where averaging two eyes whose
// outer→inner axes pointed in opposite directions cancelled horizontal
// gaze entirely.

import { describe, expect, it } from "vitest";
import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { estimateGaze } from "./gazeEstimator";

interface Pt { x: number; y: number }

/**
 * Build a fake FaceLandmarkerResult with both eyes positioned in image
 * space, and the iris of each eye optionally offset from the eye center.
 *
 * Eye A (anatomical right) sits on the LEFT of the image (at x≈0.4).
 * Eye B (anatomical left) sits on the RIGHT of the image (at x≈0.6).
 * Both have width 0.06 and height 0.025.
 *
 * `irisOffset` is added to BOTH iris centers in image-space units. For
 * example: { x: +0.01, y: 0 } means both irises are pushed image-right
 * by 0.01 — the situation when the user is looking to their left.
 */
function fakeFace(irisOffset: Pt = { x: 0, y: 0 }): FaceLandmarkerResult {
  const landmarks: Pt[] = new Array(478).fill(null).map(() => ({ x: 0, y: 0 }));

  // Eye A (right eye, image-left).
  const A_OUTER = { x: 0.37, y: 0.45 }; // image left of the eye
  const A_INNER = { x: 0.43, y: 0.45 }; // image right of the eye
  const A_TOP = { x: 0.40, y: 0.4375 };
  const A_BOTTOM = { x: 0.40, y: 0.4625 };
  landmarks[33] = A_OUTER;
  landmarks[133] = A_INNER;
  landmarks[159] = A_TOP;
  landmarks[145] = A_BOTTOM;

  // Eye B (left eye, image-right).
  const B_OUTER = { x: 0.63, y: 0.45 }; // image right of the eye
  const B_INNER = { x: 0.57, y: 0.45 }; // image left of the eye
  const B_TOP = { x: 0.60, y: 0.4375 };
  const B_BOTTOM = { x: 0.60, y: 0.4625 };
  landmarks[263] = B_OUTER;
  landmarks[362] = B_INNER;
  landmarks[386] = B_TOP;
  landmarks[374] = B_BOTTOM;

  // Iris ring centers (we use the mean of the 4 ring landmarks, so put
  // each ring as a tight cross around the iris center).
  const A_IRIS = { x: 0.40 + irisOffset.x, y: 0.45 + irisOffset.y };
  const B_IRIS = { x: 0.60 + irisOffset.x, y: 0.45 + irisOffset.y };
  for (const i of [469, 470, 471, 472]) landmarks[i] = A_IRIS;
  for (const i of [474, 475, 476, 477]) landmarks[i] = B_IRIS;

  return {
    faceLandmarks: [landmarks],
    faceBlendshapes: [
      {
        categories: [
          { index: 0, score: 0, categoryName: "eyeBlinkLeft", displayName: "" },
          { index: 1, score: 0, categoryName: "eyeBlinkRight", displayName: "" },
        ],
        headIndex: 0,
        headName: "",
      },
    ],
    facialTransformationMatrixes: [],
  } as unknown as FaceLandmarkerResult;
}

describe("estimateGaze", () => {
  it("returns (0, 0) when both irises sit at the eye-box centers", () => {
    const out = estimateGaze(fakeFace({ x: 0, y: 0 }));
    expect(out).not.toBeNull();
    expect(out!.estimate.x).toBeCloseTo(0, 6);
    expect(out!.estimate.y).toBeCloseTo(0, 6);
  });

  it("reports POSITIVE x when both irises move image-LEFT (user looking right)", () => {
    // User looking right: irises move toward image-left (negative dx).
    // Estimator should output positive x in user-perspective coords.
    const out = estimateGaze(fakeFace({ x: -0.01, y: 0 }));
    expect(out).not.toBeNull();
    expect(out!.estimate.x).toBeGreaterThan(0.1);
    expect(Math.abs(out!.estimate.y)).toBeLessThan(0.05);
  });

  it("reports NEGATIVE x when both irises move image-RIGHT (user looking left)", () => {
    // User looking left: irises move toward image-right (positive dx).
    // Estimator should output negative x.
    const out = estimateGaze(fakeFace({ x: +0.01, y: 0 }));
    expect(out).not.toBeNull();
    expect(out!.estimate.x).toBeLessThan(-0.1);
    expect(Math.abs(out!.estimate.y)).toBeLessThan(0.05);
  });

  it("reports NEGATIVE y when irises move image-UP (user looking up)", () => {
    const out = estimateGaze(fakeFace({ x: 0, y: -0.005 }));
    expect(out).not.toBeNull();
    expect(out!.estimate.y).toBeLessThan(-0.1);
    expect(Math.abs(out!.estimate.x)).toBeLessThan(0.05);
  });

  it("reports POSITIVE y when irises move image-DOWN (user looking down)", () => {
    const out = estimateGaze(fakeFace({ x: 0, y: +0.005 }));
    expect(out).not.toBeNull();
    expect(out!.estimate.y).toBeGreaterThan(0.1);
    expect(Math.abs(out!.estimate.x)).toBeLessThan(0.05);
  });

  it("REGRESSION: horizontal motion is NOT cancelled by averaging both eyes", () => {
    // Critical: prior implementation projected each iris onto an
    // outer→inner axis that pointed in opposite directions for the two
    // eyes. Averaging produced ~0 horizontal output. Guard against that.
    const left = estimateGaze(fakeFace({ x: +0.01, y: 0 }));
    const right = estimateGaze(fakeFace({ x: -0.01, y: 0 }));
    // The two should be on opposite sides of zero with comparable magnitudes.
    expect(left!.estimate.x).toBeLessThan(0);
    expect(right!.estimate.x).toBeGreaterThan(0);
    expect(Math.abs(left!.estimate.x - right!.estimate.x)).toBeGreaterThan(0.4);
  });

  it("returns null on empty face landmarks", () => {
    const empty = { faceLandmarks: [], faceBlendshapes: [], facialTransformationMatrixes: [] } as unknown as FaceLandmarkerResult;
    expect(estimateGaze(empty)).toBeNull();
  });
});

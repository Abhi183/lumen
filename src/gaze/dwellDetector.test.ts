import { beforeEach, describe, expect, it } from "vitest";
import { DwellDetector, type DwellTarget } from "./dwellDetector";

const RECT_A: DwellTarget = {
  id: "A",
  rect: { x: 0, y: 0, width: 100, height: 100 },
};
const RECT_B: DwellTarget = {
  id: "B",
  rect: { x: 200, y: 0, width: 100, height: 100 },
};
const TARGETS = [RECT_A, RECT_B] as const;

describe("DwellDetector", () => {
  let d: DwellDetector;

  beforeEach(() => {
    d = new DwellDetector({ dwellMs: 500, stickyMargin: 0.15 });
  });

  it("reports null when the gaze is outside every target", () => {
    const u = d.update({ x: 9999, y: 9999 }, 0, TARGETS);
    expect(u.hoverId).toBeNull();
    expect(u.progress).toBe(0);
    expect(u.fired).toBeNull();
  });

  it("ramps progress while the gaze stays inside a target", () => {
    const u1 = d.update({ x: 50, y: 50 }, 0, TARGETS);
    const u2 = d.update({ x: 50, y: 50 }, 250, TARGETS);
    const u3 = d.update({ x: 50, y: 50 }, 499, TARGETS);
    expect(u1.hoverId).toBe("A");
    expect(u1.progress).toBe(0);
    expect(u1.fired).toBeNull();
    expect(u2.progress).toBeCloseTo(0.5, 2);
    expect(u2.fired).toBeNull();
    expect(u3.fired).toBeNull();
  });

  it("fires exactly once when dwellMs elapses", () => {
    d.update({ x: 50, y: 50 }, 0, TARGETS);
    const fire = d.update({ x: 50, y: 50 }, 500, TARGETS);
    expect(fire.fired).toBe("A");
    const again = d.update({ x: 50, y: 50 }, 1000, TARGETS);
    // Still hovering, must not fire again without leaving first.
    expect(again.fired).toBeNull();
  });

  it("re-arms after leaving the target", () => {
    d.update({ x: 50, y: 50 }, 0, TARGETS);
    const first = d.update({ x: 50, y: 50 }, 500, TARGETS);
    expect(first.fired).toBe("A");
    d.update({ x: 9999, y: 9999 }, 600, TARGETS);
    d.update({ x: 50, y: 50 }, 700, TARGETS);
    const second = d.update({ x: 50, y: 50 }, 1200, TARGETS);
    expect(second.fired).toBe("A");
  });

  it("resets the timer when the gaze moves to a different target", () => {
    d.update({ x: 50, y: 50 }, 0, TARGETS);
    d.update({ x: 50, y: 50 }, 400, TARGETS);
    // Jump to B — A's progress must be abandoned.
    const onB1 = d.update({ x: 250, y: 50 }, 450, TARGETS);
    expect(onB1.hoverId).toBe("B");
    expect(onB1.progress).toBe(0);
    // Holding B for another 500ms fires B, not A.
    const onB2 = d.update({ x: 250, y: 50 }, 950, TARGETS);
    expect(onB2.fired).toBe("B");
  });

  it("handles a null gaze point without firing or crashing", () => {
    d.update({ x: 50, y: 50 }, 0, TARGETS);
    const u = d.update(null, 100, TARGETS);
    expect(u.hoverId).toBeNull();
    expect(u.fired).toBeNull();
  });

  it("reset() clears all state", () => {
    d.update({ x: 50, y: 50 }, 0, TARGETS);
    d.update({ x: 50, y: 50 }, 500, TARGETS);
    d.reset();
    const u = d.update({ x: 50, y: 50 }, 600, TARGETS);
    expect(u.progress).toBe(0); // fresh hover
    expect(u.fired).toBeNull();
  });

  it("sticky margin keeps the hover when gaze briefly steps just outside the target", () => {
    // 15% margin on a 100px-wide target → tolerance of 15px on each side.
    // A point 10px past the right edge should still register as inside.
    d.update({ x: 50, y: 50 }, 0, TARGETS);
    d.update({ x: 50, y: 50 }, 100, TARGETS);
    const wobble = d.update({ x: 110, y: 50 }, 200, TARGETS);
    expect(wobble.hoverId).toBe("A");
    // Progress should keep accumulating, not reset.
    expect(wobble.progress).toBeGreaterThan(0.2);
  });

  it("sticky margin still allows committed escape to a different target", () => {
    d.update({ x: 50, y: 50 }, 0, TARGETS);
    d.update({ x: 50, y: 50 }, 100, TARGETS);
    // Jump well past the sticky boundary, into B's body.
    const onB = d.update({ x: 250, y: 50 }, 200, TARGETS);
    expect(onB.hoverId).toBe("B");
    expect(onB.progress).toBe(0);
  });
});

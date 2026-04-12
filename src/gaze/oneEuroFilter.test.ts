import { describe, expect, it } from "vitest";
import { OneEuroFilter } from "./oneEuroFilter";

function run(f: OneEuroFilter, samples: readonly number[], dtMs = 8.3): number[] {
  const out: number[] = [];
  let t = 0;
  for (const s of samples) {
    out.push(f.filter(s, t));
    t += dtMs;
  }
  return out;
}

describe("OneEuroFilter", () => {
  it("passes the first sample through unchanged", () => {
    const f = new OneEuroFilter();
    expect(f.filter(0.42, 0)).toBe(0.42);
  });

  it("heavily damps tiny oscillations around a stationary value", () => {
    const f = new OneEuroFilter({ minCutoff: 1.0, beta: 0.05, dCutoff: 1.0 });
    // 120Hz, ±0.02 jitter around 0.5 — microsaccade-like.
    const samples: number[] = [];
    for (let i = 0; i < 200; i++) {
      samples.push(0.5 + (i % 2 === 0 ? 0.02 : -0.02));
    }
    const filtered = run(f, samples);
    // After the warmup, the filtered signal should be well inside the
    // jitter envelope.
    const tail = filtered.slice(-30);
    const range = Math.max(...tail) - Math.min(...tail);
    expect(range).toBeLessThan(0.01);
  });

  it("tracks a real ramp with bounded lag", () => {
    const f = new OneEuroFilter({ minCutoff: 1.0, beta: 0.5, dCutoff: 1.0 });
    // Large, fast step from 0 → 1 over 20 frames.
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) samples.push(i / 19);
    const filtered = run(f, samples);
    // After 20 frames at 120fps (~0.17 s), filter should be close to the
    // end of the ramp — i.e. it hasn't fossilized.
    const last = filtered[filtered.length - 1];
    expect(last).toBeGreaterThan(0.6);
    expect(last).toBeLessThanOrEqual(1);
  });

  it("reset() clears the filter state", () => {
    const f = new OneEuroFilter();
    run(f, [0.1, 0.2, 0.3]);
    f.reset();
    // First sample after reset should pass through unchanged.
    expect(f.filter(0.77, 0)).toBe(0.77);
  });
});

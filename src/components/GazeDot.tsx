// Debug overlay: a glowing dot that tracks the user's gaze.
//
// Renders to a full-viewport canvas. Subscribes to gazeStore and updates
// the canvas imperatively — no React re-render per frame.

import { useEffect, useRef } from "react";
import { gazeStore, type GazeFrame } from "../gaze/gazeStore";

interface GazeDotProps {
  /**
   * Which coordinate source to draw.
   * - "raw"        : draws normalized raw gaze in the dot's parent bounds.
   * - "calibrated" : draws calibrated gaze in full viewport coords.
   *
   * Use "raw" pre-calibration so the user still gets visual feedback; use
   * "calibrated" on the keyboard screen for accurate targeting.
   */
  source: "raw" | "calibrated";
}

export function GazeDot({ source }: GazeDotProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Exponential smoothing lives in a ref so it persists across subscription
  // updates without triggering re-renders.
  const smoothedRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = (frame: GazeFrame | null) => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== Math.round(rect.width * dpr)) {
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);

      if (!frame) {
        smoothedRef.current = null;
        return;
      }

      const point = readPoint(frame, source, rect);
      if (!point) return;

      // Exponential smoothing (α = 0.35 ≈ 80ms half-life at 60fps).
      const alpha = 0.35;
      const prev = smoothedRef.current;
      const next = prev
        ? { x: prev.x * (1 - alpha) + point.x * alpha, y: prev.y * (1 - alpha) + point.y * alpha }
        : point;
      smoothedRef.current = next;

      const confidence = frame.raw.confidence;
      drawGlow(ctx, next.x, next.y, confidence);
    };

    const unsubscribe = gazeStore.subscribe(draw);
    return unsubscribe;
  }, [source]);

  return <canvas ref={canvasRef} className="gaze-dot-canvas" />;
}

function readPoint(
  frame: GazeFrame,
  source: "raw" | "calibrated",
  rect: DOMRect,
): { x: number; y: number } | null {
  if (source === "raw") {
    // Raw gaze is already in user-perspective coords ∈ [-1, 1]:
    //   +1 = looking far right of the screen
    //   -1 = looking far left
    //   +1 = looking down
    //   -1 = looking up
    // Map directly to the parent rect — no flip needed.
    const nx = 0.5 + frame.raw.x * 0.5;
    const ny = 0.5 + frame.raw.y * 0.5;
    return { x: rect.width * nx, y: rect.height * ny };
  }
  if (!frame.calibrated) return null;
  return { x: frame.calibrated.x * rect.width, y: frame.calibrated.y * rect.height };
}

function drawGlow(ctx: CanvasRenderingContext2D, cx: number, cy: number, confidence: number): void {
  const r = 22;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 3);
  glow.addColorStop(0, `rgba(140, 210, 255, ${0.85 * confidence})`);
  glow.addColorStop(0.5, `rgba(100, 180, 255, ${0.35 * confidence})`);
  glow.addColorStop(1, "rgba(100, 180, 255, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgba(255, 255, 255, ${confidence})`;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
  ctx.fill();
}

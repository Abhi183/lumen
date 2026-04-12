// Diagnostic overlay: draws the landmarks the gaze estimator actually
// reads (eye-box envelopes, eye centers, iris centers) on top of a
// mirrored, low-opacity copy of the webcam feed.
//
// Use this to verify visually that:
//   1. MediaPipe is finding eyes at all.
//   2. The eye-box rectangles roughly match the user's eyes.
//   3. The iris centers track the user's gaze (move when the eye moves).
//
// If those things look right but the dot still doesn't follow, the bug
// is downstream of the estimator.

import { useEffect, useRef } from "react";
import { gazeStore, type GazeFrame } from "../gaze/gazeStore";

export function LandmarkOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

      if (!frame || !frame.debug) return;

      // The webcam image is unmirrored. Visually we want to show the user
      // their face the way they expect (mirrored). So we flip the X of
      // every drawn landmark: x' = 1 - x.
      const flipX = (x: number) => 1 - x;

      const W = rect.width;
      const H = rect.height;

      // Draw eye boxes.
      const drawBox = (
        b: { x: number; y: number; width: number; height: number },
        color: string,
      ) => {
        const x1 = flipX(b.x + b.width) * W;
        const y1 = b.y * H;
        const w = b.width * W;
        const h = b.height * H;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(x1, y1, w, h);
      };

      // Draw a labeled dot.
      const drawDot = (
        p: { x: number; y: number },
        color: string,
        radius = 5,
        label?: string,
      ) => {
        const cx = flipX(p.x) * W;
        const cy = p.y * H;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
        if (label) {
          ctx.font = "10px ui-monospace, monospace";
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          ctx.fillText(label, cx + 8, cy - 6);
        }
      };

      drawBox(frame.debug.boxA, "rgba(140, 210, 255, 0.6)");
      drawBox(frame.debug.boxB, "rgba(140, 210, 255, 0.6)");

      drawDot(frame.debug.centerA, "rgba(140, 210, 255, 0.9)", 4, "centerA");
      drawDot(frame.debug.centerB, "rgba(140, 210, 255, 0.9)", 4, "centerB");

      drawDot(frame.debug.irisA, "#9beac4", 5, "irisA");
      drawDot(frame.debug.irisB, "#9beac4", 5, "irisB");
    };

    const unsub = gazeStore.subscribe(draw);
    return unsub;
  }, []);

  return <canvas ref={canvasRef} className="landmark-overlay" />;
}

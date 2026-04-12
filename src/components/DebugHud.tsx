// Fixed-position diagnostic overlay. Subscribes to the gaze store and
// updates imperatively without re-rendering React. Visible by default
// during the prototype so we can diagnose "it doesn't track" reports.

import { useEffect, useRef } from "react";
import { gazeStore, type GazeFrame } from "../gaze/gazeStore";

export function DebugHud() {
  const rootRef = useRef<HTMLDivElement>(null);
  const faceRef = useRef<HTMLSpanElement>(null);
  const rawRef = useRef<HTMLSpanElement>(null);
  const calRef = useRef<HTMLSpanElement>(null);
  const confRef = useRef<HTMLSpanElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let lastTs = performance.now();
    let frames = 0;
    let fpsAccum = 0;

    const unsub = gazeStore.subscribe((frame: GazeFrame | null) => {
      const now = performance.now();
      frames += 1;
      fpsAccum += now - lastTs;
      lastTs = now;
      if (fpsAccum >= 500) {
        if (fpsRef.current) {
          fpsRef.current.textContent = `${Math.round((frames * 1000) / fpsAccum)}`;
        }
        frames = 0;
        fpsAccum = 0;
      }

      if (!frame) {
        if (faceRef.current) faceRef.current.textContent = "no";
        if (rawRef.current) rawRef.current.textContent = "—";
        if (calRef.current) calRef.current.textContent = "—";
        if (confRef.current) confRef.current.textContent = "—";
        return;
      }
      if (faceRef.current) faceRef.current.textContent = "yes";
      if (rawRef.current) {
        rawRef.current.textContent = `${frame.raw.x.toFixed(2)}, ${frame.raw.y.toFixed(2)}`;
      }
      if (confRef.current) {
        confRef.current.textContent = frame.raw.confidence.toFixed(2);
      }
      if (calRef.current) {
        calRef.current.textContent = frame.calibrated
          ? `${frame.calibrated.x.toFixed(2)}, ${frame.calibrated.y.toFixed(2)}`
          : "(no calib)";
      }
    });
    return unsub;
  }, []);

  return (
    <div ref={rootRef} className="debug-hud">
      <div className="debug-row">
        <label>face</label>
        <span ref={faceRef}>—</span>
      </div>
      <div className="debug-row">
        <label>raw</label>
        <span ref={rawRef}>—</span>
      </div>
      <div className="debug-row">
        <label>calib</label>
        <span ref={calRef}>—</span>
      </div>
      <div className="debug-row">
        <label>conf</label>
        <span ref={confRef}>—</span>
      </div>
      <div className="debug-row">
        <label>fps</label>
        <span ref={fpsRef}>—</span>
      </div>
    </div>
  );
}

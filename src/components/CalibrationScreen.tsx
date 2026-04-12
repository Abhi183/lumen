// 9-point calibration flow.
//
// For each target, we wait 500ms for the user's gaze to settle, then
// collect 600ms of raw samples and average them. After all 9, we fit an
// affine model and hand it back. If the fit fails (degenerate samples),
// we report the error so the UI can suggest retrying.

import { useEffect, useRef, useState } from "react";
import {
  CALIBRATION_TARGETS,
  fitAffine,
  type CalibrationModel,
  type CalibrationSample,
  type RawPoint,
} from "../gaze/calibration";
import { gazeStore, type GazeFrame } from "../gaze/gazeStore";

const SETTLE_MS = 500;
const CAPTURE_MS = 600;

interface CalibrationScreenProps {
  onComplete: (model: CalibrationModel) => void;
  onCancel?: () => void;
}

type Phase =
  | { kind: "intro" }
  | { kind: "settle"; index: number; startedAt: number }
  | { kind: "capture"; index: number; startedAt: number }
  | { kind: "done" }
  | { kind: "failed"; reason: string };

export function CalibrationScreen({ onComplete, onCancel }: CalibrationScreenProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "intro" });
  const samplesRef = useRef<CalibrationSample[]>([]);
  const captureBufferRef = useRef<RawPoint[]>([]);
  const phaseRef = useRef<Phase>(phase);

  // Keep a ref of the current phase so the gaze subscription can read it
  // without needing to re-subscribe on every phase change.
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Subscribe once for the lifetime of the screen. We pull from the
  // *unsmoothed* gaze so per-target sample averaging isn't biased by
  // the One-Euro filter's momentum from the previous target.
  useEffect(() => {
    const unsub = gazeStore.subscribe((frame: GazeFrame | null) => {
      if (!frame) return;
      const p = phaseRef.current;
      if (p.kind !== "capture") return;
      // Only buffer frames with decent eye openness.
      if (frame.rawUnsmoothed.confidence < 0.4) return;
      captureBufferRef.current.push({
        x: frame.rawUnsmoothed.x,
        y: frame.rawUnsmoothed.y,
      });
    });
    return unsub;
  }, []);

  // Drive the state machine with setTimeout; keep it in a useEffect so
  // mount/unmount cleanup is automatic.
  useEffect(() => {
    if (phase.kind === "intro") {
      const id = window.setTimeout(() => {
        setPhase({ kind: "settle", index: 0, startedAt: performance.now() });
      }, 800);
      return () => window.clearTimeout(id);
    }

    if (phase.kind === "settle") {
      const id = window.setTimeout(() => {
        captureBufferRef.current = [];
        setPhase({ kind: "capture", index: phase.index, startedAt: performance.now() });
      }, SETTLE_MS);
      return () => window.clearTimeout(id);
    }

    if (phase.kind === "capture") {
      const id = window.setTimeout(() => {
        const buffer = captureBufferRef.current;
        if (buffer.length > 0) {
          const avg = averagePoints(buffer);
          samplesRef.current.push({
            raw: avg,
            target: CALIBRATION_TARGETS[phase.index],
          });
        }
        const next = phase.index + 1;
        if (next >= CALIBRATION_TARGETS.length) {
          // All targets captured — fit the model.
          try {
            if (samplesRef.current.length < 6) {
              setPhase({
                kind: "failed",
                reason: "We couldn't see your eyes on enough targets. Please try again in better lighting.",
              });
              return;
            }
            const model = fitAffine(samplesRef.current);
            setPhase({ kind: "done" });
            // Small pause so the UI can show "done" before transitioning.
            window.setTimeout(() => onComplete(model), 400);
          } catch (err) {
            const reason = err instanceof Error ? err.message : "Calibration fit failed.";
            setPhase({ kind: "failed", reason });
          }
          return;
        }
        setPhase({ kind: "settle", index: next, startedAt: performance.now() });
      }, CAPTURE_MS);
      return () => window.clearTimeout(id);
    }

    return undefined;
  }, [phase, onComplete]);

  // Allow ESC to cancel / retry.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onCancel) onCancel();
      if (e.key === "Enter" && phase.kind === "failed") {
        samplesRef.current = [];
        captureBufferRef.current = [];
        setPhase({ kind: "intro" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onCancel]);

  return (
    <div className="calibration">
      {CALIBRATION_TARGETS.map((target, i) => {
        const active =
          (phase.kind === "settle" || phase.kind === "capture") && phase.index === i;
        const done =
          (phase.kind === "capture" && phase.index > i) ||
          (phase.kind === "settle" && phase.index > i) ||
          phase.kind === "done";
        return (
          <div
            key={i}
            className={`cal-target ${active ? "is-active" : ""} ${done ? "is-done" : ""}`}
            style={{
              left: `${target.x * 100}%`,
              top: `${target.y * 100}%`,
            }}
          >
            <div className="cal-ring" />
            <div className="cal-core" />
          </div>
        );
      })}
      <div className="cal-overlay">
        <CalibrationMessage phase={phase} />
      </div>
    </div>
  );
}

function CalibrationMessage({ phase }: { phase: Phase }) {
  if (phase.kind === "intro") {
    return (
      <div className="cal-message">
        <h2>Calibrate your gaze</h2>
        <p>Keep your head still. Look at each glowing dot as it appears.</p>
      </div>
    );
  }
  if (phase.kind === "settle" || phase.kind === "capture") {
    const i = phase.index + 1;
    return (
      <div className="cal-message cal-message--small">
        <span>{i} / 9</span>
      </div>
    );
  }
  if (phase.kind === "done") {
    return (
      <div className="cal-message">
        <h2>Calibrated</h2>
      </div>
    );
  }
  if (phase.kind === "failed") {
    return (
      <div className="cal-message">
        <h2>Calibration didn't work</h2>
        <p>{phase.reason}</p>
        <p className="cal-hint">Press Enter to try again.</p>
      </div>
    );
  }
  return null;
}

function averagePoints(points: readonly RawPoint[]): RawPoint {
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

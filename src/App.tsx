import { useCallback, useState } from "react";
import { GazeEngine, type EngineStatus } from "./components/GazeEngine";
import { GazeDot } from "./components/GazeDot";
import { CalibrationScreen } from "./components/CalibrationScreen";
import { Keyboard } from "./components/Keyboard";
import { DebugHud } from "./components/DebugHud";
import { LandmarkOverlay } from "./components/LandmarkOverlay";
import { GemmaLoader } from "./components/GemmaLoader";
import { gazeStore } from "./gaze/gazeStore";
import {
  IDENTITY_CALIBRATION,
  type CalibrationModel,
} from "./gaze/calibration";
import "./App.css";

type AppPhase =
  | { kind: "boot" }
  | { kind: "needs-calibration" }
  | { kind: "calibrating" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

function App() {
  const [phase, setPhase] = useState<AppPhase>({ kind: "boot" });
  const [engineStatus, setEngineStatus] = useState<EngineStatus>({ kind: "idle" });

  const handleEngineStatus = useCallback((status: EngineStatus) => {
    setEngineStatus(status);
    if (status.kind === "error") {
      setPhase({ kind: "error", message: status.message });
      return;
    }
    if (status.kind === "running") {
      setPhase((current) => (current.kind === "boot" ? { kind: "needs-calibration" } : current));
    }
  }, []);

  const handleStartCalibration = useCallback(() => {
    setPhase({ kind: "calibrating" });
  }, []);

  const handleSkipCalibration = useCallback(() => {
    // Use identity-ish mapping so the keyboard is *reachable* even without
    // a proper calibration. Gaze will be inaccurate, but useful for debugging
    // whether the whole downstream pipeline is wired correctly.
    gazeStore.setCalibration(IDENTITY_CALIBRATION);
    setPhase({ kind: "ready" });
  }, []);

  const handleCalibrationComplete = useCallback((model: CalibrationModel) => {
    gazeStore.setCalibration(model);
    setPhase({ kind: "ready" });
  }, []);

  const handleRecalibrate = useCallback(() => {
    gazeStore.setCalibration(null);
    setPhase({ kind: "calibrating" });
  }, []);

  return (
    <div className="app">
      {/* Engine is mounted for the whole session — hidden video + loop.
          During pre-calibration we show the video as a faint background
          so the user can see their face under the diagnostic overlay. */}
      <GazeEngine
        onStatusChange={handleEngineStatus}
        showVideo={phase.kind === "needs-calibration"}
      />
      <DebugHud />

      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">◉</span>
          <div className="brand-text">
            <h1 className="brand-name">Lumen</h1>
            <p className="brand-tagline">Your eyes. Your voice.</p>
          </div>
        </div>
        <div className="app-header-actions">
          <GemmaLoader />
          <StatusChip status={engineStatus} />
        </div>
      </header>

      <main className="app-main">
        {phase.kind === "boot" && <BootScreen status={engineStatus} />}

        {phase.kind === "needs-calibration" && (
          <PreCalibrationScreen
            onStart={handleStartCalibration}
            onSkip={handleSkipCalibration}
          />
        )}

        {phase.kind === "calibrating" && (
          <CalibrationScreen onComplete={handleCalibrationComplete} />
        )}

        {phase.kind === "ready" && (
          <>
            <GazeDot source="calibrated" />
            <Keyboard
              onSpeak={(text) => speakText(text)}
              onRecalibrate={handleRecalibrate}
            />
          </>
        )}

        {phase.kind === "error" && (
          <div className="error-screen">
            <h2>{phase.message}</h2>
          </div>
        )}
      </main>

      <footer className="app-footer">
        <span>Prototype · gaze + calibration + dwell keyboard · Gemma word prediction next</span>
      </footer>
    </div>
  );
}

function PreCalibrationScreen({
  onStart,
  onSkip,
}: {
  onStart: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="pre-cal-screen">
      <LandmarkOverlay />
      <GazeDot source="raw" />
      <div className="pre-cal-card">
        <h2>Diagnostic check</h2>
        <p>
          You should see two cyan rectangles drawn over your eyes, with green dots
          marking each iris center. Move your head and they should move with you.
        </p>
        <p>
          When you look <b>left</b>, the green iris dots should slide toward the left
          side of each cyan box. Look <b>right</b>, they slide right. That confirms
          MediaPipe is tracking your iris position correctly.
        </p>
        <p className="pre-cal-hint">
          The glowing blue dot is what the gaze pipeline currently thinks. Watch the HUD
          for live numbers.
        </p>
        <div className="pre-cal-actions">
          <button className="btn btn--primary" type="button" onClick={onStart}>
            Start calibration
          </button>
          <button className="btn btn--ghost" type="button" onClick={onSkip}>
            Skip (use raw)
          </button>
        </div>
      </div>
    </div>
  );
}

function BootScreen({ status }: { status: EngineStatus }) {
  const label =
    status.kind === "requesting-camera"
      ? "Requesting camera…"
      : status.kind === "loading-model"
        ? "Loading face model…"
        : "Starting Lumen…";
  return (
    <div className="boot-screen">
      <div className="boot-message">
        <h2>{label}</h2>
        <p>Lumen needs to see your face. The model runs on your device — nothing leaves your computer.</p>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: EngineStatus }) {
  if (status.kind === "running") {
    return <span className="status-chip status-chip--ok">tracking · {status.fps} fps</span>;
  }
  if (status.kind === "error") {
    return <span className="status-chip status-chip--err">camera blocked</span>;
  }
  return <span className="status-chip status-chip--loading">starting…</span>;
}

function speakText(text: string): void {
  if (!text.trim()) return;
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1.0;
  utter.pitch = 1.0;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

export default App;

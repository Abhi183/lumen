import { useCallback, useEffect, useState } from "react";
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
import { startPointerMode, stopPointerMode } from "./gaze/pointerStore";
import "./App.css";

// Input mode decides whether the GazeEngine (webcam + MediaPipe) runs at
// all. Pointer mode makes Lumen demoable by anyone who clicks the URL,
// including reviewers who don't want to grant camera access.
type InputMode = "gaze" | "pointer";

type AppPhase =
  | { kind: "landing" }
  | { kind: "boot" }
  | { kind: "needs-calibration" }
  | { kind: "calibrating" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

function App() {
  const [mode, setMode] = useState<InputMode>("gaze");
  const [phase, setPhase] = useState<AppPhase>({ kind: "landing" });
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
    gazeStore.setCalibration(IDENTITY_CALIBRATION);
    setPhase({ kind: "ready" });
  }, []);

  const handleCalibrationComplete = useCallback((model: CalibrationModel) => {
    gazeStore.setCalibration(model);
    setPhase({ kind: "ready" });
  }, []);

  const handleRecalibrate = useCallback(() => {
    if (mode === "pointer") {
      // Pointer mode doesn't need calibration. Return to landing instead.
      stopPointerMode();
      setPhase({ kind: "landing" });
      return;
    }
    gazeStore.setCalibration(null);
    setPhase({ kind: "calibrating" });
  }, [mode]);

  const handleChooseGaze = useCallback(() => {
    setMode("gaze");
    setPhase({ kind: "boot" });
  }, []);

  const handleChoosePointer = useCallback(() => {
    setMode("pointer");
    startPointerMode();
    setPhase({ kind: "ready" });
  }, []);

  // Clean up pointer mode when the user navigates back / the app unmounts.
  useEffect(() => {
    return () => {
      stopPointerMode();
    };
  }, []);

  const showEngine = mode === "gaze" && phase.kind !== "landing";

  return (
    <div className="app">
      {showEngine && (
        <GazeEngine
          onStatusChange={handleEngineStatus}
          showVideo={phase.kind === "needs-calibration"}
        />
      )}
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
          <ModeChip mode={mode} status={engineStatus} />
        </div>
      </header>

      <main className="app-main">
        {phase.kind === "landing" && (
          <LandingScreen
            onChooseGaze={handleChooseGaze}
            onChoosePointer={handleChoosePointer}
          />
        )}

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
          <ErrorScreen
            message={phase.message}
            onFallbackPointer={handleChoosePointer}
          />
        )}
      </main>

      <footer className="app-footer">
        <span>Lumen · free eye-gaze AAC · open source · on-device</span>
      </footer>
    </div>
  );
}

function LandingScreen({
  onChooseGaze,
  onChoosePointer,
}: {
  onChooseGaze: () => void;
  onChoosePointer: () => void;
}) {
  return (
    <div className="landing-screen">
      <div className="landing-card">
        <h2>Pick how you'd like to try Lumen.</h2>
        <p className="landing-lead">
          Lumen is a free eye-gaze communication tool. The gaze pipeline runs entirely on your
          device — nothing is uploaded. If you're just here to look around, the pointer mode
          works without a webcam.
        </p>
        <div className="landing-options">
          <button className="landing-option" type="button" onClick={onChooseGaze}>
            <div className="landing-option-title">Use my eyes</div>
            <p>Grant camera access. Calibrate once, then type by looking. Intended for daily use.</p>
          </button>
          <button
            className="landing-option landing-option--secondary"
            type="button"
            onClick={onChoosePointer}
          >
            <div className="landing-option-title">Try with a mouse</div>
            <p>Use your cursor in place of your gaze. No camera, no calibration. Best for reviewing the keyboard flow.</p>
          </button>
        </div>
      </div>
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

function ErrorScreen({
  message,
  onFallbackPointer,
}: {
  message: string;
  onFallbackPointer: () => void;
}) {
  return (
    <div className="error-screen">
      <h2>{message}</h2>
      <p className="error-hint">
        You can still try the keyboard flow with your mouse. No camera needed.
      </p>
      <button className="btn btn--primary" type="button" onClick={onFallbackPointer}>
        Continue with mouse
      </button>
    </div>
  );
}

function ModeChip({ mode, status }: { mode: InputMode; status: EngineStatus }) {
  if (mode === "pointer") {
    return <span className="status-chip status-chip--ok">pointer mode</span>;
  }
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

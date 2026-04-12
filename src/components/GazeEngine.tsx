// Headless component: owns the webcam + the MediaPipe detection loop.
// Publishes frames to gazeStore. Renders nothing except a hidden <video>.
//
// Keeping this as a component (not a hook) gives us a clean lifecycle:
// mount → camera + loop on; unmount → camera + loop off.

import { useEffect, useRef, useState } from "react";
import { getFaceLandmarker } from "../gaze/faceLandmarker";
import { estimateGaze } from "../gaze/gazeEstimator";
import { gazeStore } from "../gaze/gazeStore";

export type EngineStatus =
  | { kind: "idle" }
  | { kind: "requesting-camera" }
  | { kind: "loading-model" }
  | { kind: "running"; fps: number }
  | { kind: "error"; message: string };

interface GazeEngineProps {
  onStatusChange?: (status: EngineStatus) => void;
  /** When true, the webcam feed becomes a faint background for diagnostics. */
  showVideo?: boolean;
}

export function GazeEngine({ onStatusChange, showVideo }: GazeEngineProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number | null>(null);
  const [status, setStatus] = useState<EngineStatus>({ kind: "idle" });

  // Report status changes upward.
  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    async function start() {
      setStatus({ kind: "requesting-camera" });
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: "user",
          },
          audio: false,
        });
      } catch {
        setStatus({
          kind: "error",
          message:
            "Camera access denied. Lumen needs your webcam to track your eyes. Allow camera access and reload.",
        });
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();

      setStatus({ kind: "loading-model" });
      const landmarker = await getFaceLandmarker();
      if (cancelled) return;

      // Throttled FPS display (once per second).
      let frames = 0;
      let fpsAccum = 0;
      let lastTs = performance.now();
      setStatus({ kind: "running", fps: 0 });

      const loop = () => {
        if (cancelled) return;
        const now = performance.now();
        const result = landmarker.detectForVideo(video, now);
        const out = estimateGaze(result);
        if (out) {
          gazeStore.push(out.estimate, now, out.debug);
        } else {
          gazeStore.push(null, now);
        }

        frames += 1;
        fpsAccum += now - lastTs;
        lastTs = now;
        if (fpsAccum >= 1000) {
          const fps = Math.round((frames * 1000) / fpsAccum);
          setStatus({ kind: "running", fps });
          frames = 0;
          fpsAccum = 0;
        }

        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    }

    start();

    return () => {
      cancelled = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      stream?.getTracks().forEach((t) => t.stop());
      const video = videoRef.current;
      if (video) video.srcObject = null;
      gazeStore.push(null, performance.now());
    };
  }, []);

  return (
    <video
      ref={videoRef}
      playsInline
      muted
      className={`gaze-video ${showVideo ? "gaze-video--show" : ""}`}
    />
  );
}

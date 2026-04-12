// Thin wrapper around MediaPipe FaceLandmarker for the browser.
// Loads the WASM runtime + model once, then exposes a per-frame detect() call.
//
// Why a singleton: the WASM runtime is ~2MB and the model another ~3MB; we
// never want to re-init per React render.

import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";

const WASM_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm";

// Google's hosted float16 face_landmarker.task. Small, fast, ~478 landmarks
// including the 10 iris landmarks we need for gaze.
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

let instance: FaceLandmarker | null = null;
let loading: Promise<FaceLandmarker> | null = null;

export async function getFaceLandmarker(): Promise<FaceLandmarker> {
  if (instance) return instance;
  if (loading) return loading;

  loading = (async () => {
    const fileset = await FilesetResolver.forVisionTasks(WASM_CDN);
    const landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    instance = landmarker;
    return landmarker;
  })();

  return loading;
}

export type { FaceLandmarkerResult };

// High-level word prediction API used by the keyboard.
//
// Acts as a facade over (a) Gemma when it's loaded, (b) the static
// frequency predictor when it isn't. Debounces requests so that fast
// typers don't fire dozens of in-flight Gemma calls per second.

import { gemma } from "./gemma";
import { staticPredict, type Prediction } from "./staticPredictor";

const DEBOUNCE_MS = 220;
const GEMMA_MAX_TOKENS = 32;
const GEMMA_TEMPERATURE = 0.6;

export interface PredictResult {
  predictions: Prediction[];
  /** Whether these came from Gemma or the fallback. */
  source: "gemma" | "static";
}

type Listener = (result: PredictResult) => void;

class WordPredictor {
  private listeners = new Set<Listener>();
  private latestText = "";
  private debounceHandle: number | null = null;
  private requestSeq = 0;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Push the latest text to the predictor. Static suggestions are emitted
   * synchronously; if Gemma is loaded, a refined Gemma suggestion is also
   * scheduled (debounced) and emitted when ready.
   */
  update(text: string): void {
    this.latestText = text;

    // Always emit a fast static result first so the chips never go blank.
    const fast = staticPredict(text);
    this.emit({ predictions: fast, source: "static" });

    if (!gemma.isReady()) return;

    // Debounce Gemma so we don't run a generation per keystroke.
    if (this.debounceHandle != null) {
      window.clearTimeout(this.debounceHandle);
    }
    const seq = ++this.requestSeq;
    this.debounceHandle = window.setTimeout(() => {
      void this.runGemma(seq, text);
    }, DEBOUNCE_MS);
  }

  /** Reset internal state — call when the text strip is cleared. */
  reset(): void {
    if (this.debounceHandle != null) {
      window.clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }
    gemma.cancel();
  }

  private async runGemma(seq: number, text: string): Promise<void> {
    try {
      const prompt = buildPrompt(text);
      const raw = await gemma.complete(prompt, {
        maxOutputTokens: GEMMA_MAX_TOKENS,
        temperature: GEMMA_TEMPERATURE,
      });
      // Reject stale results: a newer keystroke has happened.
      if (seq !== this.requestSeq || text !== this.latestText) return;

      const parsed = parseGemmaResponse(raw);
      if (parsed.length === 0) return;

      this.emit({
        predictions: parsed.map((word) => ({ word, source: "static" as const })),
        source: "gemma",
      });
    } catch {
      // Silently fall back. Static predictions were already emitted.
    }
  }

  private emit(result: PredictResult): void {
    for (const l of Array.from(this.listeners)) l(result);
  }
}

/**
 * Build a Gemma prompt that asks for short next-word completions.
 *
 * The instructions are blunt because Gemma's instruction-tuned variants
 * are much more reliable at following short, concrete schemas.
 */
function buildPrompt(text: string): string {
  const safe = text.length > 0 ? text : "(empty)";
  return [
    "You are an autocomplete engine for someone with motor impairment using gaze typing.",
    "Speed and intent matter most. Suggest short next-word continuations.",
    "",
    `Current text: "${safe}"`,
    "",
    "Reply with exactly 5 likely next words or short phrases (1-3 words each), one per line.",
    "Output ONLY the suggestions, no numbers, no punctuation, no explanation.",
  ].join("\n");
}

/**
 * Parse Gemma's freeform reply into a clean list of suggestions.
 * Tolerates leading numbers ("1. water"), bullets ("- water"), and quotes.
 */
function parseGemmaResponse(raw: string): string[] {
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const cleaned = line
      .replace(/^[\s\-•*\d.)]+/, "")
      .replace(/["“”]/g, "")
      .trim();
    if (cleaned.length === 0) continue;
    if (cleaned.length > 32) continue; // ignore runaway sentences
    out.push(cleaned);
    if (out.length >= 5) break;
  }
  return out;
}

export const wordPredictor = new WordPredictor();

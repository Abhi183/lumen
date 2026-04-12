// Dwell-based AAC keyboard with Gemma-powered word suggestions.
//
// - Suggestion strip across the top: dwell-selectable chips that come
//   from the WordPredictor (static fallback when Gemma isn't loaded;
//   Gemma completions when it is).
// - 6×5 grid of frequency-ordered letters + punctuation.
// - Bottom row of "command" keys (space, backspace, speak, clear).
// - Each letter, suggestion, and command is a dwell target. Staring at
//   it for dwellMs triggers selection.
// - We keep re-renders low by writing dwell progress to a CSS custom
//   property on the hovered button. We only call setState when the
//   composed text or the hovered key actually change.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_DWELL_CONFIG,
  DwellDetector,
  type DwellTarget,
} from "../gaze/dwellDetector";
import { gazeStore, type GazeFrame } from "../gaze/gazeStore";
import { wordPredictor, type PredictResult } from "../llm/wordPredictor";

// Frequency-ordered English letters + punctuation, 30 slots = 5 rows × 6 cols.
const LETTER_KEYS: readonly string[] = [
  "E", "T", "A", "O", "I", "N",
  "S", "R", "H", "L", "D", "C",
  "U", "M", "W", "F", "G", "Y",
  "P", "B", "V", "K", "J", "X",
  "Q", "Z", ".", ",", "?", "!",
];

const COMMAND_KEYS = [
  { id: "space", label: "␣ space", kind: "space" as const },
  { id: "backspace", label: "⌫ back", kind: "backspace" as const },
  { id: "speak", label: "🔊 speak", kind: "speak" as const },
  { id: "clear", label: "✕ clear", kind: "clear" as const },
];

const NUM_SUGGESTION_SLOTS = 5;
const SUGGESTION_IDS: readonly string[] = Array.from(
  { length: NUM_SUGGESTION_SLOTS },
  (_, i) => `sugg-${i}`,
);

interface KeyboardProps {
  onTextChange?: (text: string) => void;
  onSpeak?: (text: string) => void;
  onRecalibrate?: () => void;
}

export function Keyboard({ onTextChange, onSpeak, onRecalibrate }: KeyboardProps) {
  const [text, setText] = useState("");
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [suggestionResult, setSuggestionResult] = useState<PredictResult>({
    predictions: [],
    source: "static",
  });

  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const dwellRef = useRef(new DwellDetector(DEFAULT_DWELL_CONFIG));
  const hoverRef = useRef<string | null>(null);

  const textRef = useRef(text);
  useEffect(() => {
    textRef.current = text;
  }, [text]);

  const suggestionsRef = useRef(suggestionResult);
  useEffect(() => {
    suggestionsRef.current = suggestionResult;
  }, [suggestionResult]);

  const registerButton = useCallback(
    (id: string) => (el: HTMLButtonElement | null) => {
      if (el) buttonRefs.current.set(id, el);
      else buttonRefs.current.delete(id);
    },
    [],
  );

  const updateText = useCallback(
    (next: string) => {
      setText(next);
      textRef.current = next;
      onTextChange?.(next);
      wordPredictor.update(next);
    },
    [onTextChange],
  );

  const fireKey = useCallback(
    (id: string) => {
      // Letter keys.
      if (LETTER_KEYS.includes(id)) {
        updateText(textRef.current + id.toLowerCase());
        return;
      }

      // Suggestion chips.
      if (id.startsWith("sugg-")) {
        const idx = Number(id.slice(5));
        const suggestion = suggestionsRef.current.predictions[idx];
        if (!suggestion) return;
        const insert = computeInsertion(textRef.current, suggestion.word);
        updateText(insert);
        return;
      }

      // Commands.
      if (id === "space") {
        updateText(textRef.current + " ");
        return;
      }
      if (id === "backspace") {
        updateText(textRef.current.slice(0, -1));
        return;
      }
      if (id === "clear") {
        updateText("");
        wordPredictor.reset();
        return;
      }
      if (id === "speak") {
        onSpeak?.(textRef.current);
        return;
      }
    },
    [updateText, onSpeak],
  );

  // All key ids the dwell detector watches. Identity is stable.
  const keyIds = useMemo(
    () => [...SUGGESTION_IDS, ...LETTER_KEYS, ...COMMAND_KEYS.map((k) => k.id)],
    [],
  );

  // Subscribe to word predictor → keep suggestion chips fresh.
  useEffect(() => {
    // Kick off an initial prediction so the first paint isn't blank.
    wordPredictor.update("");
    return wordPredictor.subscribe(setSuggestionResult);
  }, []);

  // Main subscription: per-frame dwell update.
  useEffect(() => {
    const listener = (frame: GazeFrame | null) => {
      if (!frame || !frame.calibrated) {
        if (hoverRef.current !== null) {
          setHoverProgress(buttonRefs.current, hoverRef.current, 0);
          hoverRef.current = null;
          setHoverId(null);
        }
        return;
      }

      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      const gazePx = {
        x: frame.calibrated.x * viewportW,
        y: frame.calibrated.y * viewportH,
      };

      // Build live targets from current DOM rects (one layout read per
      // frame, ~40 buttons — cheap).
      const targets: DwellTarget[] = [];
      for (const id of keyIds) {
        const el = buttonRefs.current.get(id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        targets.push({
          id,
          rect: { x: r.left, y: r.top, width: r.width, height: r.height },
        });
      }

      const update = dwellRef.current.update(gazePx, frame.timestamp, targets);

      // Visual progress: write to a CSS variable on the hovered button.
      if (update.hoverId !== hoverRef.current) {
        if (hoverRef.current != null) {
          setHoverProgress(buttonRefs.current, hoverRef.current, 0);
        }
        hoverRef.current = update.hoverId;
        setHoverId(update.hoverId);
      }
      if (update.hoverId != null) {
        setHoverProgress(buttonRefs.current, update.hoverId, update.progress);
      }

      if (update.fired) {
        fireKey(update.fired);
      }
    };
    return gazeStore.subscribe(listener);
  }, [keyIds, fireKey]);

  return (
    <div className="keyboard-screen">
      <div className="text-strip">
        <span className="text-strip__content">{text || <em>Look at a letter or suggestion to begin</em>}</span>
        {hoverId && (
          <span className="text-strip__hint">
            dwelling · <b>{hoverIdLabel(hoverId, suggestionResult)}</b>
          </span>
        )}
      </div>

      <div
        className={`suggestion-strip suggestion-strip--${suggestionResult.source}`}
        aria-label="Word suggestions"
      >
        {SUGGESTION_IDS.map((id, i) => {
          const sugg = suggestionResult.predictions[i];
          return (
            <button
              key={id}
              ref={registerButton(id)}
              className="key key--suggestion"
              type="button"
              disabled={!sugg}
              onClick={() => fireKey(id)}
            >
              <span className="suggestion-label">{sugg ? sugg.word : "—"}</span>
              <span className="key__progress" />
            </button>
          );
        })}
      </div>

      <div className="key-grid">
        {LETTER_KEYS.map((letter) => (
          <button
            key={letter}
            ref={registerButton(letter)}
            className="key key--letter"
            type="button"
            onClick={() => fireKey(letter)}
          >
            {letter}
            <span className="key__progress" />
          </button>
        ))}
      </div>

      <div className="command-row">
        {COMMAND_KEYS.map((cmd) => (
          <button
            key={cmd.id}
            ref={registerButton(cmd.id)}
            className={`key key--command key--${cmd.kind}`}
            type="button"
            onClick={() => fireKey(cmd.id)}
          >
            {cmd.label}
            <span className="key__progress" />
          </button>
        ))}
        {onRecalibrate && (
          <button className="key key--secondary" type="button" onClick={onRecalibrate}>
            Recalibrate
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Replace the partial prefix the user is typing with a full suggestion,
 * appending a trailing space so the next dwell can start a new word.
 *
 *   "I wa" + "water" → "I water "
 *   "I "   + "water" → "I water "
 *   ""     + "water" → "water "
 */
function computeInsertion(currentText: string, word: string): string {
  if (currentText.length === 0 || currentText.endsWith(" ")) {
    return currentText + word + " ";
  }
  const lastSpace = currentText.lastIndexOf(" ");
  const prefixEnd = lastSpace + 1;
  return currentText.slice(0, prefixEnd) + word + " ";
}

function hoverIdLabel(id: string, result: PredictResult): string {
  if (id.startsWith("sugg-")) {
    const idx = Number(id.slice(5));
    return result.predictions[idx]?.word ?? id;
  }
  return id;
}

function setHoverProgress(
  buttons: Map<string, HTMLButtonElement>,
  id: string,
  progress: number,
): void {
  const el = buttons.get(id);
  if (!el) return;
  el.style.setProperty("--dwell-progress", progress.toFixed(3));
}

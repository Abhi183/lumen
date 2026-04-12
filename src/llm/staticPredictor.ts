// Frequency-based fallback predictor.
//
// Used when Gemma isn't loaded yet (or failed to load). It's not smart,
// but it gives the keyboard SOMETHING in the suggestion strip so the user
// always has a way to type faster than letter-by-letter.
//
// Strategy:
//   1. If the text is empty or ends with a space → return the top global
//      unigrams the user is most likely to start with.
//   2. If the text ends mid-word → return the top words that start with
//      the current prefix, ranked by frequency.
//   3. We expose at most `MAX_SUGGESTIONS` results.

const MAX_SUGGESTIONS = 5;

// A small dictionary of high-frequency English words plus AAC-relevant
// vocabulary (yes/no, water, help, hurt, family). This is intentionally
// short — it's a fallback, not a corpus model.
const VOCAB: readonly string[] = [
  // High-frequency function words
  "the", "and", "of", "to", "a", "in", "that", "is", "it", "for", "with",
  "as", "are", "was", "but", "not", "you", "this", "have", "from", "they",
  "she", "he", "we", "be", "or", "an", "will", "my", "your", "one", "all",
  "would", "there", "their", "what", "so", "up", "out", "if", "about",
  "who", "get", "which", "go", "me", "when", "make", "can", "like",
  "time", "no", "just", "know", "take", "into", "year", "good", "some",
  "could", "them", "see", "other", "than", "then", "now", "look", "only",
  "come", "its", "over", "think", "also", "back", "after", "use", "two",
  "how", "our", "work", "first", "well", "way", "even", "new", "want",
  "because", "any", "these", "give", "day", "most", "us",

  // High-frequency content words
  "yes", "no", "please", "thank", "thanks", "hello", "okay", "ok", "sorry",
  "love", "hate", "happy", "sad", "tired", "hungry", "thirsty", "cold", "hot",
  "water", "food", "drink", "bathroom", "help", "stop", "start", "wait",
  "more", "less", "again", "later", "now", "soon",

  // People and relationships
  "mom", "mum", "mother", "dad", "father", "wife", "husband", "son", "daughter",
  "friend", "doctor", "nurse", "family",

  // Body and care
  "pain", "hurt", "sleep", "wake", "medicine", "blanket", "pillow",
  "warm", "cool", "light", "dark",

  // Common verbs people compose
  "need", "want", "feel", "know", "think", "say", "tell", "ask", "go",
  "come", "stay", "stop", "wait", "call",
];

const VOCAB_SET = new Set(VOCAB);
const TOP_UNIGRAMS: readonly string[] = VOCAB.slice(0, MAX_SUGGESTIONS);

/** Result of a prediction call. */
export interface Prediction {
  /** The full word to insert at the cursor. Excludes leading whitespace. */
  word: string;
  /** Where the prediction came from — purely diagnostic. */
  source: "static";
}

/**
 * Predict next words for a current text using only the static dictionary.
 * The result always has at most MAX_SUGGESTIONS items.
 */
export function staticPredict(currentText: string): Prediction[] {
  const trimmed = currentText.trimEnd();
  // Treat trailing space (or empty) as "starting a new word".
  const endsOnSpace = currentText.length === 0 || currentText.endsWith(" ");

  if (endsOnSpace) {
    return TOP_UNIGRAMS.map((word) => ({ word, source: "static" }));
  }

  // Otherwise we are mid-word. Find the current prefix.
  const lastSpace = trimmed.lastIndexOf(" ");
  const prefix = trimmed.slice(lastSpace + 1).toLowerCase();
  if (prefix.length === 0) {
    return TOP_UNIGRAMS.map((word) => ({ word, source: "static" }));
  }

  const matches: Prediction[] = [];
  for (const word of VOCAB) {
    if (word.startsWith(prefix)) {
      matches.push({ word, source: "static" });
      if (matches.length >= MAX_SUGGESTIONS) break;
    }
  }
  if (matches.length === 0) {
    // No prefix match: fall back to top unigrams so the strip is never
    // empty when the user is typing.
    return TOP_UNIGRAMS.map((word) => ({ word, source: "static" }));
  }
  return matches;
}

/** Public for tests. */
export const __INTERNAL = { VOCAB, VOCAB_SET, MAX_SUGGESTIONS };

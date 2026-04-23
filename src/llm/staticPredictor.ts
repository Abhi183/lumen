// Frequency-based + bigram-driven fallback predictor.
//
// Used when Gemma isn't loaded. The goal is to be good enough that Gemma
// stays optional for casual visitors who don't want a 1GB download, and
// for caregivers setting up a device for the first time.
//
// Strategy:
//   1. If the text is empty or ends with a space, look at the previous
//      complete word and return bigram continuations for it. If there is
//      no previous word (fresh start), return common starter words.
//   2. If the text is mid-word, return vocabulary entries that begin with
//      the current prefix, prioritizing anything that also matches the
//      previous-word bigram.
//   3. We always return exactly MAX_SUGGESTIONS entries or fewer.
//
// The bigram table below is a hand-curated short-form English map focused
// on AAC-relevant continuations (yes/no, feelings, care, family, simple
// sentence starters). Not a full language model; just enough to feel
// helpful when Gemma is absent.

const MAX_SUGGESTIONS = 5;

// Top ~300 vocabulary entries. Order matters: the first prefix match wins,
// so AAC-critical words (water, help, please, pain) live at the top of the
// list ahead of merely common English words (was, way, went). For a user
// typing "wa" we want "water" and "want" in the first row of chips, not
// "was" and "way".
const VOCAB: readonly string[] = [
  // AAC-critical — highest priority for prefix matching.
  "i", "yes", "no", "please", "thank", "thanks", "thanks.", "hello", "hi",
  "help", "water", "food", "drink", "pain", "hurt", "tired", "hungry",
  "thirsty", "cold", "hot", "warm", "cool", "sick", "medicine", "bathroom",
  "want", "need", "feel", "love", "stop", "wait", "more", "less", "again",
  "okay", "sorry", "happy", "sad", "scared", "worried",

  // AAC people/care vocabulary.
  "mom", "mum", "dad", "mother", "father", "wife", "husband", "son",
  "daughter", "friend", "doctor", "nurse", "family", "brother", "sister",
  "grandma", "grandpa", "partner", "caregiver", "children", "child",

  // Core English function words.
  "the", "and", "of", "to", "a", "in", "that", "is", "it", "for", "with",
  "as", "are", "was", "but", "not", "you", "this", "have", "from", "they",
  "she", "he", "we", "be", "or", "an", "will", "my", "your", "one", "all",
  "would", "there", "their", "what", "so", "up", "out", "if", "about",
  "who", "get", "which", "go", "me", "when", "make", "can", "like",
  "time", "just", "know", "take", "into", "year", "good", "some",
  "could", "them", "see", "other", "than", "then", "now", "look", "only",
  "come", "its", "over", "think", "also", "back", "after", "use", "two",
  "how", "our", "work", "first", "well", "way", "even", "new",
  "because", "any", "these", "give", "day", "most", "us", "am", "been",
  "has", "had", "said", "find", "here", "thing", "very", "where", "right",
  "still", "through", "say", "should", "much", "man", "try", "long", "her",
  "tell", "old", "asked", "keep", "turn", "name", "while", "years", "told",
  "does", "around", "saw", "set", "called", "done", "left", "ready",
  "finished",

  // Additional feelings & states.
  "fine", "bad", "better", "worse", "bored", "lonely", "angry", "frustrated",
  "excited",

  // Body and basic care verbs.
  "eat", "sleep", "wake", "rest", "sit", "stand", "walk", "move",
  "blanket", "pillow", "light", "dark", "quiet", "loud",
  "shower", "clean", "wash", "change",

  // Verbs that drive composition.
  "think", "say", "tell", "ask", "hear", "listen", "understand",
  "forget", "remember", "mean", "believe", "hope", "wish",

  // Common object words.
  "book", "phone", "chair", "bed", "window", "door", "TV", "radio",
  "music", "picture", "photo", "letter", "game", "car", "outside",
  "inside", "home", "room",

  // Connective / filler words.
  "really", "always", "never", "sometimes", "together", "alone", "maybe",
  "definitely", "probably", "almost", "bye", "goodbye", "ok", "sure",
  "hate", "soon", "later",
];

// Bigram continuations. For each key word, the top follow-ups. Curated
// for AAC utility, not drawn from a corpus — these should feel useful
// to someone composing a short sentence.
const BIGRAMS: Readonly<Record<string, readonly string[]>> = {
  i: ["am", "need", "want", "feel", "love"],
  "i'm": ["tired", "hungry", "thirsty", "cold", "fine"],
  im: ["tired", "hungry", "thirsty", "cold", "fine"],
  the: ["same", "other", "first", "next", "last"],
  a: ["little", "lot", "few", "minute", "good"],
  please: ["help", "wait", "stop", "come", "call"],
  help: ["me", "please", "with", "get", "us"],
  need: ["water", "help", "food", "to", "more"],
  want: ["to", "water", "food", "help", "more"],
  feel: ["tired", "sick", "better", "happy", "cold"],
  are: ["you", "we", "they", "the", "there"],
  can: ["you", "we", "i", "they", "he"],
  will: ["you", "be", "go", "we", "come"],
  it: ["is", "was", "feels", "will", "hurts"],
  is: ["the", "a", "my", "there", "that"],
  my: ["mom", "dad", "wife", "husband", "family"],
  your: ["help", "name", "turn", "time", "mother"],
  yes: ["please", "thank", "and", "that", "i"],
  no: ["thank", "not", "more", "please", "it"],
  thank: ["you", "you,", "you.", "everyone", "god"],
  hello: ["everyone", "there", ",", "how", "thank"],
  love: ["you", "you.", "my", "her", "him"],
  hurt: ["a", "my", "me", "so", "everywhere"],
  pain: ["in", "is", "medicine", "again", "help"],
  water: ["please", "please.", ",", "is", "now"],
  food: ["please", "is", "now", "later", "?"],
  to: ["the", "a", "go", "see", "be"],
  go: ["to", "home", "now", "later", "out"],
  see: ["you", "the", "my", "how", "if"],
  come: ["back", "here", "in", "with", "to"],
  call: ["my", "the", "911", "doctor", "nurse"],
  stop: ["please", ",", "it", "that", "now"],
  start: ["over", "again", "now", "the", "a"],
  wait: ["please", ",", "a", "for", "there"],
  more: ["water", "food", "please", "medicine", "time"],
  less: ["please", "light", "noise", "medicine", "often"],
  tired: ["please", ",", "and", "of", "today"],
  hungry: ["please", ",", "and", "now", "for"],
  thirsty: ["please", ",", "and", "now", "for"],
  good: ["morning", "night", "day", "to", "for"],
  bad: ["pain", "day", "news", "feeling", "time"],
  very: ["tired", "hungry", "cold", "hot", "good"],
  not: ["now", "today", "yet", "sure", "good"],
  mom: ["please", ",", "is", "come", "can"],
  dad: ["please", ",", "is", "come", "can"],
  doctor: ["please", "now", "come", ",", "today"],
  nurse: ["please", "now", "come", ",", "today"],
};

const TOP_STARTERS: readonly string[] = [
  "i", "the", "please", "yes", "hello",
];

/** Result of a prediction call. */
export interface Prediction {
  /** The full word (or short phrase) to insert at the cursor. */
  word: string;
  /** Where the prediction came from. */
  source: "static";
}

/**
 * Predict next words for the current text using only local heuristics.
 * Returns up to MAX_SUGGESTIONS items, never empty.
 */
export function staticPredict(currentText: string): Prediction[] {
  const endsOnSpace = currentText.length === 0 || currentText.endsWith(" ");
  const trimmed = currentText.trimEnd();

  if (endsOnSpace) {
    // Between words: return bigram continuations of the previous word, or
    // starters if there's no previous word.
    const prev = lastWord(trimmed);
    const candidates = prev ? BIGRAMS[prev] : null;
    if (candidates && candidates.length > 0) {
      return candidates.slice(0, MAX_SUGGESTIONS).map(asPrediction);
    }
    return TOP_STARTERS.map(asPrediction);
  }

  // Mid-word: prefix-match the vocabulary.
  const lastSpace = trimmed.lastIndexOf(" ");
  const prefix = trimmed.slice(lastSpace + 1).toLowerCase();
  if (prefix.length === 0) {
    return TOP_STARTERS.map(asPrediction);
  }

  const matches: string[] = [];
  for (const word of VOCAB) {
    if (word.startsWith(prefix)) {
      matches.push(word);
      if (matches.length >= MAX_SUGGESTIONS) break;
    }
  }
  if (matches.length === 0) {
    return TOP_STARTERS.map(asPrediction);
  }
  return matches.map(asPrediction);
}

function lastWord(text: string): string | null {
  if (text.length === 0) return null;
  const lastSpace = text.lastIndexOf(" ");
  const word = lastSpace === -1 ? text : text.slice(lastSpace + 1);
  return word.toLowerCase().replace(/[^a-z']/g, "") || null;
}

function asPrediction(word: string): Prediction {
  return { word, source: "static" };
}

/** Exposed for tests. */
export const __INTERNAL = { VOCAB, BIGRAMS, MAX_SUGGESTIONS };

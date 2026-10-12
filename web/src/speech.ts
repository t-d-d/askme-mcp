// Reading an ask's spoken text aloud with the browser's own speech (PRD,
// "Web page"). A browser that cannot speak gets no Listen button.

// About how fast the browser's speech goes, in words a second. At this
// pace the ask tool's limit on the spoken text is about a minute.
const wordsPerSecond = 2.5;

// How long the spoken text takes to hear, in round numbers, as the open
// card's Listen button says it: "About 40 seconds", "About a minute".
export function listenLength(text: string): string {
  const words = text.split(/\s+/u).filter((word) => word !== "").length;
  const seconds = Math.max(10, Math.round(words / wordsPerSecond / 10) * 10);
  if (seconds < 60) return `About ${String(seconds)} seconds`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "About a minute" : `About ${String(minutes)} minutes`;
}

// Reads the text aloud, from the start, in place of anything already being
// read. Undefined where the browser has no speech.
export type Speak = (text: string) => void;

export function browserSpeech(): Speak | undefined {
  if (
    !("speechSynthesis" in window) ||
    typeof SpeechSynthesisUtterance !== "function"
  ) {
    return undefined;
  }
  return (text) => {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  };
}

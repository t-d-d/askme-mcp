// At this pace the ask tool's limit on spoken text is about a minute.
const wordsPerSecond = 2.5;

export function listenLength(text: string): string {
  const words = text.split(/\s+/u).filter((word) => word !== "").length;
  const seconds = Math.max(10, Math.round(words / wordsPerSecond / 10) * 10);
  if (seconds < 60) return `About ${String(seconds)} seconds`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "About a minute" : `About ${String(minutes)} minutes`;
}

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

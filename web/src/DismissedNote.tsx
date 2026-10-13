import { useEffect, useRef, useState } from "react";
import styles from "./DismissedNote.module.css";
import type { DismissNote } from "./dismissing";

// The region stays on the page, empty and hidden, so a screen reader hears
// each note as it comes. The note with Undo is kept while it has focus or
// the pointer, and onKeep hears when that starts and ends.
export function DismissedNote({
  note,
  onUndo,
  onKeep,
}: {
  note: DismissNote | null;
  onUndo: () => void;
  onKeep: (kept: boolean) => void;
}) {
  const [focus, setFocus] = useState(false);
  const [pointer, setPointer] = useState(false);
  // Undo can go with focus on it, and a browser need not say focus left.
  const [shown, setShown] = useState(note);
  if (note !== shown) {
    setShown(note);
    if (note !== "dismissed") {
      setFocus(false);
      setPointer(false);
    }
  }
  const kept = note === "dismissed" && (focus || pointer);
  // Listened for on the region, not set as props: it only watches, and is
  // no control.
  const region = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const at = region.current;
    if (at === null) return;
    const focusIn = () => {
      setFocus(true);
    };
    const focusOut = ({ relatedTarget }: FocusEvent) => {
      if (!(relatedTarget instanceof Node && at.contains(relatedTarget))) {
        setFocus(false);
      }
    };
    const enter = () => {
      setPointer(true);
    };
    const leave = () => {
      setPointer(false);
    };
    at.addEventListener("focusin", focusIn);
    at.addEventListener("focusout", focusOut);
    at.addEventListener("pointerenter", enter);
    at.addEventListener("pointerleave", leave);
    return () => {
      at.removeEventListener("focusin", focusIn);
      at.removeEventListener("focusout", focusOut);
      at.removeEventListener("pointerenter", enter);
      at.removeEventListener("pointerleave", leave);
    };
  }, []);
  useEffect(() => {
    if (!kept) return;
    onKeep(true);
    return () => {
      onKeep(false);
    };
  }, [kept, onKeep]);
  return (
    <div className={styles.note} role="status" ref={region}>
      {note === "dismissed" && (
        <>
          <span>Dismissed.</span>
          <button className={styles.undo} type="button" onClick={onUndo}>
            Undo
          </button>
        </>
      )}
      {note === "failed" && (
        <span>That didn&apos;t go through. The ask is back.</span>
      )}
    </div>
  );
}

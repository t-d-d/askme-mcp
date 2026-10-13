// Clerk's script is a few hundred kilobytes from its own host, so a wait
// this long means it is not coming.
export const signInWaitMs = 10_000;

export type Marks = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// Reaching the storage at all can throw, as where a browser blocks site
// data, so it is reached only inside the calls below, which catch.
export const storedMarks = (storage: () => Marks): Marks => ({
  getItem: (key) => storage().getItem(key),
  setItem: (key, value) => {
    storage().setItem(key, value);
  },
  removeItem: (key) => {
    storage().removeItem(key);
  },
});

export const sessionMarks = storedMarks(() => window.sessionStorage);

const reloadedKey = "askme-reloaded";

// After a deploy changes the poll's answer, the page left open cannot read
// it, and a reload fetches the new page (index.html is served no-cache).
// The mark lets that happen once, so a page whose own schema is wrong does
// not reload for ever. Where the mark cannot be kept, it does not reload.
export function reloadOnce(marks: Marks, reload: () => void): void {
  try {
    if (marks.getItem(reloadedKey) !== null) return;
    marks.setItem(reloadedKey, "true");
  } catch {
    return;
  }
  reload();
}

// An answer read, so a later deploy may reload the page again.
export function answerRead(marks: Marks): void {
  try {
    marks.removeItem(reloadedKey);
  } catch {
    // Kept or not, the page carries on.
  }
}

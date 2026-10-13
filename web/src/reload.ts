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

// Holds the id of the page load that asked for the reload, a space, and the
// path of the answer that failed. A page from before the id kept the path
// alone.
const reloadedKey = "askme-reloaded-for";

// Each page load has its own id, so a page can tell its own mark from one an
// earlier page left.
const thisPage = `page-${String(Math.random())}`;

const markOf = (page: string, answer: string) => `${page} ${answer}`;

function readMark(mark: string): { page: string; answer: string } {
  const space = mark.indexOf(" ");
  return space < 0
    ? { page: "", answer: mark }
    : { page: mark.slice(0, space), answer: mark.slice(space + 1) };
}

// After a deploy changes one of the page's answers, the page left open
// cannot read it, and a reload fetches the new page (index.html is served
// no-cache). The mark lets that happen once, for any answer, so a page whose
// own schema is wrong does not reload for ever. Where the mark cannot be
// kept, it does not reload. A mark this page set, found while this page
// still runs, means its reload did not happen, as when the person stayed at
// "Leave site?", so it does not stop the next one.
export function reloadOnce(
  marks: Marks,
  reload: () => void,
  answer: string,
  page: string = thisPage,
): void {
  try {
    const mark = marks.getItem(reloadedKey);
    if (mark !== null && readMark(mark).page !== page) return;
    marks.setItem(reloadedKey, markOf(page, answer));
  } catch {
    return;
  }
  reload();
}

// The answer that reloaded the page has been read, so a later deploy may
// reload it again. Reading another answer does not clear the mark: the
// rules may still read while the poll does not, and the page would reload
// each time it loaded.
export function answerRead(marks: Marks, answer: string): void {
  try {
    const mark = marks.getItem(reloadedKey);
    if (mark !== null && readMark(mark).answer === answer) {
      marks.removeItem(reloadedKey);
    }
  } catch {
    // Kept or not, the page carries on.
  }
}

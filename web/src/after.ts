// Calls a function once a moment has passed, by this clock, and gives a
// function that stops the wait. A computer or phone that sleeps can hold
// timers back, so it looks at the clock at least once a minute as well,
// and is at most a minute late after waking. Even for a moment already
// past, it calls with the next timer, not at once.
const lookMs = 60 * 1000;

export function after(at: number, then: () => void): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const wait = () => {
    const left = Math.max(at - Date.now(), 0);
    timer = setTimeout(
      () => {
        if (Date.now() >= at) then();
        else wait();
      },
      Math.min(left, lookMs),
    );
  };
  wait();
  return () => {
    clearTimeout(timer);
  };
}

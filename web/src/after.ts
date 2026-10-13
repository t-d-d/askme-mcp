// A device that sleeps can hold timers back, so this looks at the clock at
// least once a minute. It never calls back at once, even for a moment
// already past.
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

/** Injectable time source so expiry logic is testable without fake timers. */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

/** Fixed or manually advanced clock for tests. */
export function fixedClock(start: Date | string): Clock & { advance(ms: number): void } {
  let now = new Date(start).getTime();
  const clock = (() => new Date(now)) as Clock & { advance(ms: number): void };
  clock.advance = (ms: number) => {
    now += ms;
  };
  return clock;
}

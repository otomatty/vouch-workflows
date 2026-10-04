const instant = process.env.VOUCH_TEST_TIME;
if (!instant) throw new Error("TEST-5: a fixed clock is required");
const timestamp = Date.parse(instant);
const NativeDate = Date;
// Test-only preload: keep normal Date arguments while fixing the no-argument clock.
globalThis.Date = new Proxy(NativeDate, {
  construct: (target, args, newTarget) =>
    Reflect.construct(target, args.length ? args : [timestamp], newTarget),
  apply: () => new NativeDate(timestamp).toString(),
  get: (target, key) =>
    key === "now" ? () => timestamp : Reflect.get(target, key),
});

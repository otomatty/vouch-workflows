// TEST-5: tests use recorded inputs; accidental HTTP calls fail immediately.
globalThis.fetch = () => {
  throw new Error("TEST-5: network access is disabled in tests.");
};

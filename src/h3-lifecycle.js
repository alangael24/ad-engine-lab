// Server-owned limits. SQL mirrors these values; the recovery tests check both.
export const H3_LIMITS = Object.freeze({
  preparationMs: 45 * 60_000,
  executionMs: 20 * 60_000,
  providerTtlMs: 70 * 60_000,
  reconciliationMs: 2 * 60_000,
  pendingMs: 120 * 60_000,
  referenceUrlSeconds: 2 * 60 * 60,
});
export const realClock = {
  now: () => Date.now(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: id => clearInterval(id),
};

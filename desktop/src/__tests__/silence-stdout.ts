/**
 * Loaded via --import before tests. Keeps Node test-runner IPC free of
 * unstructured stdout (see admin silence-stdout helper for details).
 */
const noop = (): void => {};
console.log = noop;
console.info = noop;
console.debug = noop;

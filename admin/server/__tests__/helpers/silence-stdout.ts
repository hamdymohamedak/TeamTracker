/**
 * Loaded via --import before tests. Node's test runner shares each child
 * process stdout with its V8-serialized IPC channel; any console.log
 * (migrations, websocket banners, logger) corrupts that stream on CI.
 */
const noop = (): void => {};
console.log = noop;
console.info = noop;
console.debug = noop;

/** Stdout during tests corrupts node:test IPC when files run in child processes. */
export function wsLog(message: string): void {
  if (process.env.NODE_ENV === 'test') return;
  console.log(message);
}

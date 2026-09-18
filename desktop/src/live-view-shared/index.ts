// Thin re-export — canonical source lives in shared/src/live-view/.
// TypeScript resolves the .js import to the adjacent .d.ts declaration (no rootDir issue).
// tsx/Node resolves it to the compiled .js implementation.
export * from '../../../shared/dist/live-view/index.js';

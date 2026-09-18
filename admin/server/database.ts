// Thin re-export shim — all implementations live in ./database/
// Keeping this file ensures all existing `from './database.js'` imports continue to work.
export * from './database/index.js';

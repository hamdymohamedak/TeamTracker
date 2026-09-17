/**
 * @deprecated Import from `./privacy-guard.js` instead.
 * Thin re-exports so existing imports keep working during the PrivacyGuard migration.
 */

export {
  setCapturePrivacyBlocks,
  getCapturePrivacyBlocks,
  setPrivacyUrlMode,
  getPrivacyUrlMode,
  normalize,
  isUrlPattern,
  patternHost,
  refreshBrowserUrls,
  prefetchBrowserUrlsForPrivacy,
  probeBrowserUrls,
  evaluateCapturePrivacy,
  shouldBlockScreenshotAsync,
  shouldBlockLiveViewAsync,
  shouldBlockScreenshot,
  shouldBlockLiveView,
  decide,
  isCaptureBlocked,
  type CapturePrivacyBlock,
  type PrivacyDecision,
  type PrivacyPurpose,
  type PrivacyUrlMode,
} from './privacy-guard.js';

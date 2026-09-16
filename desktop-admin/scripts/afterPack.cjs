'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/**
 * When no Apple Developer ID cert is configured (CSC_LINK), ad-hoc sign the
 * .app so nested Electron frameworks share a stable identifier.
 *
 * Ad-hoc signing is NOT Developer ID trust and does NOT satisfy Gatekeeper /
 * notarization. Users of unsigned builds still need Open Anyway once.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.CSC_LINK) return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  if (!fs.existsSync(appPath)) {
    console.warn(`[afterPack] skip ad-hoc sign: missing ${appPath}`);
    return;
  }

  const identifier =
    (context.packager.config && context.packager.config.appId) ||
    'com.teamtracker.admin';

  console.log(`[afterPack] Ad-hoc signing unsigned macOS app: ${appPath}`);

  const frameworks = path.join(appPath, 'Contents', 'Frameworks');
  if (fs.existsSync(frameworks)) {
    execFileSync(
      'bash',
      [
        '--noprofile',
        '--norc',
        '-lc',
        [
          `APP=${JSON.stringify(frameworks)}`,
          'find "$APP" -type f -perm +111 -exec codesign --force --sign - {} \\; 2>/dev/null || true',
          'find "$APP" \\( -name "*.dylib" -o -name "*.framework" -o -name "*.app" \\) -exec codesign --force --sign - {} \\; 2>/dev/null || true',
        ].join('; '),
      ],
      { stdio: 'inherit' },
    );
  }

  execFileSync(
    'codesign',
    ['--force', '--sign', '-', '--identifier', identifier, appPath],
    { stdio: 'inherit' },
  );
};

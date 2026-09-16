import React, { useState, useEffect } from 'react';

const GITHUB_RELEASE_URL = 'https://github.com/hamdymohamedak/TeamTracker/releases/latest';

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

type DetectedOS = 'mac-arm' | 'mac-intel' | 'windows' | 'linux' | 'unknown';

function detectOS(): DetectedOS {
  const ua = navigator.userAgent.toLowerCase();
  const platform = (navigator as any).userAgentData?.platform?.toLowerCase() || navigator.platform?.toLowerCase() || '';

  if (ua.includes('win') || platform.includes('win')) return 'windows';
  if (ua.includes('linux') || platform.includes('linux')) return 'linux';
  if (ua.includes('mac') || platform.includes('mac')) {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') as WebGLRenderingContext | null;
      if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) {
          const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL).toLowerCase();
          if (renderer.includes('apple m') || renderer.includes('apple gpu')) return 'mac-arm';
        }
      }
    } catch {}
    return 'mac-intel';
  }
  return 'unknown';
}

function formatSize(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(0) + ' MB';
}

export const Download: React.FC = () => {
  const [os, setOS] = useState<DetectedOS>('unknown');
  const [assets, setAssets] = useState<ReleaseAsset[]>([]);
  const [version, setVersion] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setOS(detectOS());

    fetch('https://api.github.com/repos/hamdymohamedak/TeamTracker/releases/latest')
      .then(r => r.json())
      .then(data => {
        if (data.assets) {
          setAssets(data.assets);
          setVersion(data.tag_name || '');
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const findAsset = (pattern: string): ReleaseAsset | undefined =>
    assets.find(a => a.name.toLowerCase().includes(pattern.toLowerCase()));

  const macArmDmg = findAsset('arm64.dmg');
  const macIntelDmg = findAsset('1.0.0.dmg') || assets.find(a => a.name.endsWith('.dmg') && !a.name.includes('arm64'));
  const windowsExe = findAsset('.exe');
  const linuxAppImage = findAsset('.appimage') || findAsset('appimage');
  const linuxDeb = findAsset('.deb');

  const primaryAsset = os === 'windows' ? windowsExe
    : os === 'linux' ? (linuxAppImage || linuxDeb)
    : os === 'mac-arm' ? macArmDmg
    : os === 'mac-intel' ? macIntelDmg
    : macArmDmg;

  const primaryLabel = os === 'windows' ? 'Download for Windows'
    : os === 'linux' ? 'Download for Linux'
    : os === 'mac-arm' ? 'Download for Mac (Apple Silicon)'
    : os === 'mac-intel' ? 'Download for Mac (Intel)'
    : 'Download for Mac';

  return (
    <div className="auth-shell" style={{ alignItems: 'stretch', padding: '40px 20px' }}>
      <div className="auth-panel" style={{ maxWidth: 560, margin: 'auto' }}>
        <div className="auth-brand" style={{ textAlign: 'center', paddingBottom: 32 }}>
          <div className="auth-brand-mark" style={{ margin: '0 auto 14px' }}>T</div>
          <h1>TeamTracker</h1>
          <p>Desktop tracker {version}</p>
        </div>

        <div style={{ padding: '28px 32px 32px' }}>
          <p style={{ textAlign: 'center', color: 'var(--tt-text-muted)', margin: '0 0 24px', lineHeight: 1.65 }}>
            Install the desktop tracker on each employee device. Activity syncs live to your admin dashboard.
          </p>

          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--tt-text-faint)', padding: 20 }}>Loading latest release…</div>
          ) : primaryAsset ? (
            <>
              <a href={primaryAsset.browser_download_url} className="tt-btn tt-btn-primary" style={{ width: '100%', textDecoration: 'none', marginBottom: 18, padding: '16px 20px', flexDirection: 'column', gap: 4 }}>
                <span>{primaryLabel}</span>
                <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.85 }}>{formatSize(primaryAsset.size)}</span>
              </a>

              <div style={{ marginBottom: 24 }}>
                <p style={{ fontSize: 13, color: 'var(--tt-text-faint)', textAlign: 'center', marginBottom: 10 }}>Other platforms</p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                  {macArmDmg && os !== 'mac-arm' && (
                    <a href={macArmDmg.browser_download_url} className="tt-btn tt-btn-ghost" style={{ textDecoration: 'none', fontSize: 13 }}>
                      Mac (Apple Silicon) · {formatSize(macArmDmg.size)}
                    </a>
                  )}
                  {macIntelDmg && os !== 'mac-intel' && (
                    <a href={macIntelDmg.browser_download_url} className="tt-btn tt-btn-ghost" style={{ textDecoration: 'none', fontSize: 13 }}>
                      Mac (Intel) · {formatSize(macIntelDmg.size)}
                    </a>
                  )}
                  {windowsExe && os !== 'windows' && (
                    <a href={windowsExe.browser_download_url} className="tt-btn tt-btn-ghost" style={{ textDecoration: 'none', fontSize: 13 }}>
                      Windows · {formatSize(windowsExe.size)}
                    </a>
                  )}
                  {linuxAppImage && os !== 'linux' && (
                    <a href={linuxAppImage.browser_download_url} className="tt-btn tt-btn-ghost" style={{ textDecoration: 'none', fontSize: 13 }}>
                      Linux · {formatSize(linuxAppImage.size)}
                    </a>
                  )}
                  {linuxDeb && os === 'linux' && linuxAppImage && (
                    <a href={linuxDeb.browser_download_url} className="tt-btn tt-btn-ghost" style={{ textDecoration: 'none', fontSize: 13 }}>
                      Linux (.deb) · {formatSize(linuxDeb.size)}
                    </a>
                  )}
                </div>
              </div>
            </>
          ) : (
            <a href={GITHUB_RELEASE_URL} className="tt-btn tt-btn-primary" style={{ width: '100%', textDecoration: 'none', marginBottom: 20 }} target="_blank" rel="noopener noreferrer">
              View downloads on GitHub
            </a>
          )}

          <div className="tt-card" style={{ padding: '18px 20px', marginBottom: 22, background: 'var(--tt-surface-muted)' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Setup instructions</h3>
            {os === 'windows' ? (
              <ol style={styles.stepsList}>
                <li>Run the installer and follow the wizard</li>
                <li>Unsigned builds may show SmartScreen / unknown publisher — click <strong>More info</strong> then <strong>Run anyway</strong> (do not disable SmartScreen)</li>
                <li>Enter the setup token from your admin (Employees → Setup Token)</li>
                <li>TeamTracker appears in the Dock / taskbar — use the tray menu to quit when finished</li>
              </ol>
            ) : os === 'linux' ? (
              <ol style={styles.stepsList}>
                <li>Download the <strong>AppImage</strong> (or <code>.deb</code> for Debian/Ubuntu)</li>
                <li>Make it executable: <code>chmod +x TeamTracker-*.AppImage</code>, then run it</li>
                <li>For window titles: install <code>xdotool</code> on X11. On GNOME Wayland, install the <strong>Focused Window D-Bus</strong> Shell extension.</li>
                <li>Enter the setup token from your admin (Employees → Setup Token)</li>
              </ol>
            ) : (
              <ol style={styles.stepsList}>
                <li>Open the DMG and drag <strong>TeamTracker</strong> to Applications</li>
                <li>Unsigned builds may show a Gatekeeper warning — right-click → <strong>Open</strong>, or use <strong>Privacy &amp; Security → Open Anyway</strong> (do not disable Gatekeeper)</li>
                <li>Grant <strong>Screen Recording</strong> and <strong>Accessibility</strong> when prompted</li>
                <li>Enter the setup token from your admin (Employees → Setup Token)</li>
              </ol>
            )}
          </div>

          <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--tt-text-muted)' }}>
            <a href="/login" style={{ fontWeight: 650, textDecoration: 'none' }}>Admin login</a>
            <span style={{ margin: '0 8px', opacity: 0.4 }}>·</span>
            <a href="https://github.com/hamdymohamedak/TeamTracker" target="_blank" rel="noopener noreferrer" style={{ fontWeight: 650, textDecoration: 'none' }}>GitHub</a>
          </div>
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  stepsList: {
    margin: 0,
    paddingLeft: 20,
    fontSize: 14,
    color: 'var(--tt-text-muted)',
    lineHeight: 1.8,
  },
};

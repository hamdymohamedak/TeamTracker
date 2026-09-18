import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Apple, Download as DownloadIcon, Github, Monitor, Terminal } from 'lucide-react';
import { useI18n, LanguageSwitcher } from '@/contexts/I18nContext';
import { PageHero, PagePanel } from '@/components/PageHero';

const GITHUB_RELEASE_URL = 'https://github.com/hamdymohamedak/TeamTracker/releases/latest';
const GITHUB_REPO_URL = 'https://github.com/hamdymohamedak/TeamTracker';

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

type DetectedOS = 'mac-arm' | 'mac-intel' | 'windows' | 'linux' | 'unknown';

function detectOS(): DetectedOS {
  const ua = navigator.userAgent.toLowerCase();
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform?.toLowerCase()
    || navigator.platform?.toLowerCase()
    || '';

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
    } catch { /* ignore */ }
    return 'mac-intel';
  }
  return 'unknown';
}

function formatSize(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(0) + ' MB';
}

function PrimaryIcon({ os }: { os: DetectedOS }) {
  if (os === 'windows') return <Monitor size={18} strokeWidth={2.1} aria-hidden />;
  if (os === 'linux') return <Terminal size={18} strokeWidth={2.1} aria-hidden />;
  if (os === 'mac-arm' || os === 'mac-intel') return <Apple size={18} strokeWidth={2.1} aria-hidden />;
  return <DownloadIcon size={18} strokeWidth={2.1} aria-hidden />;
}

export const Download: React.FC = () => {
  const { t } = useI18n();
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

  const primaryLabel = os === 'windows' ? t('download.primaryWindows')
    : os === 'linux' ? t('download.primaryLinux')
    : os === 'mac-arm' ? t('download.primaryMacArm')
    : os === 'mac-intel' ? t('download.primaryMacIntel')
    : t('download.primaryDefault');

  const setupSteps = useMemo(() => {
    if (os === 'windows') {
      return [
        t('download.winStep1'),
        t('download.winStep2'),
        t('download.winStep3'),
        t('download.winStep4'),
      ];
    }
    if (os === 'linux') {
      return [
        t('download.linuxStep1'),
        t('download.linuxStep2'),
        t('download.linuxStep3'),
        t('download.linuxStep4'),
      ];
    }
    return [
      t('download.macStep1'),
      t('download.macStep2'),
      t('download.macStep3'),
      t('download.macStep4'),
    ];
  }, [os, t]);

  return (
    <div className="auth-shell" style={{ alignItems: 'stretch', padding: '40px 20px' }}>
      <div className="auth-panel" style={{ maxWidth: 560, margin: 'auto' }}>
        <div className="auth-brand">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div className="auth-brand-mark">T</div>
            <LanguageSwitcher variant="auth" />
          </div>
          <h1>TeamTracker</h1>
          <p>{version ? t('download.versionLabel', { version }) : t('download.title')}</p>
        </div>

        <div style={{ padding: '24px 28px 28px' }}>
          <PageHero
            icon={DownloadIcon}
            title={t('download.title')}
            subtitle={t('download.desc')}
          />

          {loading ? (
            <p className="tt-muted" style={{ textAlign: 'center', padding: '20px 0' }}>
              {t('download.loading')}
            </p>
          ) : primaryAsset ? (
            <>
              <a
                href={primaryAsset.browser_download_url}
                className="tt-btn tt-btn-primary"
                style={{
                  width: '100%',
                  textDecoration: 'none',
                  marginBottom: 18,
                  padding: '16px 20px',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <PrimaryIcon os={os} />
                  {primaryLabel}
                </span>
                <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.85 }}>{formatSize(primaryAsset.size)}</span>
              </a>

              <div style={{ marginBottom: 24 }}>
                <p className="tt-muted" style={{ textAlign: 'center', marginBottom: 10, fontSize: 13 }}>
                  {t('download.other')}
                </p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                  {macArmDmg && os !== 'mac-arm' && (
                    <a href={macArmDmg.browser_download_url} className="tt-btn tt-btn-ghost" style={{ textDecoration: 'none', fontSize: 13 }}>
                      <Apple size={14} aria-hidden />
                      {t('download.platformMacArm')} · {formatSize(macArmDmg.size)}
                    </a>
                  )}
                  {macIntelDmg && os !== 'mac-intel' && (
                    <a href={macIntelDmg.browser_download_url} className="tt-btn tt-btn-ghost" style={{ textDecoration: 'none', fontSize: 13 }}>
                      <Apple size={14} aria-hidden />
                      {t('download.platformMacIntel')} · {formatSize(macIntelDmg.size)}
                    </a>
                  )}
                  {windowsExe && os !== 'windows' && (
                    <a href={windowsExe.browser_download_url} className="tt-btn tt-btn-ghost" style={{ textDecoration: 'none', fontSize: 13 }}>
                      <Monitor size={14} aria-hidden />
                      {t('download.platformWindows')} · {formatSize(windowsExe.size)}
                    </a>
                  )}
                  {linuxAppImage && os !== 'linux' && (
                    <a href={linuxAppImage.browser_download_url} className="tt-btn tt-btn-ghost" style={{ textDecoration: 'none', fontSize: 13 }}>
                      <Terminal size={14} aria-hidden />
                      {t('download.platformLinux')} · {formatSize(linuxAppImage.size)}
                    </a>
                  )}
                  {linuxDeb && os === 'linux' && linuxAppImage && (
                    <a href={linuxDeb.browser_download_url} className="tt-btn tt-btn-ghost" style={{ textDecoration: 'none', fontSize: 13 }}>
                      <Terminal size={14} aria-hidden />
                      {t('download.platformLinuxDeb')} · {formatSize(linuxDeb.size)}
                    </a>
                  )}
                </div>
              </div>
            </>
          ) : (
            <a
              href={GITHUB_RELEASE_URL}
              className="tt-btn tt-btn-primary"
              style={{ width: '100%', textDecoration: 'none', marginBottom: 20 }}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github size={16} aria-hidden />
              {t('download.viewGithub')}
            </a>
          )}

          <PagePanel title={t('download.setup')}>
            <ol style={styles.stepsList}>
              {setupSteps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </PagePanel>

          <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--tt-text-muted)' }}>
            <Link to="/login" style={{ fontWeight: 650, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {t('download.adminLogin')}
            </Link>
            <span style={{ margin: '0 8px', opacity: 0.4 }}>·</span>
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontWeight: 650, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Github size={14} aria-hidden />
              {t('download.github')}
            </a>
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

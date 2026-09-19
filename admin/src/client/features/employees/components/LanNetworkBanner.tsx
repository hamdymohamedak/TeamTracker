import React, { useEffect, useState } from 'react';
import { Network, Copy, Check } from 'lucide-react';
import { useI18n } from '@/contexts/I18nContext';
import { fetchLanInfo, type LanInfoResponse } from '@/lib/lanInfo';

/** Compact banner: office is visible on the LAN (mDNS) + copy primary URL. */
export const LanNetworkBanner: React.FC = () => {
  const { t } = useI18n();
  const [info, setInfo] = useState<LanInfoResponse | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchLanInfo().then((data) => {
      if (!cancelled) setInfo(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!info || !info.discovery) return null;

  const primary = info.primaryUrl;
  if (!primary && info.lanUrls.length === 0) {
    return (
      <div style={styles.banner} role="status">
        <Network size={18} strokeWidth={2.2} style={{ flexShrink: 0, color: 'var(--tt-accent)' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.title}>{t('lan.title')}</div>
          <div style={styles.muted}>{t('lan.noAddress')}</div>
        </div>
      </div>
    );
  }

  const copyUrl = async () => {
    if (!primary) return;
    try {
      await navigator.clipboard.writeText(primary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div style={styles.banner} role="status">
      <Network size={18} strokeWidth={2.2} style={{ flexShrink: 0, color: 'var(--tt-accent)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={styles.title}>
          {t('lan.visibleAs', { name: info.officeName })}
        </div>
        <div style={styles.muted}>
          {t('lan.hint')}
          {primary ? (
            <>
              {' '}
              <code style={styles.code}>{primary}</code>
            </>
          ) : null}
        </div>
      </div>
      {primary ? (
        <button type="button" className="tt-btn tt-btn-ghost" style={{ flexShrink: 0 }} onClick={copyUrl}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? t('lan.copied') : t('lan.copyUrl')}
        </button>
      ) : null}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  banner: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '12px 14px',
    marginBottom: 16,
    borderRadius: 'var(--tt-radius-sm)',
    border: '1px solid var(--tt-border)',
    background: 'var(--tt-surface-muted)',
  },
  title: {
    fontWeight: 650,
    fontSize: 13,
    color: 'var(--tt-text)',
    marginBottom: 4,
  },
  muted: {
    fontSize: 12,
    color: 'var(--tt-text-muted)',
    lineHeight: 1.45,
  },
  code: {
    fontSize: 11,
    fontFamily: 'ui-monospace, monospace',
    wordBreak: 'break-all',
  },
};

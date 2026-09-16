import React, { useState } from 'react';
import { useI18n } from '../contexts/I18nContext';

interface Props {
  codes: string[];
  title?: string;
  onContinue?: () => void;
  continueLabel?: string;
}

/** One-time display of offline recovery codes after signup / regenerate. */
export const RecoveryCodesPanel: React.FC<Props> = ({
  codes,
  title,
  onContinue,
  continueLabel,
}) => {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const download = () => {
    const blob = new Blob(
      [
        'TeamTracker recovery codes\n',
        'Store these offline. Each code works once.\n\n',
        codes.join('\n'),
        '\n',
      ],
      { type: 'text/plain' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'teamtracker-recovery-codes.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        style={{
          background: 'var(--tt-warning-soft, rgba(180,140,40,0.12))',
          border: '1px solid rgba(180,140,40,0.35)',
          borderRadius: 'var(--tt-radius-sm)',
          padding: '12px 14px',
          fontSize: 14,
          lineHeight: 1.5,
          color: 'var(--tt-text)',
        }}
      >
        <strong>{title || t('auth.recoveryCodesTitle')}</strong>
        <p style={{ margin: '8px 0 0', color: 'var(--tt-text-muted)', fontSize: 13 }}>
          {t('auth.recoveryCodesHint')}
        </p>
      </div>

      <div
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 13,
          background: 'var(--tt-surface-muted)',
          border: '1px solid var(--tt-border-strong)',
          borderRadius: 'var(--tt-radius-sm)',
          padding: 14,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px 16px',
        }}
      >
        {codes.map((c) => (
          <div key={c}>{c}</div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="tt-btn tt-btn-ghost" onClick={copyAll}>
          {copied ? t('auth.copied') : t('auth.copyCodes')}
        </button>
        <button type="button" className="tt-btn tt-btn-ghost" onClick={download}>
          {t('auth.downloadCodes')}
        </button>
        {onContinue && (
          <button type="button" className="tt-btn tt-btn-primary" onClick={onContinue} style={{ marginLeft: 'auto' }}>
            {continueLabel || t('auth.codesSavedContinue')}
          </button>
        )}
      </div>
    </div>
  );
};

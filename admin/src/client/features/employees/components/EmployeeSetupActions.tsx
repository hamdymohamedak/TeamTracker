import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useI18n } from '@/contexts/I18nContext';
import { ModalCloseButton } from '@/components/Icon';
import { buildActivationPayload } from '@/lib/lanInfo';
import type { InstallPromptState, SetupTokenState } from '../types';

interface Props {
  setupToken: SetupTokenState | null;
  setSetupToken: React.Dispatch<React.SetStateAction<SetupTokenState | null>>;
  installPrompt: InstallPromptState | null;
  setInstallPrompt: React.Dispatch<React.SetStateAction<InstallPromptState | null>>;
}

export const EmployeeSetupActions: React.FC<Props> = ({
  setupToken,
  setSetupToken,
  installPrompt,
  setInstallPrompt,
}) => {
  const { t } = useI18n();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setQrDataUrl(null);
    if (!setupToken?.token || !setupToken.serverUrl) return;

    const payload = buildActivationPayload({
      setupToken: setupToken.token,
      serverUrl: setupToken.serverUrl,
      employeeName: setupToken.employeeName,
    });

    void QRCode.toDataURL(JSON.stringify(payload), {
      width: 200,
      margin: 1,
      errorCorrectionLevel: 'M',
    }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    }).catch(() => {
      if (!cancelled) setQrDataUrl(null);
    });

    return () => {
      cancelled = true;
    };
  }, [setupToken]);

  return (
    <>
      {/* Setup token modal */}
      {setupToken && (
        <div
          className="tt-modal-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setSetupToken(null)}
        >
          <div className="tt-modal tt-modal--md" onClick={e => e.stopPropagation()}>
            <div className="tt-modal-header">
              <h2 className="tt-modal-title">
                {t('employees.setupToken')} — {setupToken.employeeName}
              </h2>
              <ModalCloseButton onClick={() => setSetupToken(null)} />
            </div>
            <div className="tt-modal-body">
              <div style={styles.tokenBox}>{setupToken.token}</div>
              {setupToken.serverUrl ? (
                <p style={{ fontSize: 12, color: 'var(--tt-text-muted)', margin: '0 0 12px' }}>
                  {t('employees.serverUrlLabel')}:{' '}
                  <code style={{ fontSize: 11 }}>{setupToken.serverUrl}</code>
                </p>
              ) : null}
              {qrDataUrl ? (
                <div style={styles.qrBlock}>
                  <img src={qrDataUrl} alt={t('employees.qrAlt')} width={200} height={200} />
                  <p style={{ fontSize: 12, color: 'var(--tt-text-muted)', margin: '8px 0 0', textAlign: 'center' }}>
                    {t('employees.qrHint')}
                  </p>
                </div>
              ) : null}
              <div style={styles.infoCallout}>
                <p style={{ fontSize: '13px', color: 'var(--tt-text)', margin: '0 0 8px', lineHeight: '1.5' }}>
                  {t('employees.tokenShare', { name: setupToken.employeeName })}
                </p>
                <p style={{ fontSize: '12px', color: 'var(--tt-text-muted)', margin: 0, lineHeight: '1.5' }}>
                  {t('employees.tokenExpiry')}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' as const }}>
                <a
                  href="/download"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tt-btn tt-btn-primary"
                  style={{ textDecoration: 'none' }}
                >
                  {t('employees.downloadTracker')}
                </a>
                <a
                  href="https://github.com/hamdymohamedak/TeamTracker#3-install-the-desktop-tracker"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tt-btn tt-btn-ghost"
                  style={{ textDecoration: 'none' }}
                >
                  {t('employees.setupInstructions')}
                </a>
              </div>
            </div>
            <div className="tt-modal-footer">
              <button
                type="button"
                className="tt-btn tt-btn-ghost"
                onClick={() => setSetupToken(null)}
              >
                {t('common.close')}
              </button>
              <button
                type="button"
                className="tt-btn tt-btn-primary"
                onClick={() => navigator.clipboard.writeText(setupToken.token)}
              >
                {t('employees.copyToken')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Install-on-this-device modal */}
      {installPrompt && (
        <div
          className="tt-modal-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setInstallPrompt(null)}
        >
          <div className="tt-modal tt-modal--md" onClick={e => e.stopPropagation()}>
            <div className="tt-modal-header">
              <h2 className="tt-modal-title">{t('employees.installDevice')}</h2>
              <ModalCloseButton onClick={() => setInstallPrompt(null)} />
            </div>
            <div className="tt-modal-body">
              <p style={{ color: 'var(--tt-text)', margin: '0 0 12px', fontSize: '14px', lineHeight: 1.5 }}>
                {t('employees.installSaved', { name: installPrompt.employeeName })}
              </p>
              <div style={styles.successCallout}>
                <div style={{ fontWeight: 650, marginBottom: '6px' }}>{t('employees.installNextTitle')}</div>
                <ol style={{ margin: 0, paddingLeft: '18px' }}>
                  <li>{t('employees.installStep1')}</li>
                  <li>{t('employees.installStep2')}</li>
                  <li>
                    {t('employees.installStep3', { name: installPrompt.employeeName })}
                  </li>
                </ol>
              </div>
            </div>
            <div className="tt-modal-footer">
              <button
                type="button"
                className="tt-btn tt-btn-ghost"
                onClick={() => setInstallPrompt(null)}
              >
                {t('common.close')}
              </button>
              <a
                href="/download"
                target="_blank"
                rel="noopener noreferrer"
                className="tt-btn tt-btn-primary"
                style={{ textDecoration: 'none' }}
              >
                {t('employees.downloadInstaller')}
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const styles: Record<string, React.CSSProperties> = {
  tokenBox: {
    backgroundColor: 'var(--tt-surface-muted)',
    border: '1px solid var(--tt-border-strong)',
    borderRadius: 'var(--tt-radius-sm)',
    padding: 16,
    fontFamily: 'ui-monospace, monospace',
    fontSize: 13,
    wordBreak: 'break-all',
    color: 'var(--tt-text)',
    marginBottom: 12,
  },
  qrBlock: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    marginBottom: 12,
    padding: 12,
    borderRadius: 'var(--tt-radius-sm)',
    border: '1px solid var(--tt-border)',
    background: 'var(--tt-surface)',
  },
  infoCallout: {
    backgroundColor: 'var(--tt-info-soft)',
    border: '1px solid var(--tt-border)',
    borderRadius: 'var(--tt-radius-sm)',
    padding: '14px 16px',
    marginBottom: 12,
  },
  successCallout: {
    backgroundColor: 'var(--tt-success-soft)',
    border: '1px solid rgba(31, 169, 113, 0.3)',
    borderRadius: 'var(--tt-radius-sm)',
    padding: '12px 14px',
    fontSize: 13,
    color: 'var(--tt-success)',
    lineHeight: 1.5,
  },
};

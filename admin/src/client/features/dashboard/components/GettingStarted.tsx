import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/contexts/I18nContext';

interface GettingStartedProps {
  orgName: string;
  onDismiss: () => void;
  showDismiss: boolean;
}

const gsStyles: Record<string, React.CSSProperties> = {
  card: {
    maxWidth: '640px',
    margin: '40px auto',
    borderRadius: '16px',
    overflow: 'hidden',
    boxShadow: 'var(--tt-shadow-md)',
    backgroundColor: 'var(--tt-surface)',
  },
  header: {
    background: 'linear-gradient(135deg, var(--tt-text) 0%, var(--tt-teal) 100%)',
    padding: '36px 32px 28px',
    color: '#fff',
  },
  headerTitle: {
    fontSize: '26px',
    fontWeight: 700,
    margin: '0 0 6px',
  },
  headerSub: {
    fontSize: '15px',
    margin: 0,
    color: 'rgba(255,255,255,0.85)',
  },
  body: {
    padding: '28px 32px 32px',
  },
  sectionLabel: {
    fontSize: '13px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    color: 'var(--tt-text-faint)',
    letterSpacing: '0.5px',
    marginBottom: '16px',
  },
  step: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '14px',
    padding: '16px',
    borderRadius: '10px',
    backgroundColor: 'var(--tt-surface-muted)',
    marginBottom: '12px',
  },
  stepNumber: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    backgroundColor: 'var(--tt-teal)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    fontWeight: 700,
    flexShrink: 0,
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    fontSize: '15px',
    fontWeight: 600,
    color: 'var(--tt-text)',
    margin: '0 0 4px',
  },
  stepDesc: {
    fontSize: '13px',
    color: 'var(--tt-text-muted)',
    margin: 0,
    lineHeight: '1.5',
  },
  stepLink: {
    color: 'var(--tt-teal)',
    fontWeight: 500,
    cursor: 'pointer',
    textDecoration: 'none',
    fontSize: '13px',
  },
};

export const GettingStarted: React.FC<GettingStartedProps> = ({ orgName, onDismiss, showDismiss }) => {
  const navigate = useNavigate();
  const { t } = useI18n();

  return (
    <div style={gsStyles.card}>
      <div style={gsStyles.header}>
        <h1 style={gsStyles.headerTitle}>
          {orgName ? t('dashboard.welcomeNamed', { name: orgName }) : t('dashboard.welcome') + '!'}
        </h1>
        <p style={gsStyles.headerSub}>{t('dashboard.followSteps')}</p>
      </div>
      <div style={gsStyles.body}>
        <div style={gsStyles.sectionLabel}>{t('dashboard.gettingStarted')}</div>

        <div style={gsStyles.step}>
          <div style={gsStyles.stepNumber}>1</div>
          <div style={gsStyles.stepContent}>
            <p style={gsStyles.stepTitle}>{t('dashboard.step1Title')}</p>
            <p style={gsStyles.stepDesc}>
              {t('dashboard.step1Desc')}{' '}
              <span style={gsStyles.stepLink} onClick={() => navigate('/employees')}>
                {t('dashboard.goEmployees')}
              </span>
            </p>
          </div>
        </div>

        <div style={gsStyles.step}>
          <div style={gsStyles.stepNumber}>2</div>
          <div style={gsStyles.stepContent}>
            <p style={gsStyles.stepTitle}>{t('dashboard.step2Title')}</p>
            <p style={gsStyles.stepDesc}>{t('dashboard.step2Desc')}</p>
          </div>
        </div>

        <div style={gsStyles.step}>
          <div style={gsStyles.stepNumber}>3</div>
          <div style={gsStyles.stepContent}>
            <p style={gsStyles.stepTitle}>{t('dashboard.step3Title')}</p>
            <p style={gsStyles.stepDesc}>
              {t('dashboard.step3Desc')}{' '}
              <a
                href="https://github.com/hamdymohamedak/TeamTracker#3-install-the-desktop-tracker"
                target="_blank"
                rel="noopener noreferrer"
                style={gsStyles.stepLink}
              >
                {t('dashboard.setupInstructions')}
              </a>
            </p>
          </div>
        </div>

        {showDismiss && (
          <div style={{ textAlign: 'center', marginTop: '8px' }}>
            <span
              onClick={onDismiss}
              style={{
                color: '#b0b8c1',
                fontSize: '13px',
                cursor: 'pointer',
                textDecoration: 'none',
              }}
            >
              {t('common.close')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

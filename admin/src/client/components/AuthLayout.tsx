import React from 'react';
import { Link } from 'react-router-dom';
import { LanguageSwitcher, useI18n } from '../contexts/I18nContext';

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  brandSub?: string;
}

export const AuthLayout: React.FC<AuthLayoutProps> = ({
  title,
  subtitle,
  children,
  brandSub,
}) => {
  const { t } = useI18n();
  return (
    <div className="auth-shell">
      <div className="auth-panel">
        <div className="auth-brand">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div className="auth-brand-mark">T</div>
            <LanguageSwitcher variant="auth" />
          </div>
          <h1>TeamTracker</h1>
          <p>{brandSub || t('auth.brandSub')}</p>
        </div>
        <div className="auth-form">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p className="page-subtitle" style={{ marginTop: 4 }}>{subtitle}</p> : null}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
};

export const AuthFooterLink: React.FC<{ to: string; children: React.ReactNode; preface?: string }> = ({
  to,
  children,
  preface,
}) => (
  <p className="auth-footer">
    {preface ? <>{preface} </> : null}
    <Link to={to}>{children}</Link>
  </p>
);

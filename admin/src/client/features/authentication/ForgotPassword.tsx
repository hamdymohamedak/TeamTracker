import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useI18n } from '@/contexts/I18nContext';
import { AuthLayout, AuthFooterLink } from '@/components/AuthLayout';

/**
 * Offline password reset: email + one recovery code + new password.
 * No external email service required.
 */
export const ForgotPassword: React.FC = () => {
  const [email, setEmail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { t } = useI18n();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (newPassword.length < 6) {
      setError(t('auth.passwordHint'));
      return;
    }
    if (newPassword !== confirm) {
      setError(t('auth.passwordMismatch'));
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api.post('/api/auth/reset-with-recovery-code', {
        email,
        recoveryCode,
        newPassword,
      });
      setMessage(res.message || t('auth.resetSuccess'));
      setTimeout(() => navigate('/login'), 1600);
    } catch (err: any) {
      setError(err.message || t('auth.resetFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout title={t('auth.resetPassword')} subtitle={t('auth.resetSubtitle')}>
      {message ? (
        <div
          style={{
            background: 'var(--tt-success-soft)',
            border: '1px solid rgba(74,124,89,0.25)',
            color: 'var(--tt-success)',
            padding: '12px 14px',
            borderRadius: 'var(--tt-radius-sm)',
            fontSize: 14,
          }}
        >
          {message}
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && <div className="auth-error">{error}</div>}

          <p style={{ fontSize: 13, color: 'var(--tt-text-muted)', lineHeight: 1.5, margin: 0 }}>
            {t('auth.recoveryResetHelp')}
          </p>

          <div className="auth-field">
            <label htmlFor="forgot-email">{t('auth.email')}</label>
            <input
              id="forgot-email"
              className="tt-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="auth-field">
            <label htmlFor="forgot-code">{t('auth.recoveryCode')}</label>
            <input
              id="forgot-code"
              className="tt-input"
              type="text"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              required
              placeholder="A1B2C-D3E4F"
              autoComplete="one-time-code"
              style={{ fontFamily: 'ui-monospace, monospace', letterSpacing: '0.04em' }}
            />
          </div>

          <div className="auth-field">
            <label htmlFor="forgot-new">{t('auth.newPassword')}</label>
            <input
              id="forgot-new"
              className="tt-input"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </div>

          <div className="auth-field">
            <label htmlFor="forgot-confirm">{t('auth.confirmPassword')}</label>
            <input
              id="forgot-confirm"
              className="tt-input"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </div>

          <button
            type="submit"
            className="tt-btn tt-btn-primary"
            disabled={isSubmitting}
            style={{ width: '100%', opacity: isSubmitting ? 0.75 : 1 }}
          >
            {isSubmitting ? t('auth.resetting') : t('auth.resetWithCode')}
          </button>
        </form>
      )}

      <AuthFooterLink to="/login">{t('auth.backToSignIn')}</AuthFooterLink>
    </AuthLayout>
  );
};

import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useI18n } from '@/contexts/I18nContext';
import { AuthLayout, AuthFooterLink } from '@/components/AuthLayout';

export const ResetPassword: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { t } = useI18n();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError(t('auth.passwordHint'));
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await api.post('/api/auth/reset-password', { token, password });
      setMessage(res.message || 'Password has been reset.');
    } catch (err: any) {
      setError(err.message || 'Invalid or expired reset link');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!token) {
    return (
      <AuthLayout title={t('auth.invalidLink')} subtitle={t('auth.invalidLinkSub')}>
        <div className="auth-error">{t('auth.invalidLinkSub')}</div>
        <AuthFooterLink to="/forgot-password">{t('auth.requestNewLink')}</AuthFooterLink>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t('auth.setNewPassword')} subtitle={t('auth.setNewPasswordSubtitle')}>
      {message ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{
            background: 'var(--tt-success-soft)',
            border: '1px solid rgba(74,124,89,0.25)',
            color: 'var(--tt-success)',
            padding: '12px 14px',
            borderRadius: 'var(--tt-radius-sm)',
            fontSize: 14,
          }}>
            {message}
          </div>
          <AuthFooterLink to="/login">{t('auth.signInNewPassword')}</AuthFooterLink>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {error && <div className="auth-error">{error}</div>}

          <div className="auth-field">
            <label htmlFor="reset-password">{t('auth.newPassword')}</label>
            <input id="reset-password" className="tt-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>

          <div className="auth-field">
            <label htmlFor="reset-confirm">{t('auth.confirmPassword')}</label>
            <input id="reset-confirm" className="tt-input" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
          </div>

          <button type="submit" className="tt-btn tt-btn-primary" disabled={isSubmitting} style={{ width: '100%', opacity: isSubmitting ? 0.75 : 1 }}>
            {isSubmitting ? t('auth.saving') : t('auth.updatePassword')}
          </button>

          <p className="auth-footer">
            <Link to="/login">{t('auth.backToSignIn')}</Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
};

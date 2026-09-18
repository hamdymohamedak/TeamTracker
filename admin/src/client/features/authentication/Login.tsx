import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/contexts/I18nContext';
import { AuthLayout, AuthFooterLink } from '@/components/AuthLayout';

export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const { t } = useI18n();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await login(email, password);
      navigate('/');
    } catch (err: any) {
      setError(err.message || t('auth.loginFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout title={t('auth.signIn')} subtitle={t('auth.signInSubtitle')}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && <div className="auth-error">{error}</div>}

        <div className="auth-field">
          <label htmlFor="login-email">{t('auth.email')}</label>
          <input
            id="login-email"
            className="tt-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            required
            autoComplete="email"
          />
        </div>

        <div className="auth-field">
          <label htmlFor="login-password">{t('auth.password')}</label>
          <input
            id="login-password"
            className="tt-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            autoComplete="current-password"
          />
          <span style={{ fontSize: 12, color: 'var(--tt-text-faint)' }}>{t('auth.passwordHint')}</span>
        </div>

        <button
          type="submit"
          className="tt-btn tt-btn-primary"
          disabled={isSubmitting}
          style={{ width: '100%', opacity: isSubmitting ? 0.75 : 1, marginTop: 4 }}
        >
          {isSubmitting ? t('auth.signingIn') : t('auth.signIn')}
        </button>

        <AuthFooterLink to="/forgot-password">{t('auth.forgotPassword')}</AuthFooterLink>
        <AuthFooterLink to="/signup" preface={t('auth.noAccount')}>{t('auth.createOne')}</AuthFooterLink>
      </form>
    </AuthLayout>
  );
};

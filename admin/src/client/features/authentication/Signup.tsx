import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/contexts/I18nContext';
import { AuthLayout, AuthFooterLink } from '@/components/AuthLayout';
import { RecoveryCodesPanel } from '@/components/RecoveryCodesPanel';

export const Signup: React.FC = () => {
  const [orgName, setOrgName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const { signup } = useAuth();
  const navigate = useNavigate();
  const { t } = useI18n();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const codes = await signup(email, password, name, orgName);
      if (codes?.length) {
        setRecoveryCodes(codes);
      } else {
        navigate('/');
      }
    } catch (err: any) {
      setError(err.message || t('auth.signupFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (recoveryCodes) {
    return (
      <AuthLayout title={t('auth.recoveryCodesTitle')} subtitle={t('auth.recoveryCodesSubtitle')}>
        <RecoveryCodesPanel codes={recoveryCodes} onContinue={() => navigate('/')} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t('auth.createAccount')}
      subtitle={t('auth.createAccountSubtitle')}
      brandSub={t('auth.brandStart')}
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && <div className="auth-error">{error}</div>}

        <div className="auth-field">
          <label htmlFor="signup-org">{t('auth.orgName')}</label>
          <input id="signup-org" className="tt-input" type="text" value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
        </div>

        <div className="auth-field">
          <label htmlFor="signup-name">{t('auth.yourName')}</label>
          <input id="signup-name" className="tt-input" type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>

        <div className="auth-field">
          <label htmlFor="signup-email">{t('auth.email')}</label>
          <input id="signup-email" className="tt-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </div>

        <div className="auth-field">
          <label htmlFor="signup-password">{t('auth.password')}</label>
          <input id="signup-password" className="tt-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete="new-password" />
          <span style={{ fontSize: 12, color: 'var(--tt-text-faint)' }}>{t('auth.passwordHint')}</span>
        </div>

        <button type="submit" className="tt-btn tt-btn-primary" disabled={isSubmitting} style={{ width: '100%', opacity: isSubmitting ? 0.75 : 1, marginTop: 4 }}>
          {isSubmitting ? t('auth.creating') : t('auth.createAccount')}
        </button>

        <AuthFooterLink to="/login" preface={t('auth.hasAccount')}>{t('auth.signIn')}</AuthFooterLink>
      </form>
    </AuthLayout>
  );
};

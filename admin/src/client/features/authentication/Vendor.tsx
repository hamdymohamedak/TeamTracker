import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '@/contexts/I18nContext';
import { AuthLayout, AuthFooterLink } from '@/components/AuthLayout';
import { RecoveryCodesPanel } from '@/components/RecoveryCodesPanel';

const SECRET_KEY = 'tt_vendor_secret';

type VendorStatus = { configured: boolean };

type ProvisionResult = {
  org: { id: string; name: string; slug: string; timezone: string };
  user: { id: string; email: string; name: string; role: string };
  password: string;
  recoveryCodes: string[];
  loginUrl: string;
};

export const Vendor: React.FC = () => {
  const { t } = useI18n();
  const [status, setStatus] = useState<VendorStatus | null>(null);
  const [secret, setSecret] = useState(() => sessionStorage.getItem(SECRET_KEY) || '');
  const [unlocked, setUnlocked] = useState(() => !!sessionStorage.getItem(SECRET_KEY));
  const [unlockError, setUnlockError] = useState('');

  const [orgName, setOrgName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  );
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<ProvisionResult | null>(null);
  const [copiedCreds, setCopiedCreds] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/vendor/status')
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setStatus(json.data || { configured: false });
      })
      .catch(() => {
        if (!cancelled) setStatus({ configured: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    setUnlockError('');
    const trimmed = secret.trim();
    if (trimmed.length < 16) {
      setUnlockError(t('vendor.secretTooShort'));
      return;
    }
    sessionStorage.setItem(SECRET_KEY, trimmed);
    setSecret(trimmed);
    setUnlocked(true);
  };

  const handleLock = () => {
    sessionStorage.removeItem(SECRET_KEY);
    setSecret('');
    setUnlocked(false);
    setResult(null);
  };

  const handleProvision = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    setResult(null);

    try {
      const res = await fetch('/api/vendor/provision-org', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Vendor-Secret': secret,
        },
        body: JSON.stringify({
          orgName: orgName.trim(),
          name: name.trim(),
          email: email.trim(),
          password: password.trim() || undefined,
          timezone: timezone.trim() || undefined,
          vendorSecret: secret,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        if (res.status === 401) {
          handleLock();
          setUnlockError(t('vendor.invalidSecret'));
          throw new Error(t('vendor.invalidSecret'));
        }
        throw new Error(json.error || t('vendor.provisionFailed'));
      }
      setResult(json.data as ProvisionResult);
      setOrgName('');
      setName('');
      setEmail('');
      setPassword('');
    } catch (err: any) {
      setError(err.message || t('vendor.provisionFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyCredentials = async () => {
    if (!result) return;
    const text = [
      `Organization: ${result.org.name}`,
      `Login: ${window.location.origin}/login`,
      `Email: ${result.user.email}`,
      `Password: ${result.password}`,
      '',
      'Recovery codes:',
      ...result.recoveryCodes,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCreds(true);
      setTimeout(() => setCopiedCreds(false), 2000);
    } catch {
      /* ignore */
    }
  };

  if (status === null) {
    return (
      <AuthLayout title={t('vendor.title')} subtitle={t('common.loading')}>
        <div className="app-spinner" style={{ margin: '24px auto' }} />
      </AuthLayout>
    );
  }

  if (!status.configured) {
    return (
      <AuthLayout title={t('vendor.title')} subtitle={t('vendor.notConfigured')}>
        <p style={{ fontSize: 14, color: 'var(--tt-text-muted)', lineHeight: 1.5 }}>
          {t('vendor.notConfiguredHint')}
        </p>
        <AuthFooterLink to="/login">{t('auth.signIn')}</AuthFooterLink>
      </AuthLayout>
    );
  }

  if (!unlocked) {
    return (
      <AuthLayout title={t('vendor.title')} subtitle={t('vendor.unlockSubtitle')}>
        <form onSubmit={handleUnlock} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {unlockError && <div className="auth-error">{unlockError}</div>}
          <div className="auth-field">
            <label htmlFor="vendor-secret">{t('vendor.secret')}</label>
            <input
              id="vendor-secret"
              className="tt-input"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="••••••••••••••••"
              required
              autoComplete="off"
              autoFocus
            />
          </div>
          <button type="submit" className="tt-btn tt-btn-primary" style={{ width: '100%' }}>
            {t('vendor.unlock')}
          </button>
        </form>
        <AuthFooterLink to="/login">{t('auth.signIn')}</AuthFooterLink>
      </AuthLayout>
    );
  }

  if (result) {
    return (
      <AuthLayout title={t('vendor.successTitle')} subtitle={t('vendor.successSubtitle')}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            padding: '12px 14px',
            background: 'var(--tt-surface-2, rgba(0,0,0,0.04))',
            borderRadius: 'var(--tt-radius-sm)',
            fontSize: 14,
            lineHeight: 1.55,
          }}
        >
          <div>
            <strong>{t('auth.orgName')}:</strong> {result.org.name}
          </div>
          <div>
            <strong>{t('auth.email')}:</strong> {result.user.email}
          </div>
          <div>
            <strong>{t('auth.password')}:</strong>{' '}
            <code style={{ userSelect: 'all' }}>{result.password}</code>
          </div>
        </div>
        <button type="button" className="tt-btn tt-btn-secondary" onClick={() => void copyCredentials()}>
          {copiedCreds ? t('auth.copied') : t('vendor.copyCredentials')}
        </button>
        <RecoveryCodesPanel
          codes={result.recoveryCodes}
          onContinue={() => setResult(null)}
          continueLabel={t('vendor.provisionAnother')}
        />
        <p className="auth-footer">
          <Link to="/login">{t('auth.signIn')}</Link>
          {' · '}
          <button
            type="button"
            onClick={handleLock}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--tt-accent)',
              cursor: 'pointer',
              padding: 0,
              font: 'inherit',
            }}
          >
            {t('vendor.lock')}
          </button>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t('vendor.title')} subtitle={t('vendor.formSubtitle')}>
      <form onSubmit={handleProvision} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && <div className="auth-error">{error}</div>}

        <div className="auth-field">
          <label htmlFor="vendor-org">{t('auth.orgName')}</label>
          <input
            id="vendor-org"
            className="tt-input"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            required
            autoComplete="organization"
          />
        </div>

        <div className="auth-field">
          <label htmlFor="vendor-name">{t('auth.yourName')}</label>
          <input
            id="vendor-name"
            className="tt-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
          />
        </div>

        <div className="auth-field">
          <label htmlFor="vendor-email">{t('auth.email')}</label>
          <input
            id="vendor-email"
            className="tt-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>

        <div className="auth-field">
          <label htmlFor="vendor-password">{t('vendor.passwordOptional')}</label>
          <input
            id="vendor-password"
            className="tt-input"
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('vendor.passwordPlaceholder')}
            autoComplete="off"
          />
          <span style={{ fontSize: 12, color: 'var(--tt-text-faint)' }}>{t('vendor.passwordHint')}</span>
        </div>

        <div className="auth-field">
          <label htmlFor="vendor-tz">{t('vendor.timezone')}</label>
          <input
            id="vendor-tz"
            className="tt-input"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="Africa/Cairo"
            autoComplete="off"
          />
        </div>

        <button
          type="submit"
          className="tt-btn tt-btn-primary"
          disabled={isSubmitting}
          style={{ width: '100%', opacity: isSubmitting ? 0.75 : 1 }}
        >
          {isSubmitting ? t('vendor.provisioning') : t('vendor.provision')}
        </button>
      </form>
      <p className="auth-footer">
        <button
          type="button"
          onClick={handleLock}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--tt-accent)',
            cursor: 'pointer',
            padding: 0,
            font: 'inherit',
          }}
        >
          {t('vendor.lock')}
        </button>
      </p>
    </AuthLayout>
  );
};

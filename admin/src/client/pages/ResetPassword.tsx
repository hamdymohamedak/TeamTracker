import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { AuthLayout, AuthFooterLink } from '../components/AuthLayout';

export const ResetPassword: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
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
      <AuthLayout title="Invalid link" subtitle="This reset link is missing a token.">
        <div className="auth-error">Invalid reset link. No token provided.</div>
        <AuthFooterLink to="/forgot-password">Request a new reset link</AuthFooterLink>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Set new password" subtitle="Choose something strong and memorable.">
      {message ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{
            background: 'var(--tt-success-soft)',
            border: '1px solid rgba(31,169,113,0.25)',
            color: 'var(--tt-success)',
            padding: '12px 14px',
            borderRadius: 'var(--tt-radius-sm)',
            fontSize: 14,
          }}>
            {message}
          </div>
          <AuthFooterLink to="/login">Sign in with your new password</AuthFooterLink>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {error && <div className="auth-error">{error}</div>}

          <div className="auth-field">
            <label htmlFor="reset-password">New password</label>
            <input id="reset-password" className="tt-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" required />
          </div>

          <div className="auth-field">
            <label htmlFor="reset-confirm">Confirm password</label>
            <input id="reset-confirm" className="tt-input" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Type it again" required />
          </div>

          <button type="submit" className="tt-btn tt-btn-primary" disabled={isSubmitting} style={{ width: '100%', opacity: isSubmitting ? 0.75 : 1 }}>
            {isSubmitting ? 'Saving…' : 'Update password'}
          </button>

          <p className="auth-footer">
            <Link to="/login">Back to sign in</Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
};

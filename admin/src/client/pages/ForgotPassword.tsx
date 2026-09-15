import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { AuthLayout, AuthFooterLink } from '../components/AuthLayout';

export const ForgotPassword: React.FC = () => {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [resetUrl, setResetUrl] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setResetUrl('');
    setIsSubmitting(true);

    try {
      const res = await api.post('/api/auth/forgot-password', { email });
      setMessage(res.message || 'Check your email for a reset link.');
      if (res.resetUrl) setResetUrl(res.resetUrl);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout title="Reset password" subtitle="We’ll send a secure link to your inbox.">
      {!message ? (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {error && <div className="auth-error">{error}</div>}

          <div className="auth-field">
            <label htmlFor="forgot-email">Email</label>
            <input
              id="forgot-email"
              className="tt-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
            />
          </div>

          <button type="submit" className="tt-btn tt-btn-primary" disabled={isSubmitting} style={{ width: '100%', opacity: isSubmitting ? 0.75 : 1 }}>
            {isSubmitting ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      ) : (
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
          {resetUrl && (
            <div className="tt-card" style={{ padding: 14 }}>
              <p style={{ margin: '0 0 8px', fontWeight: 650, fontSize: 13 }}>Your reset link</p>
              <Link to={resetUrl} style={{ fontWeight: 650 }}>Click here to reset your password</Link>
            </div>
          )}
        </div>
      )}

      <AuthFooterLink to="/login">Back to sign in</AuthFooterLink>
    </AuthLayout>
  );
};

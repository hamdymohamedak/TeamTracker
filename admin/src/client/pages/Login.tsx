import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { AuthLayout, AuthFooterLink } from '../components/AuthLayout';

export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await login(email, password);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout title="Sign in" subtitle="Access your team’s live productivity signal.">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && <div className="auth-error">{error}</div>}

        <div className="auth-field">
          <label htmlFor="login-email">Email</label>
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
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            className="tt-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            required
            autoComplete="current-password"
          />
          <span style={{ fontSize: 12, color: 'var(--tt-text-faint)' }}>Minimum 6 characters</span>
        </div>

        <button
          type="submit"
          className="tt-btn tt-btn-primary"
          disabled={isSubmitting}
          style={{ width: '100%', opacity: isSubmitting ? 0.75 : 1, marginTop: 4 }}
        >
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>

        <AuthFooterLink to="/forgot-password">Forgot password?</AuthFooterLink>
        <AuthFooterLink to="/signup" preface="Don't have an account?">Create one</AuthFooterLink>
      </form>
    </AuthLayout>
  );
};

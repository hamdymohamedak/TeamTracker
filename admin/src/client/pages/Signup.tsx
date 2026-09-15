import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { AuthLayout, AuthFooterLink } from '../components/AuthLayout';

export const Signup: React.FC = () => {
  const [orgName, setOrgName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { signup } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await signup(email, password, name, orgName);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Signup failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Create account"
      subtitle="Spin up your org console in under a minute."
      brandSub="Start tracking with clarity"
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && <div className="auth-error">{error}</div>}

        <div className="auth-field">
          <label htmlFor="signup-org">Organization name</label>
          <input id="signup-org" className="tt-input" type="text" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Your Company" required />
        </div>

        <div className="auth-field">
          <label htmlFor="signup-name">Your name</label>
          <input id="signup-name" className="tt-input" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="John Smith" required />
        </div>

        <div className="auth-field">
          <label htmlFor="signup-email">Email</label>
          <input id="signup-email" className="tt-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required autoComplete="email" />
        </div>

        <div className="auth-field">
          <label htmlFor="signup-password">Password</label>
          <input id="signup-password" className="tt-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Choose a password" required minLength={6} autoComplete="new-password" />
          <span style={{ fontSize: 12, color: 'var(--tt-text-faint)' }}>Minimum 6 characters</span>
        </div>

        <button type="submit" className="tt-btn tt-btn-primary" disabled={isSubmitting} style={{ width: '100%', opacity: isSubmitting ? 0.75 : 1, marginTop: 4 }}>
          {isSubmitting ? 'Creating account…' : 'Create account'}
        </button>

        <AuthFooterLink to="/login" preface="Already have an account?">Sign in</AuthFooterLink>
      </form>
    </AuthLayout>
  );
};

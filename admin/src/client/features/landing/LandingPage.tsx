import React, { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  Activity,
  Eye,
  Shield,
  Server,
  WifiOff,
  HardDrive,
  Headphones,
} from 'lucide-react';
import { LanguageSwitcher, useI18n } from '@/contexts/I18nContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  contactHref,
  fetchRegistrationPolicy,
  type RegistrationPolicy,
} from '@/lib/publicContact';
import './landing.css';

const CAPABILITIES = [
  { icon: Activity, titleKey: 'landing.featLiveTitle' as const, bodyKey: 'landing.featLiveBody' as const },
  { icon: Eye, titleKey: 'landing.featLiveViewTitle' as const, bodyKey: 'landing.featLiveViewBody' as const },
  { icon: Shield, titleKey: 'landing.featPrivacyTitle' as const, bodyKey: 'landing.featPrivacyBody' as const },
];

const SELF_HOST_POINTS = [
  { icon: HardDrive, titleKey: 'landing.selfPointDataTitle' as const, bodyKey: 'landing.selfPointDataBody' as const },
  { icon: WifiOff, titleKey: 'landing.selfPointNetTitle' as const, bodyKey: 'landing.selfPointNetBody' as const },
  { icon: Headphones, titleKey: 'landing.selfPointOpsTitle' as const, bodyKey: 'landing.selfPointOpsBody' as const },
];

export const LandingPage: React.FC = () => {
  const { t, locale } = useI18n();
  const { isAuthenticated, isLoading } = useAuth();
  const [policy, setPolicy] = useState<RegistrationPolicy | null>(null);

  useEffect(() => {
    document.documentElement.lang = locale === 'ar' ? 'ar' : 'en';
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);

  useEffect(() => {
    let cancelled = false;
    void fetchRegistrationPolicy().then((p) => {
      if (!cancelled) setPolicy(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (isLoading) {
    return (
      <div className="app-loading">
        <div className="app-loading-inner">
          <div className="app-spinner" />
          <p>{t('shell.loadingWorkspace')}</p>
        </div>
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  const href = contactHref(policy?.contactEmail, policy?.contactUrl);
  const contactLabel = policy?.contactEmail || t('landing.ctaContact');

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <Link to="/" className="lp-brand" aria-label="TeamTracker">
            <span className="lp-brand-mark">T</span>
            <span className="lp-brand-name">TeamTracker</span>
          </Link>
          <div className="lp-nav-actions">
            <LanguageSwitcher variant="auth" />
            <a className="lp-link" href="#self-host">
              {t('landing.navSelfHost')}
            </a>
            <a className="lp-link" href={href}>
              {t('landing.navContact')}
            </a>
            <Link to="/login" className="lp-btn lp-btn-solid">
              {t('landing.navLogin')}
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="lp-hero" aria-labelledby="lp-hero-title">
          <div className="lp-hero-bg" aria-hidden />
          <div className="lp-hero-grid" aria-hidden />
          <div className="lp-hero-inner">
            <p className="lp-kicker lp-anim lp-anim-1">{t('landing.kicker')}</p>
            <h1 id="lp-hero-title" className="lp-title lp-anim lp-anim-2">
              TeamTracker
            </h1>
            <p className="lp-headline lp-anim lp-anim-3">{t('landing.headline')}</p>
            <p className="lp-lead lp-anim lp-anim-4">{t('landing.lead')}</p>
            <div className="lp-cta lp-anim lp-anim-5">
              <Link to="/login" className="lp-btn lp-btn-solid lp-btn-lg">
                {t('landing.ctaLogin')}
              </Link>
              <a className="lp-btn lp-btn-ghost lp-btn-lg" href={href}>
                {t('landing.ctaContact')}
              </a>
            </div>
            <p className="lp-invite-note lp-anim lp-anim-5">{t('landing.inviteOnly')}</p>
          </div>
        </section>

        <section id="self-host" className="lp-self" aria-labelledby="lp-self-title">
          <div className="lp-section-inner">
            <div className="lp-self-badge">
              <Server size={16} strokeWidth={2.2} aria-hidden />
              {t('landing.selfBadge')}
            </div>
            <h2 id="lp-self-title" className="lp-self-title">
              {t('landing.selfTitle')}
            </h2>
            <p className="lp-self-lead">{t('landing.selfLead')}</p>
            <ul className="lp-self-points">
              {SELF_HOST_POINTS.map(({ icon: Icon, titleKey, bodyKey }) => (
                <li key={titleKey}>
                  <div className="lp-self-icon">
                    <Icon size={18} strokeWidth={2.1} aria-hidden />
                  </div>
                  <div>
                    <h3>{t(titleKey)}</h3>
                    <p>{t(bodyKey)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lp-section" aria-labelledby="lp-features-title">
          <div className="lp-section-inner">
            <h2 id="lp-features-title" className="lp-section-title">
              {t('landing.featuresTitle')}
            </h2>
            <p className="lp-section-lead">{t('landing.featuresLead')}</p>
            <ul className="lp-features">
              {CAPABILITIES.map(({ icon: Icon, titleKey, bodyKey }) => (
                <li key={titleKey} className="lp-feature">
                  <div className="lp-feature-icon">
                    <Icon size={18} strokeWidth={2.1} aria-hidden />
                  </div>
                  <h3>{t(titleKey)}</h3>
                  <p>{t(bodyKey)}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lp-section lp-section-cta" aria-labelledby="lp-final-title">
          <div className="lp-section-inner lp-final">
            <h2 id="lp-final-title">{t('landing.finalTitle')}</h2>
            <p>{t('landing.finalLead')}</p>
            <div className="lp-cta">
              <a className="lp-btn lp-btn-solid lp-btn-lg" href={href}>
                {contactLabel}
              </a>
              <Link to="/login" className="lp-btn lp-btn-ghost lp-btn-lg">
                {t('landing.ctaLogin')}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <span>TeamTracker</span>
        <a href={href}>{t('landing.navContact')}</a>
        <a href="https://github.com/hamdymohamedak/TeamTracker/releases" target="_blank" rel="noopener noreferrer">
          {t('landing.navDownload')}
        </a>
      </footer>
    </div>
  );
};

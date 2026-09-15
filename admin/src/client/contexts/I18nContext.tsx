import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { dictionaries, type Locale, type TranslationKey } from '../i18n/translations';

const STORAGE_KEY = 'teamtracker_locale';

type I18nContextValue = {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function detectInitialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ar' || saved === 'en') return saved;
  } catch { /* ignore */ }
  const nav = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : 'en';
  return nav.startsWith('ar') ? 'ar' : 'en';
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    vars[key] !== undefined ? String(vars[key]) : `{${key}}`
  );
}

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<Locale>(detectInitialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);

  // Keep layout LTR always — Arabic only swaps copy, not direction.
  const dir: 'ltr' | 'rtl' = 'ltr';

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = 'ltr';
    document.body.dir = 'ltr';
  }, [locale]);

  const t = useCallback((key: TranslationKey, vars?: Record<string, string | number>) => {
    const dict = dictionaries[locale] || dictionaries.en;
    const value = dict[key] ?? dictionaries.en[key] ?? key;
    return interpolate(value, vars);
  }, [locale]);

  const value = useMemo(() => ({ locale, dir, setLocale, t }), [locale, dir, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}

export const LanguageSwitcher: React.FC<{ compact?: boolean; variant?: 'sidebar' | 'auth' | 'inline' }> = ({
  compact = false,
  variant = 'inline',
}) => {
  const { locale, setLocale, t } = useI18n();

  if (variant === 'sidebar') {
    return (
      <div className="lang-switcher lang-switcher--sidebar" role="group" aria-label={t('common.language')}>
        <button
          type="button"
          className={`lang-btn ${locale === 'en' ? 'active' : ''}`}
          onClick={() => setLocale('en')}
        >
          EN
        </button>
        <button
          type="button"
          className={`lang-btn ${locale === 'ar' ? 'active' : ''}`}
          onClick={() => setLocale('ar')}
        >
          ع
        </button>
      </div>
    );
  }

  if (variant === 'auth') {
    return (
      <div className="lang-switcher lang-switcher--auth" role="group" aria-label={t('common.language')}>
        <button type="button" className={`lang-btn ${locale === 'en' ? 'active' : ''}`} onClick={() => setLocale('en')}>
          {t('common.english')}
        </button>
        <button type="button" className={`lang-btn ${locale === 'ar' ? 'active' : ''}`} onClick={() => setLocale('ar')}>
          {t('common.arabic')}
        </button>
      </div>
    );
  }

  return (
    <select
      className="tt-input"
      style={{ width: compact ? 110 : 140, padding: '8px 10px' }}
      value={locale}
      onChange={e => setLocale(e.target.value as Locale)}
      aria-label={t('common.language')}
    >
      <option value="en">{t('common.english')}</option>
      <option value="ar">{t('common.arabic')}</option>
    </select>
  );
};

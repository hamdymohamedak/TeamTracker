import React, { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { SUPPORTED_CURRENCIES } from '../../../shared-types';
import { useI18n } from '../contexts/I18nContext';

// Small IANA timezone picker — mirrors the list in Employees.tsx.
const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Amsterdam',
  'Europe/Istanbul',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Riyadh',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Pacific/Auckland'
];

interface Props {
  onClose: () => void;
}

const MAX_LOGO_BYTES = 1_000_000;
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

export const OrgSettingsModal: React.FC<Props> = ({ onClose }) => {
  const { t } = useI18n();
  const { org, updateOrg } = useAuth();
  const [name, setName] = useState(org?.name || '');
  const [timezone, setTimezone] = useState(org?.timezone || 'UTC');
  const [defaultCurrency, setDefaultCurrency] = useState(org?.defaultCurrency || 'USD');
  const [logoUrl, setLogoUrl] = useState<string | null>(org?.logoUrl || null);

  // Daily summary settings — fetched from /api/organization on mount.
  const [dailySummaryEnabled, setDailySummaryEnabled] = useState(false);
  const [dailySummaryRecipient, setDailySummaryRecipient] = useState('');
  const [dailySummaryHour, setDailySummaryHour] = useState(18);
  const [sendingTestSummary, setSendingTestSummary] = useState(false);

  // Screenshot settings
  const [screenshotsEnabled, setScreenshotsEnabled] = useState(false);
  const [screenshotIntervalMinutes, setScreenshotIntervalMinutes] = useState(10);
  const [screenshotRetentionDays, setScreenshotRetentionDays] = useState(7);

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pull the current settings from the server on mount so the toggles
  // show the real persisted state, not stale defaults from AuthContext.
  useEffect(() => {
    let cancelled = false;
    api.get('/api/organization').then(res => {
      if (cancelled || !res?.success) return;
      const d = res.data;
      setName(d.name);
      setTimezone(d.timezone || 'UTC');
      setDefaultCurrency(d.defaultCurrency || 'USD');
      setLogoUrl(d.logoUrl || null);
      setDailySummaryEnabled(!!d.dailySummaryEnabled);
      setDailySummaryRecipient(d.dailySummaryRecipient || '');
      setDailySummaryHour(typeof d.dailySummaryHour === 'number' ? d.dailySummaryHour : 18);
      setScreenshotsEnabled(!!d.screenshotsEnabled);
      setScreenshotIntervalMinutes(typeof d.screenshotIntervalMinutes === 'number' ? d.screenshotIntervalMinutes : 10);
      setScreenshotRetentionDays(typeof d.screenshotRetentionDays === 'number' ? d.screenshotRetentionDays : 7);
    }).catch(() => { /* keep AuthContext defaults */ });
    return () => { cancelled = true; };
  }, []);

  // Reset the error whenever the user changes anything meaningful.
  useEffect(() => { setError(null); }, [name, timezone, defaultCurrency, logoUrl, dailySummaryEnabled, dailySummaryRecipient, dailySummaryHour, screenshotsEnabled, screenshotIntervalMinutes, screenshotRetentionDays]);

  // Auto-clear the success flash after 1.5s so it doesn't linger.
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1500);
    return () => clearTimeout(t);
  }, [flash]);

  // Close the modal when the user clicks backdrop or Cancel. Reusable so
  // the Save path can also trigger it.
  const closeModal = useCallback(() => onClose(), [onClose]);

  const handleSaveSettings = async () => {
    setError(null);
    setSaving(true);
    try {
      const res = await api.put('/api/organization', {
        name,
        timezone,
        defaultCurrency,
        dailySummaryEnabled,
        dailySummaryRecipient,
        dailySummaryHour,
        screenshotsEnabled,
        screenshotIntervalMinutes,
        screenshotRetentionDays
      });
      if (!res.success) throw new Error(res.error || 'Save failed');
      updateOrg({ name: res.data.name, timezone: res.data.timezone, defaultCurrency: res.data.defaultCurrency });
      closeModal();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleSendTestSummary = async () => {
    setError(null);
    setSendingTestSummary(true);
    try {
      const res = await api.post('/api/reports/daily-summary/send', {});
      if (!res.success) throw new Error(res.error || 'Send failed');
      if (res.sent) {
        setFlash(`Test summary sent to ${res.recipient}`);
      } else {
        setError(res.reason || 'Could not send the test summary.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSendingTestSummary(false);
    }
  };

  const handleLogoPick = () => fileInputRef.current?.click();

  const handleLogoUpload = async (file: File) => {
    setError(null);
    if (!ALLOWED_MIME.includes(file.type)) {
      setError('Logo must be PNG, JPEG, WebP, or SVG.');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError(`Logo must be under ${MAX_LOGO_BYTES / 1000} KB.`);
      return;
    }
    setUploading(true);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1] || '');
        reader.onerror = () => reject(new Error('Could not read file'));
        reader.readAsDataURL(file);
      });
      const res = await api.post('/api/organization/logo', { mimeType: file.type, dataBase64 });
      if (!res.success) throw new Error(res.error || 'Logo upload failed');
      setLogoUrl(res.data.logoUrl);
      updateOrg({ logoUrl: res.data.logoUrl });
      setFlash('Logo uploaded');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const handleLogoRemove = async () => {
    setError(null);
    setUploading(true);
    try {
      const res = await api.delete('/api/organization/logo');
      if (!res.success) throw new Error(res.error || 'Logo removal failed');
      setLogoUrl(null);
      updateOrg({ logoUrl: null });
      setFlash('Logo removed');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      className="tt-modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={closeModal}
    >
      <div
        className="tt-modal tt-modal--md"
        onClick={e => e.stopPropagation()}
      >
        <div className="tt-modal-header">
          <h2 className="tt-modal-title">{t('org.title')}</h2>
          <button type="button" className="tt-modal-close" onClick={closeModal} aria-label={t('common.close')}>✕</button>
        </div>

        <div className="tt-modal-body">
        {error && (
          <div style={{
            backgroundColor: 'var(--tt-danger-soft)',
            border: '1px solid rgba(232, 93, 76, 0.25)',
            color: 'var(--tt-danger)',
            padding: '10px 12px',
            borderRadius: '6px',
            marginBottom: '12px',
            fontSize: '13px'
          }}>
            ⚠️ {error}
          </div>
        )}

        {flash && !error && (
          <div style={{
            backgroundColor: 'var(--tt-success-soft)',
            border: '1px solid rgba(31, 169, 113, 0.25)',
            color: 'var(--tt-success)',
            padding: '10px 12px',
            borderRadius: '6px',
            marginBottom: '12px',
            fontSize: '13px',
            fontWeight: 500
          }}>
            ✅ {flash}
          </div>
        )}

        {/* Logo section */}
        <section style={{ marginBottom: '24px' }}>
          <div style={labelStyle}>Company Logo</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <div style={{
              width: '80px',
              height: '80px',
              borderRadius: 'var(--tt-radius)',
              backgroundColor: 'var(--tt-surface-muted)',
              border: '1px dashed var(--tt-border-strong)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden'
            }}>
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt="Logo preview"
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                />
              ) : (
                <span style={{ fontSize: '11px', color: 'var(--tt-text-faint)', textAlign: 'center' as const }}>
                  No logo
                </span>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED_MIME.join(',')}
                style={{ display: 'none' }}
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) handleLogoUpload(file);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={handleLogoPick}
                disabled={uploading}
                style={primaryBtn}
              >
                {uploading ? 'Uploading…' : (logoUrl ? 'Replace Logo' : 'Upload Logo')}
              </button>
              {logoUrl && (
                <button
                  type="button"
                  onClick={handleLogoRemove}
                  disabled={uploading}
                  style={{ ...ghostBtn, marginLeft: '8px' }}
                >
                  Remove
                </button>
              )}
              <div style={{ fontSize: '11px', color: 'var(--tt-text-faint)', marginTop: '6px' }}>
                PNG, JPEG, WebP or SVG. Max {MAX_LOGO_BYTES / 1000} KB.
              </div>
            </div>
          </div>
        </section>

        <div className="tt-modal-form tt-modal-form--2col" style={{ marginBottom: 8 }}>
          <div className="tt-field tt-field-span-2">
            <div style={labelStyle}>Organization Name</div>
            <input
              type="text"
              className="tt-input"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>

          <div className="tt-field">
            <div style={labelStyle}>Default Timezone</div>
            <select
              className="tt-input"
              value={timezone}
              onChange={e => setTimezone(e.target.value)}
            >
              {COMMON_TIMEZONES.map(tz => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
            <div className="tt-field-hint">
              Used for the "today" boundary on Dashboard and Reports.
            </div>
          </div>

          <div className="tt-field">
            <div style={labelStyle}>Default Currency</div>
            <select
              className="tt-input"
              value={defaultCurrency}
              onChange={e => setDefaultCurrency(e.target.value)}
            >
              {SUPPORTED_CURRENCIES.map(c => (
                <option key={c.code} value={c.code}>{c.symbol} — {c.label} ({c.code})</option>
              ))}
            </select>
            <div className="tt-field-hint">
              New employees inherit this. Each can override.
            </div>
          </div>
        </div>

        {/* Daily Email Summary */}
        <section style={{ marginBottom: '16px', padding: '14px', backgroundColor: 'var(--tt-surface-muted)', borderRadius: 'var(--tt-radius-sm)', border: '1px solid var(--tt-border)' }}>
          <div style={{ ...labelStyle, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={dailySummaryEnabled}
              onChange={e => setDailySummaryEnabled(e.target.checked)}
              style={{ width: '16px', height: '16px' }}
            />
            <span>Daily Email Summary</span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--tt-text-muted)', marginBottom: '10px', lineHeight: 1.5 }}>
            We'll email a per-employee productivity summary once a day at the hour you pick (in your org's timezone).
          </div>
          {dailySummaryEnabled && (
            <div className="tt-modal-form tt-modal-form--2col">
              <div className="tt-field tt-field-span-2">
                <div style={{ fontSize: '11px', color: 'var(--tt-text-muted)', marginBottom: '4px' }}>Recipient Email</div>
                <input
                  type="email"
                  className="tt-input"
                  placeholder="you@company.com"
                  value={dailySummaryRecipient}
                  onChange={e => setDailySummaryRecipient(e.target.value)}
                />
              </div>
              <div className="tt-field tt-field-span-2">
                <div style={{ fontSize: '11px', color: 'var(--tt-text-muted)', marginBottom: '4px' }}>
                  Send each day at (org local time)
                </div>
                <select
                  className="tt-input"
                  value={dailySummaryHour}
                  onChange={e => setDailySummaryHour(parseInt(e.target.value, 10))}
                >
                  {Array.from({ length: 24 }, (_, h) => h).map(h => (
                    <option key={h} value={h}>
                      {h.toString().padStart(2, '0')}:00 ({h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`})
                    </option>
                  ))}
                </select>
              </div>
              <div className="tt-field tt-field-span-2">
                <button
                  type="button"
                  onClick={handleSendTestSummary}
                  disabled={sendingTestSummary || !dailySummaryRecipient}
                  className="tt-btn tt-btn-ghost"
                >
                  {sendingTestSummary ? 'Sending…' : 'Send a test summary now'}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Screenshots */}
        <section style={{ marginBottom: '8px', padding: '14px', backgroundColor: 'var(--tt-surface-muted)', borderRadius: 'var(--tt-radius-sm)', border: '1px solid var(--tt-border)' }}>
          <div style={{ ...labelStyle, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={screenshotsEnabled}
              onChange={e => setScreenshotsEnabled(e.target.checked)}
              style={{ width: '16px', height: '16px' }}
            />
            <span>Periodic Screenshots</span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--tt-text-muted)', marginBottom: '10px', lineHeight: 1.5 }}>
            Capture screenshots at a fixed interval. Browse them on the Screenshots page.
          </div>
          {screenshotsEnabled && (
            <div className="tt-modal-form tt-modal-form--2col">
              <div className="tt-field">
                <div style={{ fontSize: '11px', color: 'var(--tt-text-muted)', marginBottom: '4px' }}>Capture every (minutes)</div>
                <input
                  type="number"
                  className="tt-input"
                  min={1}
                  max={60}
                  value={screenshotIntervalMinutes}
                  onChange={e => setScreenshotIntervalMinutes(parseInt(e.target.value, 10) || 10)}
                />
              </div>
              <div className="tt-field">
                <div style={{ fontSize: '11px', color: 'var(--tt-text-muted)', marginBottom: '4px' }}>Keep for (days)</div>
                <input
                  type="number"
                  className="tt-input"
                  min={1}
                  max={365}
                  value={screenshotRetentionDays}
                  onChange={e => setScreenshotRetentionDays(parseInt(e.target.value, 10) || 7)}
                />
              </div>
            </div>
          )}
        </section>
        </div>

        <div className="tt-modal-footer">
          <button type="button" className="tt-btn tt-btn-ghost" onClick={closeModal}>{t('common.cancel')}</button>
          <button
            type="button"
            className="tt-btn tt-btn-primary"
            onClick={handleSaveSettings}
            disabled={saving}
          >
            {saving ? t('org.saving') : t('org.save')}
          </button>
        </div>
      </div>
    </div>
  );
};

const labelStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--tt-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  marginBottom: '6px'
};

const primaryBtn: React.CSSProperties = {
  padding: '10px 16px',
  backgroundColor: 'var(--tt-teal)',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 500
};

const ghostBtn: React.CSSProperties = {
  padding: '10px 16px',
  backgroundColor: 'var(--tt-surface-muted)',
  color: '#333',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '13px'
};

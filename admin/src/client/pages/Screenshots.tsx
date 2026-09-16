import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import type { Employee } from '../../../shared-types';
import { useI18n } from '../contexts/I18nContext';
import { useWebSocket } from '../contexts/WebSocketContext';
import { HelpTip } from '../components/HelpTip';

interface ScreenshotRow {
  id: string;
  employeeId: string;
  timestamp: string;
  fileUrl: string;
  fileSizeBytes: number;
  width?: number;
  height?: number;
  appName?: string;
  windowTitle?: string;
  createdAt: string;
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Append dashboard JWT for <img src> — browser cannot send Authorization headers. */
function authenticatedFileUrl(fileUrl: string): string {
  const token = localStorage.getItem('teamtracker_token');
  if (!token || !fileUrl) return fileUrl;
  const sep = fileUrl.includes('?') ? '&' : '?';
  return `${fileUrl}${sep}token=${encodeURIComponent(token)}`;
}

export const Screenshots: React.FC = () => {
  const { t } = useI18n();
  const { onlineEmployees, lastMessage } = useWebSocket();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState<string>('');
  const [date, setDate] = useState<string>(todayLocal());
  const [shots, setShots] = useState<ScreenshotRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState<ScreenshotRow | null>(null);
  const [taking, setTaking] = useState(false);
  const [httpOnlineIds, setHttpOnlineIds] = useState<Set<string>>(new Set());
  const pendingRequestRef = useRef<{ requestId: string; employeeId: string } | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isEmployeeOnline = useCallback((id: string) => {
    return onlineEmployees.has(id) || httpOnlineIds.has(id);
  }, [onlineEmployees, httpOnlineIds]);

  useEffect(() => {
    api.get('/api/employees').then(res => {
      if (res?.success) setEmployees(res.data);
    }).catch(() => { /* silent */ });
  }, []);

  // HTTP presence fallback — covers the case where the admin dashboard
  // connected after the tracker and missed the employee:online event.
  useEffect(() => {
    let cancelled = false;
    const refreshOnline = async () => {
      try {
        const res = await api.get('/api/employees/online');
        if (cancelled || !res?.success) return;
        const next = new Set<string>(
          (res.data || []).map((e: { employeeId: string }) => e.employeeId).filter(Boolean)
        );
        setHttpOnlineIds(next);
      } catch { /* ignore */ }
    };
    void refreshOnline();
    const id = setInterval(refreshOnline, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (employeeId) params.set('employeeId', employeeId);
      if (date) params.set('date', date);
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (tz) params.set('tz', tz);
      } catch { /* default to org tz */ }
      params.set('limit', '500');
      const res = await api.get(`/api/screenshots?${params.toString()}`);
      if (!res?.success) throw new Error(res?.error || 'Failed to load');
      setShots(res.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [employeeId, date]);

  useEffect(() => { load(); }, [load]);

  // Live refresh when a new screenshot arrives over WebSocket.
  useEffect(() => {
    if (!lastMessage || lastMessage.type !== 'screenshot:new') return;
    const data = lastMessage.data || {};
    if (employeeId && data.employeeId && data.employeeId !== employeeId) return;

    let inserted = false;
    // Optimistically show the new shot immediately (don't wait on date-filter reload).
    if (data.id && data.fileUrl) {
      const row: ScreenshotRow = {
        id: data.id,
        employeeId: data.employeeId,
        timestamp: data.timestamp || new Date().toISOString(),
        fileUrl: data.fileUrl,
        fileSizeBytes: data.fileSizeBytes || 0,
        width: data.width,
        height: data.height,
        appName: data.appName || undefined,
        windowTitle: data.windowTitle || undefined,
        createdAt: data.timestamp || new Date().toISOString(),
      };
      setShots(prev => (prev.some(s => s.id === row.id) ? prev : [row, ...prev]));
      inserted = true;
      // Align the date picker to the capture's local day so Refresh keeps it visible.
      try {
        const localDay = new Date(row.timestamp);
        const yyyy = localDay.getFullYear();
        const mm = String(localDay.getMonth() + 1).padStart(2, '0');
        const dd = String(localDay.getDate()).padStart(2, '0');
        setDate(`${yyyy}-${mm}-${dd}`);
      } catch { /* keep current date */ }
    }

    if (pendingRequestRef.current?.requestId && data.requestId === pendingRequestRef.current.requestId) {
      pendingRequestRef.current = null;
      setTaking(false);
      setFlash(null);
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }
    // If we inserted optimistically + may have changed `date`, let the date
    // change re-trigger `load`. Calling load here with a stale date wiped the grid.
    if (!inserted) void load({ silent: true });
  }, [lastMessage, employeeId, load]);

  useEffect(() => {
    if (!lastMessage || lastMessage.type !== 'screenshot:privacy-blocked') return;
    const data = lastMessage.data || {};
    if (employeeId && data.employeeId && data.employeeId !== employeeId) return;
    if (
      pendingRequestRef.current?.requestId &&
      data.requestId &&
      data.requestId !== pendingRequestRef.current.requestId
    ) {
      return;
    }
    pendingRequestRef.current = null;
    setTaking(false);
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setFlash(t('screenshots.privacyBlocked', {
      app: data.appName || data.pattern || '—',
    }));
  }, [lastMessage, employeeId, t]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  const selectedOnline = employeeId ? isEmployeeOnline(employeeId) : false;

  const handleTakeScreenshot = async () => {
    if (!employeeId) {
      setError(t('screenshots.selectEmployee'));
      return;
    }
    setError(null);
    setFlash(null);
    setTaking(true);
    try {
      const res = await api.post('/api/screenshots/request', { employeeId });
      if (!res?.success) {
        throw new Error(res?.error || t('screenshots.offline'));
      }
      // Presence may have been stale — refresh after a successful request.
      setHttpOnlineIds(prev => new Set(prev).add(employeeId));
      const requestId = res.data?.requestId as string | undefined;
      if (requestId) {
        pendingRequestRef.current = { requestId, employeeId };
      }
      setFlash(t('screenshots.requested'));
      setDate(todayLocal());

      // Poll gallery briefly while waiting for the device upload.
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      let ticks = 0;
      pollTimerRef.current = setInterval(() => {
        ticks += 1;
        void load({ silent: true });
        if (ticks >= 20) {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          setTaking(false);
          pendingRequestRef.current = null;
        }
      }, 1500);
    } catch (e) {
      setTaking(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDelete = async (s: ScreenshotRow) => {
    if (!confirm(t('screenshots.deleteConfirm'))) return;
    try {
      const res = await api.delete(`/api/screenshots/${s.id}`);
      if (!res?.success) throw new Error(res?.error || 'Delete failed');
      setShots(shots.filter(x => x.id !== s.id));
      if (zoomed?.id === s.id) setZoomed(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const fmtTime = (ts: string) => {
    try { return new Date(ts).toLocaleTimeString(); } catch { return ts; }
  };
  const fmtSize = (b: number) => {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div>
          <h1 style={{ ...styles.title, display: 'flex', alignItems: 'center', gap: 8 }}>
            {t('screenshots.title')}
            <HelpTip text={t('help.screenshots')} />
          </h1>
          <p style={styles.subtitle}>{t('screenshots.subtitle')}</p>
        </div>
      </header>

      <div style={styles.controls}>
        <select
          value={employeeId}
          onChange={e => setEmployeeId(e.target.value)}
          style={styles.select}
        >
          <option value="">{t('common.allEmployees')}</option>
          {employees.map(e => {
            const online = isEmployeeOnline(e.id);
            return (
              <option key={e.id} value={e.id}>
                {e.name} · {online ? t('screenshots.online') : t('screenshots.offlineBadge')}
              </option>
            );
          })}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--tt-text-muted)' }}>
          {t('common.date')}:
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            style={styles.dateInput}
          />
        </label>
        <button onClick={() => load()} disabled={loading} style={styles.btnGhost}>
          {loading ? t('common.loading') : t('common.refresh')}
        </button>
        <button
          onClick={handleTakeScreenshot}
          disabled={taking || !employeeId}
          style={{
            ...styles.btnPrimary,
            opacity: taking || !employeeId ? 0.55 : 1,
            cursor: taking || !employeeId ? 'not-allowed' : 'pointer',
          }}
          title={!employeeId ? t('screenshots.selectEmployee') : selectedOnline ? undefined : t('screenshots.offline')}
        >
          {taking ? t('screenshots.taking') : t('screenshots.take')}
        </button>
        {employeeId && (
          <span style={{
            fontSize: 12,
            fontWeight: 600,
            color: selectedOnline ? 'var(--tt-success)' : 'var(--tt-text-faint)',
          }}>
            {selectedOnline ? `● ${t('screenshots.online')}` : `○ ${t('screenshots.offlineBadge')}`}
          </span>
        )}
      </div>

      {flash && (
        <div style={styles.flashBanner}>{flash}</div>
      )}

      {error && (
        <div style={styles.errorBanner}>⚠️ {error}</div>
      )}

      {!loading && shots.length === 0 && (
        <div style={styles.empty}>
          <div style={{ fontSize: '40px' }}>📷</div>
          <h3 style={{ margin: '12px 0 4px', color: 'var(--tt-text)' }}>{t('screenshots.emptyTitle')}</h3>
          <p style={{ color: 'var(--tt-text-muted)', fontSize: '14px', maxWidth: '480px', margin: '0 auto', lineHeight: 1.5 }}>
            {t('screenshots.emptyHint')}
          </p>
        </div>
      )}

      <div style={styles.grid}>
        {shots.map(s => {
          const emp = employees.find(e => e.id === s.employeeId);
          return (
            <div key={s.id} style={styles.card}>
              <button
                onClick={() => setZoomed(s)}
                style={styles.thumbBtn}
                aria-label="View full size"
              >
                <img src={authenticatedFileUrl(s.fileUrl)} alt="" style={styles.thumb} loading="lazy" />
              </button>
              <div style={styles.cardBody}>
                <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--tt-text)' }}>
                  {emp?.name || s.employeeId.slice(0, 8)}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--tt-text-muted)' }}>
                  {fmtTime(s.timestamp)} · {fmtSize(s.fileSizeBytes)}
                </div>
                {s.appName && (
                  <div style={{ fontSize: '11px', color: 'var(--tt-text-faint)', marginTop: '2px' }}>
                    {s.appName}
                  </div>
                )}
                <button
                  onClick={() => handleDelete(s)}
                  style={styles.deleteBtn}
                >
                  {t('screenshots.delete')}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {zoomed && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setZoomed(null)}
          style={styles.lightbox}
        >
          <img
            src={authenticatedFileUrl(zoomed.fileUrl)}
            alt="Screenshot full size"
            style={styles.lightboxImg}
            onClick={e => e.stopPropagation()}
          />
          <div style={styles.lightboxMeta}>
            {fmtTime(zoomed.timestamp)} · {zoomed.appName || ''} · {zoomed.windowTitle || ''}
          </div>
        </div>
      )}
    </div>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  container: { padding: '32px' },
  header: { marginBottom: '20px' },
  title: { fontSize: '28px', fontWeight: 600, color: 'var(--tt-text)', margin: 0 },
  subtitle: { fontSize: '14px', color: 'var(--tt-text-muted)', margin: '4px 0 0 0' },
  controls: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' as const },
  select: { padding: '9px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px', minWidth: '220px' },
  dateInput: { padding: '8px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' },
  btnPrimary: { padding: '9px 18px', backgroundColor: 'var(--tt-teal)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 500 },
  btnGhost: { padding: '9px 18px', backgroundColor: 'var(--tt-surface)', color: 'var(--tt-text)', border: '1px solid var(--tt-border-strong)', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 500 },
  errorBanner: { backgroundColor: 'var(--tt-danger-soft)', border: '1px solid rgba(232, 93, 76, 0.25)', color: 'var(--tt-danger)', padding: '10px 12px', borderRadius: '6px', marginBottom: '12px' },
  flashBanner: { backgroundColor: 'var(--tt-success-soft)', border: '1px solid rgba(74, 124, 89, 0.25)', color: 'var(--tt-success)', padding: '10px 12px', borderRadius: '6px', marginBottom: '12px' },
  empty: { textAlign: 'center', padding: '60px 20px', backgroundColor: 'var(--tt-surface)', borderRadius: 'var(--tt-radius)', boxShadow: 'var(--tt-shadow-sm)' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px' },
  card: { backgroundColor: 'var(--tt-surface)', borderRadius: '10px', boxShadow: 'var(--tt-shadow-sm)', overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  thumbBtn: { padding: 0, border: 'none', background: 'none', cursor: 'zoom-in', display: 'block' },
  thumb: { width: '100%', height: '140px', objectFit: 'cover', display: 'block', backgroundColor: 'var(--tt-surface-muted)' },
  cardBody: { padding: '10px 12px', borderTop: '1px solid #f1f3f5' },
  deleteBtn: { marginTop: '8px', padding: '6px 10px', fontSize: '11px', backgroundColor: 'var(--tt-danger-soft)', color: 'var(--tt-danger)', border: '1px solid rgba(232, 93, 76, 0.25)', borderRadius: '4px', cursor: 'pointer', width: '100%' },
  lightbox: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: '20px' },
  lightboxImg: { maxWidth: '95%', maxHeight: '85%', borderRadius: 'var(--tt-radius-sm)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' },
  lightboxMeta: { color: '#fff', fontSize: '12px', marginTop: '12px', opacity: 0.8 }
};

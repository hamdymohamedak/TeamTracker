import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import type { Employee } from '../../../../shared-types';
import { useI18n } from '@/contexts/I18nContext';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { PageHero, PageEmpty, PagePanel } from '@/components/PageHero';
import { StatusLine } from '@/components/Icon';
import { Camera, RefreshCw, Repeat, Timer } from 'lucide-react';

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

interface AutomationSession {
  sessionId: string;
  employeeId: string;
  mode: 'fixed' | 'random';
  intervalSec?: number;
  minIntervalSec?: number;
  maxIntervalSec?: number;
  durationHours?: number;
  endsAt?: string | null;
  startedAt?: string;
}

const AUTO_INTERVAL_OPTIONS = [30, 60, 120, 300, 600, 900];
const AUTO_DURATION_HOURS = [0, 1, 2, 4, 8, 12];

function sessionsFromApi(list: unknown): Record<string, AutomationSession> {
  const next: Record<string, AutomationSession> = {};
  if (!Array.isArray(list)) return next;
  for (const s of list) {
    if (!s || typeof s !== 'object') continue;
    const row = s as AutomationSession;
    if (row.employeeId) next[row.employeeId] = row;
  }
  return next;
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
  const [delaySec, setDelaySec] = useState<number>(0);
  const [countdownLeft, setCountdownLeft] = useState<number | null>(null);
  const [httpOnlineIds, setHttpOnlineIds] = useState<Set<string>>(new Set());
  const [autoMode, setAutoMode] = useState<'fixed' | 'random'>('fixed');
  const [autoIntervalSec, setAutoIntervalSec] = useState(60);
  const [autoMinSec, setAutoMinSec] = useState(30);
  const [autoMaxSec, setAutoMaxSec] = useState(120);
  const [autoDurationHours, setAutoDurationHours] = useState(8);
  const [autoSessions, setAutoSessions] = useState<Record<string, AutomationSession>>({});
  const [autoBusy, setAutoBusy] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const pendingRequestRef = useRef<{ requestId: string; employeeId: string } | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const delayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const delayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isEmployeeOnline = useCallback((id: string) => {
    return onlineEmployees.has(id) || httpOnlineIds.has(id);
  }, [onlineEmployees, httpOnlineIds]);

  useEffect(() => {
    api.get('/api/employees').then(res => {
      if (res?.success) setEmployees(res.data);
    }).catch(() => { /* silent */ });
  }, []);

  // Restore + poll active automation sessions (survives navigation; shows all).
  const refreshAutomation = useCallback(async () => {
    try {
      const res = await api.get('/api/screenshots/automation');
      if (!res?.success) return;
      setAutoSessions(sessionsFromApi(res.data?.sessions));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void refreshAutomation();
    const id = setInterval(() => void refreshAutomation(), 5000);
    return () => clearInterval(id);
  }, [refreshAutomation]);

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
      app: data.pattern || data.windowTitle || data.appName || '—',
    }));
  }, [lastMessage, employeeId, t]);

  // Automation session sync from WebSocket + stop on employee offline.
  useEffect(() => {
    if (!lastMessage) return;
    const type = lastMessage.type as string;
    const data = lastMessage.data || {};

    if (type === 'screenshot-automation:started' && data.employeeId) {
      setAutoSessions(prev => ({
        ...prev,
        [data.employeeId]: {
          sessionId: data.sessionId,
          employeeId: data.employeeId,
          mode: data.mode === 'random' ? 'random' : 'fixed',
          intervalSec: data.intervalSec,
          minIntervalSec: data.minIntervalSec,
          maxIntervalSec: data.maxIntervalSec,
          durationHours: data.durationHours,
          endsAt: data.endsAt ?? null,
          startedAt: data.startedAt,
        },
      }));
      return;
    }

    if (type === 'screenshot-automation:ended' && data.employeeId) {
      setAutoSessions(prev => {
        if (!(data.employeeId in prev)) return prev;
        const next = { ...prev };
        delete next[data.employeeId];
        return next;
      });
      const reason = data.reason as string | undefined;
      if (reason === 'device-disconnect' || reason === 'device-offline') {
        setFlash(t('screenshots.autoEndedDisconnect'));
      } else if (reason === 'admin-stop') {
        setFlash(t('screenshots.autoStopped'));
      } else if (reason === 'duration-elapsed') {
        setFlash(t('screenshots.autoEndedDuration'));
      }
      return;
    }

    if (type === 'employee:offline' && data.employeeId) {
      setAutoSessions(prev => {
        if (!(data.employeeId in prev)) return prev;
        const next = { ...prev };
        delete next[data.employeeId];
        return next;
      });
    }
  }, [lastMessage, employeeId, t]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (delayTimerRef.current) clearInterval(delayTimerRef.current);
      if (delayTimeoutRef.current) clearTimeout(delayTimeoutRef.current);
    };
  }, []);

  const clearDelayTimers = () => {
    if (delayTimerRef.current) {
      clearInterval(delayTimerRef.current);
      delayTimerRef.current = null;
    }
    if (delayTimeoutRef.current) {
      clearTimeout(delayTimeoutRef.current);
      delayTimeoutRef.current = null;
    }
    setCountdownLeft(null);
  };

  const selectedOnline = employeeId ? isEmployeeOnline(employeeId) : false;
  const scheduling = countdownLeft !== null;
  const activeAuto = employeeId ? autoSessions[employeeId] : undefined;
  const autoRunning = !!activeAuto;
  const activeSessionList = Object.values(autoSessions);

  const handleStartAutomation = async () => {
    if (!employeeId) {
      setError(t('screenshots.autoNeedEmployee'));
      return;
    }
    if (!selectedOnline) {
      setError(t('screenshots.offline'));
      return;
    }
    setError(null);
    setAutoBusy(true);
    try {
      const body =
        autoMode === 'fixed'
          ? {
              employeeId,
              mode: 'fixed',
              intervalSec: autoIntervalSec,
              durationHours: autoDurationHours,
            }
          : {
              employeeId,
              mode: 'random',
              minIntervalSec: Math.min(autoMinSec, autoMaxSec),
              maxIntervalSec: Math.max(autoMinSec, autoMaxSec),
              durationHours: autoDurationHours,
            };
      const res = await api.post('/api/screenshots/automation/start', body);
      if (!res?.success) throw new Error(res?.error || t('screenshots.offline'));
      const session = res.data as AutomationSession;
      setAutoSessions(prev => ({ ...prev, [employeeId]: session }));
      setFlash(t('screenshots.autoStarted'));
      setDate(todayLocal());
      void load({ silent: true });
      void refreshAutomation();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAutoBusy(false);
    }
  };

  const handleStopAutomation = async (targetEmployeeId?: string) => {
    const id = targetEmployeeId || employeeId;
    if (!id) return;
    setError(null);
    setStoppingId(id);
    setAutoBusy(true);
    try {
      await api.post('/api/screenshots/automation/stop', { employeeId: id });
      setAutoSessions(prev => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setFlash(t('screenshots.autoStopped'));
      void refreshAutomation();
    } catch (e) {
      const status = (e as { status?: number }).status;
      // Already gone (disconnect race) — treat as stopped.
      if (status === 404) {
        setAutoSessions(prev => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setFlash(t('screenshots.autoStopped'));
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setStoppingId(null);
      setAutoBusy(false);
    }
  };

  const requestScreenshotNow = async () => {
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
      setHttpOnlineIds(prev => new Set(prev).add(employeeId));
      const requestId = res.data?.requestId as string | undefined;
      if (requestId) {
        pendingRequestRef.current = { requestId, employeeId };
      }
      setFlash(t('screenshots.requested'));
      setDate(todayLocal());

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

  const handleCancelSchedule = () => {
    clearDelayTimers();
    setFlash(t('screenshots.timerCancelled'));
  };

  const handleTakeScreenshot = () => {
    if (!employeeId) {
      setError(t('screenshots.selectEmployee'));
      return;
    }
    if (taking || scheduling) return;

    if (delaySec <= 0) {
      void requestScreenshotNow();
      return;
    }

    setError(null);
    setFlash(t('screenshots.timerArmed', { seconds: delaySec }));

    // Clear any previous schedule without wiping the new countdown.
    if (delayTimerRef.current) {
      clearInterval(delayTimerRef.current);
      delayTimerRef.current = null;
    }
    if (delayTimeoutRef.current) {
      clearTimeout(delayTimeoutRef.current);
      delayTimeoutRef.current = null;
    }

    let left = delaySec;
    setCountdownLeft(left);
    delayTimerRef.current = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        if (delayTimerRef.current) {
          clearInterval(delayTimerRef.current);
          delayTimerRef.current = null;
        }
        setCountdownLeft(null);
        return;
      }
      setCountdownLeft(left);
    }, 1000);

    delayTimeoutRef.current = setTimeout(() => {
      delayTimeoutRef.current = null;
      if (delayTimerRef.current) {
        clearInterval(delayTimerRef.current);
        delayTimerRef.current = null;
      }
      setCountdownLeft(null);
      void requestScreenshotNow();
    }, delaySec * 1000);
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

  const fieldLabel: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--tt-text-muted)',
    minWidth: 0,
  };

  const fieldRow: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: 12,
  };

  const actionRow: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
  };

  const statusBanner = (running: boolean): React.CSSProperties => ({
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    padding: '10px 14px',
    borderRadius: 'var(--tt-radius-sm)',
    border: running ? '1px solid var(--tt-success)' : '1px solid var(--tt-border)',
    background: running ? 'var(--tt-success-soft)' : 'var(--tt-surface-muted)',
    fontSize: 13,
    color: running ? 'var(--tt-success)' : 'var(--tt-text-muted)',
  });

  return (
    <div className="tt-page tt-page--wide">
      <PageHero
        icon={Camera}
        title={t('screenshots.title')}
        subtitle={t('screenshots.subtitle')}
        help={t('help.screenshots')}
      />

      {/* 1) Browse filters — gallery only */}
      <PagePanel
        title={t('screenshots.browseTitle')}
        hint={t('screenshots.browseHint')}
        headAction={
          employeeId ? (
            <span
              className="tt-badge"
              style={{
                color: selectedOnline ? 'var(--tt-success)' : 'var(--tt-text-faint)',
              }}
            >
              {selectedOnline ? `● ${t('screenshots.online')}` : `○ ${t('screenshots.offlineBadge')}`}
            </span>
          ) : undefined
        }
      >
        <div style={fieldRow}>
          <label style={{ ...fieldLabel, minWidth: 200, flex: '1 1 200px' }}>
            {t('screenshots.employee')}
            <select
              className="tt-input"
              value={employeeId}
              onChange={e => setEmployeeId(e.target.value)}
              style={{ width: '100%', fontWeight: 500 }}
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
          </label>
          <label style={{ ...fieldLabel, minWidth: 150 }}>
            {t('common.date')}
            <input
              type="date"
              className="tt-input"
              value={date}
              onChange={e => setDate(e.target.value)}
              style={{ width: 'auto', minWidth: 150 }}
            />
          </label>
          <button
            type="button"
            className="tt-btn tt-btn-ghost"
            onClick={() => load()}
            disabled={loading}
            style={{ alignSelf: 'flex-end' }}
          >
            <RefreshCw size={14} style={{ marginInlineEnd: 6 }} />
            {loading ? t('common.loading') : t('common.refresh')}
          </button>
        </div>
      </PagePanel>

      {/* 2) One-shot capture */}
      <PagePanel
        title={t('screenshots.captureTitle')}
        hint={t('screenshots.captureHint')}
      >
        <div style={fieldRow}>
          <label style={{ ...fieldLabel, minWidth: 140 }}>
            {t('screenshots.timer')}
            <select
              className="tt-input"
              value={delaySec}
              onChange={e => setDelaySec(Number(e.target.value))}
              disabled={taking || scheduling || !employeeId}
              style={{ width: 'auto', minWidth: 140 }}
              title={t('screenshots.timerHint')}
            >
              <option value={0}>{t('screenshots.timerNow')}</option>
              <option value={5}>{t('screenshots.timerSeconds', { n: 5 })}</option>
              <option value={10}>{t('screenshots.timerSeconds', { n: 10 })}</option>
              <option value={30}>{t('screenshots.timerSeconds', { n: 30 })}</option>
              <option value={60}>{t('screenshots.timerMinute')}</option>
              <option value={120}>{t('screenshots.timerMinutes', { n: 2 })}</option>
              <option value={300}>{t('screenshots.timerMinutes', { n: 5 })}</option>
            </select>
          </label>
        </div>
        <div style={actionRow}>
          <button
            type="button"
            className="tt-btn tt-btn-primary"
            onClick={handleTakeScreenshot}
            disabled={taking || scheduling || !employeeId || (!selectedOnline && delaySec <= 0)}
            title={
              !employeeId
                ? t('screenshots.selectEmployee')
                : selectedOnline
                  ? undefined
                  : t('screenshots.offline')
            }
          >
            <Camera size={15} style={{ marginInlineEnd: 6 }} />
            {taking
              ? t('screenshots.taking')
              : scheduling
                ? t('screenshots.timerCountdown', { seconds: countdownLeft ?? 0 })
                : delaySec > 0
                  ? t('screenshots.schedule')
                  : t('screenshots.take')}
          </button>
          {scheduling && (
            <button type="button" className="tt-btn tt-btn-ghost" onClick={handleCancelSchedule}>
              {t('screenshots.timerCancel')}
            </button>
          )}
          {!employeeId && (
            <span className="tt-muted" style={{ fontSize: 13 }}>
              {t('screenshots.selectEmployee')}
            </span>
          )}
          {employeeId && !selectedOnline && (
            <span className="tt-muted" style={{ fontSize: 13 }}>
              {t('screenshots.offline')}
            </span>
          )}
        </div>
      </PagePanel>

      {/* 3) Automation — visually separate from one-shot */}
      <PagePanel
        title={t('screenshots.autoTitle')}
        hint={t('screenshots.autoHint')}
        headAction={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--tt-text-faint)' }}>
            <Repeat size={16} />
            {activeSessionList.length > 0 ? (
              <span className="tt-badge" style={{ color: 'var(--tt-success)' }}>
                {t('screenshots.autoActiveCount', { count: activeSessionList.length })}
              </span>
            ) : null}
          </span>
        }
      >
        {activeSessionList.length > 0 && (
          <div
            style={{
              marginBottom: 16,
              border: '1px solid var(--tt-success)',
              background: 'var(--tt-success-soft)',
              borderRadius: 'var(--tt-radius-sm)',
              padding: 12,
            }}
          >
            <div style={{ fontWeight: 650, fontSize: 13, marginBottom: 8, color: 'var(--tt-text)' }}>
              {t('screenshots.autoActiveTitle')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {activeSessionList.map(session => {
                const empName =
                  employees.find(e => e.id === session.employeeId)?.name ||
                  session.employeeId.slice(0, 8);
                const intervalLabel =
                  session.mode === 'random'
                    ? t('screenshots.autoRunningRandom', {
                        min: session.minIntervalSec ?? 30,
                        max: session.maxIntervalSec ?? 120,
                      })
                    : t('screenshots.autoRunningFixed', {
                        seconds: session.intervalSec ?? 60,
                      });
                const endsLabel = session.endsAt
                  ? t('screenshots.autoEndsAt', {
                      time: (() => {
                        try {
                          return new Date(session.endsAt).toLocaleString();
                        } catch {
                          return session.endsAt;
                        }
                      })(),
                    })
                  : t('screenshots.autoUntilStopped');
                return (
                  <div
                    key={session.sessionId || session.employeeId}
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 10,
                      justifyContent: 'space-between',
                      padding: '8px 10px',
                      background: 'var(--tt-surface)',
                      borderRadius: 8,
                      border: '1px solid var(--tt-border)',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: '1 1 200px' }}>
                      <div style={{ fontWeight: 650, fontSize: 13 }}>{empName}</div>
                      <div className="tt-muted" style={{ fontSize: 12, marginTop: 2 }}>
                        {intervalLabel} · {endsLabel}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="tt-btn"
                      onClick={() => void handleStopAutomation(session.employeeId)}
                      disabled={stoppingId === session.employeeId}
                      style={{
                        background: 'var(--tt-danger)',
                        color: '#fff',
                        border: 'none',
                        fontWeight: 650,
                        flexShrink: 0,
                      }}
                    >
                      {stoppingId === session.employeeId
                        ? t('screenshots.autoStopping')
                        : t('screenshots.autoStop')}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={fieldRow}>
          <label style={{ ...fieldLabel, minWidth: 160 }}>
            {t('screenshots.autoMode')}
            <select
              className="tt-input"
              value={autoMode}
              onChange={e => setAutoMode(e.target.value === 'random' ? 'random' : 'fixed')}
              disabled={autoRunning || autoBusy || !employeeId}
              style={{ width: '100%', minWidth: 160 }}
            >
              <option value="fixed">{t('screenshots.autoFixed')}</option>
              <option value="random">{t('screenshots.autoRandom')}</option>
            </select>
          </label>
          {autoMode === 'fixed' ? (
            <label style={{ ...fieldLabel, minWidth: 120 }}>
              {t('screenshots.autoInterval')}
              <select
                className="tt-input"
                value={autoIntervalSec}
                onChange={e => setAutoIntervalSec(Number(e.target.value))}
                disabled={autoRunning || autoBusy || !employeeId}
                style={{ width: 'auto', minWidth: 120 }}
              >
                {AUTO_INTERVAL_OPTIONS.map(sec => (
                  <option key={sec} value={sec}>
                    {sec < 60
                      ? t('screenshots.timerSeconds', { n: sec })
                      : sec === 60
                        ? t('screenshots.timerMinute')
                        : t('screenshots.timerMinutes', { n: sec / 60 })}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label style={{ ...fieldLabel, minWidth: 110 }}>
                {t('screenshots.autoMin')}
                <select
                  className="tt-input"
                  value={autoMinSec}
                  onChange={e => setAutoMinSec(Number(e.target.value))}
                  disabled={autoRunning || autoBusy || !employeeId}
                  style={{ width: 'auto', minWidth: 110 }}
                >
                  {AUTO_INTERVAL_OPTIONS.map(sec => (
                    <option key={sec} value={sec}>
                      {sec < 60
                        ? t('screenshots.timerSeconds', { n: sec })
                        : sec === 60
                          ? t('screenshots.timerMinute')
                          : t('screenshots.timerMinutes', { n: sec / 60 })}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ ...fieldLabel, minWidth: 110 }}>
                {t('screenshots.autoMax')}
                <select
                  className="tt-input"
                  value={autoMaxSec}
                  onChange={e => setAutoMaxSec(Number(e.target.value))}
                  disabled={autoRunning || autoBusy || !employeeId}
                  style={{ width: 'auto', minWidth: 110 }}
                >
                  {AUTO_INTERVAL_OPTIONS.map(sec => (
                    <option key={sec} value={sec}>
                      {sec < 60
                        ? t('screenshots.timerSeconds', { n: sec })
                        : sec === 60
                          ? t('screenshots.timerMinute')
                          : t('screenshots.timerMinutes', { n: sec / 60 })}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label style={{ ...fieldLabel, minWidth: 150 }}>
            {t('screenshots.autoDuration')}
            <select
              className="tt-input"
              value={autoDurationHours}
              onChange={e => setAutoDurationHours(Number(e.target.value))}
              disabled={autoRunning || autoBusy || !employeeId}
              style={{ width: 'auto', minWidth: 150 }}
              title={t('screenshots.autoDurationHint')}
            >
              {AUTO_DURATION_HOURS.map(h => (
                <option key={h} value={h}>
                  {h === 0
                    ? t('screenshots.autoDurationUnlimited')
                    : t('screenshots.autoDurationHours', { n: h })}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={actionRow}>
          {!autoRunning ? (
            <button
              type="button"
              className="tt-btn tt-btn-ghost"
              onClick={() => void handleStartAutomation()}
              disabled={autoBusy || !employeeId || !selectedOnline}
              style={{
                border: '1px solid var(--tt-border)',
                fontWeight: 650,
              }}
              title={
                !employeeId
                  ? t('screenshots.autoNeedEmployee')
                  : selectedOnline
                    ? t('screenshots.autoHint')
                    : t('screenshots.offline')
              }
            >
              <Timer size={15} style={{ marginInlineEnd: 6 }} />
              {autoBusy ? t('screenshots.autoStarting') : t('screenshots.autoStart')}
            </button>
          ) : (
            <button
              type="button"
              className="tt-btn"
              onClick={() => void handleStopAutomation(employeeId)}
              disabled={autoBusy || !employeeId}
              style={{
                background: 'var(--tt-danger)',
                color: '#fff',
                border: 'none',
                fontWeight: 650,
              }}
            >
              {autoBusy ? t('screenshots.autoStopping') : t('screenshots.autoStop')}
            </button>
          )}
          {!employeeId && (
            <span className="tt-muted" style={{ fontSize: 13 }}>
              {t('screenshots.autoNeedEmployee')}
            </span>
          )}
        </div>

        {autoRunning && activeAuto ? (
          <div style={statusBanner(true)} role="status">
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--tt-success)',
                flexShrink: 0,
              }}
            />
            <strong style={{ fontWeight: 650 }}>
              {activeAuto.mode === 'random'
                ? t('screenshots.autoRunningRandom', {
                    min: activeAuto.minIntervalSec ?? autoMinSec,
                    max: activeAuto.maxIntervalSec ?? autoMaxSec,
                  })
                : t('screenshots.autoRunningFixed', {
                    seconds: activeAuto.intervalSec ?? autoIntervalSec,
                  })}
            </strong>
            <span style={{ color: 'var(--tt-text-muted)', fontWeight: 400 }}>
              {activeAuto.endsAt
                ? t('screenshots.autoEndsAt', {
                    time: (() => {
                      try {
                        return new Date(activeAuto.endsAt!).toLocaleString();
                      } catch {
                        return activeAuto.endsAt;
                      }
                    })(),
                  })
                : t('screenshots.autoRunningHint')}
            </span>
          </div>
        ) : activeSessionList.length === 0 ? (
          <div style={statusBanner(false)}>
            {t('screenshots.autoIdleHint')}
          </div>
        ) : null}
      </PagePanel>

      {flash && <div className="tt-flash">{flash}</div>}

      {error && (
        <div className="tt-error-banner">
          <StatusLine variant="error">{error}</StatusLine>
        </div>
      )}

      <PagePanel title={t('screenshots.galleryTitle')} hint={shots.length ? undefined : t('screenshots.galleryHint')}>
        {!loading && shots.length === 0 && (
          <PageEmpty
            icon={Camera}
            title={t('screenshots.emptyTitle')}
            hint={t('screenshots.emptyHint')}
          />
        )}

        {shots.length > 0 && (
          <div
            className="tt-card-grid"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', marginTop: 4 }}
          >
            {shots.map(s => {
              const emp = employees.find(e => e.id === s.employeeId);
              return (
                <article key={s.id} className="tt-entity-card" style={{ padding: 0, minHeight: 'auto', overflow: 'hidden' }}>
                  <button
                    type="button"
                    onClick={() => setZoomed(s)}
                    style={{
                      padding: 0,
                      border: 'none',
                      background: 'none',
                      cursor: 'zoom-in',
                      display: 'block',
                      width: '100%',
                    }}
                    aria-label="View full size"
                  >
                    <img
                      src={authenticatedFileUrl(s.fileUrl)}
                      alt=""
                      loading="lazy"
                      style={{
                        width: '100%',
                        height: '140px',
                        objectFit: 'cover',
                        display: 'block',
                        backgroundColor: 'var(--tt-surface-muted)',
                      }}
                    />
                  </button>
                  <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {emp?.name || s.employeeId.slice(0, 8)}
                    </div>
                    <div className="tt-muted" style={{ fontSize: 11 }}>
                      {fmtTime(s.timestamp)} · {fmtSize(s.fileSizeBytes)}
                    </div>
                    {s.appName && (
                      <div style={{ fontSize: 11, color: 'var(--tt-text-faint)' }}>{s.appName}</div>
                    )}
                    <div className="tt-entity-card-actions" style={{ marginTop: 8, paddingTop: 8 }}>
                      <button
                        type="button"
                        className="tt-action-btn tt-action-btn-danger"
                        onClick={() => handleDelete(s)}
                      >
                        {t('screenshots.delete')}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </PagePanel>

      {zoomed && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setZoomed(null)}
          style={lightboxStyles.overlay}
        >
          <img
            src={authenticatedFileUrl(zoomed.fileUrl)}
            alt="Screenshot full size"
            style={lightboxStyles.image}
            onClick={e => e.stopPropagation()}
          />
          <div style={lightboxStyles.meta}>
            {fmtTime(zoomed.timestamp)} · {zoomed.appName || ''} · {zoomed.windowTitle || ''}
          </div>
        </div>
      )}
    </div>
  );
};

const lightboxStyles: { overlay: React.CSSProperties; image: React.CSSProperties; meta: React.CSSProperties } = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3000,
    padding: 20,
  },
  image: {
    maxWidth: '95%',
    maxHeight: '85%',
    borderRadius: 'var(--tt-radius-sm)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  },
  meta: {
    color: '#fff',
    fontSize: 12,
    marginTop: 12,
    opacity: 0.8,
  },
};

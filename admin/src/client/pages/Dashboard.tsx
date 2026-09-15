import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  Camera,
  Clock3,
  Focus,
  Maximize2,
  Minimize2,
  Monitor,
  Moon,
  Play,
  ShieldAlert,
  Square,
  Zap,
} from 'lucide-react';
import { api } from '../lib/api';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { HelpTip, SectionTitle } from '../components/HelpTip';

import type { Employee } from '../../../shared-types';
import { formatDurationSeconds } from '../../../shared-types';

// Browser timezone sent to the server with every Dashboard stats request so
// "today" is always the admin's local day, not the server's.
function getBrowserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

interface Activity {
  id: string;
  employeeId: string;
  employeeName?: string | null;
  appName: string;
  windowTitle: string;
  category: string;
  categoryName: string;
  productivityScore: number;
  productivityLevel: string;
  isSuspicious: boolean;
  suspiciousReason?: string;
  isIdle: boolean;
  timestamp: string;
}

interface EmployeeActivity {
  employeeId: string;
  employeeName: string;
  currentActivity?: string;
  currentCategory?: string;
  productivityScore: number;
  hoursToday: number;
  suspiciousActivityCount: number;
  isIdle?: boolean;
}

interface DashboardStats {
  timezone: string;
  dayStart: string;
  dayEnd: string;
  totalEmployees: number;
  activeProjects: number;
  totalSecondsToday: number;
  focusSecondsToday: number;
  distractedSecondsToday: number;
  productiveSecondsToday: number;
  unproductiveSecondsToday: number;
  neutralSecondsToday: number;
  idleSecondsToday: number;
  totalHoursToday: number;
  productivityBreakdown: {
    coreWork: number;
    communication: number;
    researchLearning: number;
    planningDocs: number;
    breakIdle: number;
    entertainment: number;
    socialMedia: number;
    shoppingPersonal: number;
    other: number;
  };
  averageProductivityScore: number;
  suspiciousActivityCount: number;
  focusTimeMinutes: number;
  distractedTimeMinutes: number;
  recentActivities: Activity[];
  employeeActivity: EmployeeActivity[];
}

const GettingStarted: React.FC<{ orgName: string; onDismiss: () => void; showDismiss: boolean }> = ({ orgName, onDismiss, showDismiss }) => {
  const navigate = useNavigate();
  const { t } = useI18n();

  const gsStyles: Record<string, React.CSSProperties> = {
    card: {
      maxWidth: '640px',
      margin: '40px auto',
      borderRadius: '16px',
      overflow: 'hidden',
      boxShadow: 'var(--tt-shadow-md)',
      backgroundColor: 'var(--tt-surface)',
    },
    header: {
      background: 'linear-gradient(135deg, var(--tt-text) 0%, var(--tt-teal) 100%)',
      padding: '36px 32px 28px',
      color: '#fff',
    },
    headerTitle: {
      fontSize: '26px',
      fontWeight: 700,
      margin: '0 0 6px',
    },
    headerSub: {
      fontSize: '15px',
      margin: 0,
      color: 'rgba(255,255,255,0.85)',
    },
    body: {
      padding: '28px 32px 32px',
    },
    sectionLabel: {
      fontSize: '13px',
      fontWeight: 600,
      textTransform: 'uppercase' as const,
      color: 'var(--tt-text-faint)',
      letterSpacing: '0.5px',
      marginBottom: '16px',
    },
    step: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: '14px',
      padding: '16px',
      borderRadius: '10px',
      backgroundColor: 'var(--tt-surface-muted)',
      marginBottom: '12px',
    },
    stepNumber: {
      width: '28px',
      height: '28px',
      borderRadius: '50%',
      backgroundColor: 'var(--tt-teal)',
      color: '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '14px',
      fontWeight: 700,
      flexShrink: 0,
    },
    stepContent: {
      flex: 1,
    },
    stepTitle: {
      fontSize: '15px',
      fontWeight: 600,
      color: 'var(--tt-text)',
      margin: '0 0 4px',
    },
    stepDesc: {
      fontSize: '13px',
      color: 'var(--tt-text-muted)',
      margin: 0,
      lineHeight: '1.5',
    },
    stepLink: {
      color: 'var(--tt-teal)',
      fontWeight: 500,
      cursor: 'pointer',
      textDecoration: 'none',
      fontSize: '13px',
    },
  };

  return (
    <div style={gsStyles.card}>
      <div style={gsStyles.header}>
        <h1 style={gsStyles.headerTitle}>
          {orgName ? t('dashboard.welcomeNamed', { name: orgName }) : t('dashboard.welcome') + '!'}
        </h1>
        <p style={gsStyles.headerSub}>{t('dashboard.followSteps')}</p>
      </div>
      <div style={gsStyles.body}>
        <div style={gsStyles.sectionLabel}>{t('dashboard.gettingStarted')}</div>

        <div style={gsStyles.step}>
          <div style={gsStyles.stepNumber}>1</div>
          <div style={gsStyles.stepContent}>
            <p style={gsStyles.stepTitle}>{t('dashboard.step1Title')}</p>
            <p style={gsStyles.stepDesc}>
              {t('dashboard.step1Desc')}{' '}
              <span style={gsStyles.stepLink} onClick={() => navigate('/employees')}>
                {t('dashboard.goEmployees')}
              </span>
            </p>
          </div>
        </div>

        <div style={gsStyles.step}>
          <div style={gsStyles.stepNumber}>2</div>
          <div style={gsStyles.stepContent}>
            <p style={gsStyles.stepTitle}>{t('dashboard.step2Title')}</p>
            <p style={gsStyles.stepDesc}>{t('dashboard.step2Desc')}</p>
          </div>
        </div>

        <div style={gsStyles.step}>
          <div style={gsStyles.stepNumber}>3</div>
          <div style={gsStyles.stepContent}>
            <p style={gsStyles.stepTitle}>{t('dashboard.step3Title')}</p>
            <p style={gsStyles.stepDesc}>
              {t('dashboard.step3Desc')}{' '}
              <a
                href="https://github.com/hamdymohamedak/TeamTracker#3-install-the-desktop-tracker"
                target="_blank"
                rel="noopener noreferrer"
                style={gsStyles.stepLink}
              >
                {t('dashboard.setupInstructions')}
              </a>
            </p>
          </div>
        </div>

        {showDismiss && (
          <div style={{ textAlign: 'center', marginTop: '8px' }}>
            <span
              onClick={onDismiss}
              style={{
                color: '#b0b8c1',
                fontSize: '13px',
                cursor: 'pointer',
                textDecoration: 'none',
              }}
            >
              {t('common.close')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

type DashboardScope = 'today' | 'week' | 'all';

export const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Persist the scope across reloads so the admin doesn't have to re-pick
  // every time. Default = today (the original behavior). The 2026-04-07
  // audit caught the user mistaking 48m today for "all-time" because there
  // was no day-scope toggle anywhere on the page.
  const [scope, setScope] = useState<DashboardScope>(() => {
    const saved = localStorage.getItem('teamtracker_dashboard_scope');
    return saved === 'week' || saved === 'all' ? saved : 'today';
  });
  const [liveEmployeeId, setLiveEmployeeId] = useState<string>('');
  const [liveStreaming, setLiveStreaming] = useState(false);
  const [liveStarting, setLiveStarting] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveFrameAt, setLiveFrameAt] = useState<string | null>(null);
  const [liveFullscreen, setLiveFullscreen] = useState(false);
  const [liveSnapMsg, setLiveSnapMsg] = useState<string | null>(null);
  const [httpOnlineIds, setHttpOnlineIds] = useState<Set<string>>(new Set());
  const liveImgRef = useRef<HTMLImageElement | null>(null);
  const liveStageRef = useRef<HTMLDivElement | null>(null);
  const liveSessionRef = useRef<string | null>(null);
  const liveEmployeeIdRef = useRef(liveEmployeeId);
  const liveCaptionAtRef = useRef(0);
  const liveSnapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  liveEmployeeIdRef.current = liveEmployeeId;
  const { onlineEmployees, lastMessage, sendMessage, subscribeLiveFrames, isConnected } = useWebSocket();
  const { org } = useAuth();
  const { t } = useI18n();

  const isEmployeeOnline = (id: string) => onlineEmployees.has(id) || httpOnlineIds.has(id);

  const changeScope = (next: DashboardScope) => {
    setScope(next);
    localStorage.setItem('teamtracker_dashboard_scope', next);
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  useEffect(() => {
    let cancelled = false;
    const refreshOnline = async () => {
      try {
        const res = await api.get('/api/employees/online');
        if (cancelled || !res?.success) return;
        setHttpOnlineIds(new Set((res.data || []).map((e: { employeeId: string }) => e.employeeId).filter(Boolean)));
      } catch { /* ignore */ }
    };
    void refreshOnline();
    const id = setInterval(refreshOnline, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const stopLiveStream = useCallback((notifyServer = true) => {
    if (notifyServer) sendMessage({ type: 'admin:live-view-stop' });
    liveSessionRef.current = null;
    setLiveStreaming(false);
    setLiveStarting(false);
    setLiveFrameAt(null);
    setLiveSnapMsg(null);
    if (liveImgRef.current) liveImgRef.current.removeAttribute('src');
    if (document.fullscreenElement === liveStageRef.current) {
      void document.exitFullscreen().catch(() => {});
    }
  }, [sendMessage]);

  const startLiveStream = useCallback((employeeId: string) => {
    if (!employeeId) return;
    setLiveError(null);
    setLiveStarting(true);
    setLiveStreaming(false);
    setLiveFrameAt(null);
    if (liveImgRef.current) liveImgRef.current.removeAttribute('src');
    const ok = sendMessage({ type: 'admin:live-view-start', employeeId });
    if (!ok) {
      setLiveStarting(false);
      setLiveError(t('live.wsRequired'));
    }
  }, [sendMessage, t]);

  const toggleLiveFullscreen = useCallback(async () => {
    const el = liveStageRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement === el) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      setLiveError(t('live.fullscreenFailed'));
    }
  }, [t]);

  const captureLiveSnapshot = useCallback((employeeName: string) => {
    const img = liveImgRef.current;
    if (!img?.src || !img.naturalWidth) {
      setLiveError(t('live.snapNoFrame'));
      return;
    }
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas');
      ctx.drawImage(img, 0, 0);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const safeName = (employeeName || 'employee').replace(/[^\w.-]+/g, '_');
      const link = document.createElement('a');
      link.download = `live-${safeName}-${stamp}.jpg`;
      link.href = canvas.toDataURL('image/jpeg', 0.92);
      link.click();
      if (liveSnapTimerRef.current) clearTimeout(liveSnapTimerRef.current);
      setLiveSnapMsg(t('live.snapSaved'));
      liveSnapTimerRef.current = setTimeout(() => setLiveSnapMsg(null), 2200);
    } catch {
      setLiveError(t('live.snapFailed'));
    }
  }, [t]);

  useEffect(() => {
    const onFs = () => {
      setLiveFullscreen(document.fullscreenElement === liveStageRef.current);
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      if (liveSnapTimerRef.current) clearTimeout(liveSnapTimerRef.current);
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
      }
    };
  }, []);

  // Frames bypass React state (img.src) to keep the UI light at ~3.5 fps.
  useEffect(() => {
    return subscribeLiveFrames((message) => {
      if (message.type === 'live-view:ended') {
        const sid = message.data?.sessionId;
        if (!liveSessionRef.current || !sid || sid === liveSessionRef.current) {
          liveSessionRef.current = null;
          setLiveStreaming(false);
          setLiveStarting(false);
          const reason = message.data?.reason;
          if (reason && reason !== 'admin-stop' && reason !== 'switched') {
            setLiveError(t('live.ended'));
          }
        }
        return;
      }
      if (message.type !== 'live-view:frame') return;
      const empId = liveEmployeeIdRef.current;
      if (!empId || message.data?.employeeId !== empId) return;
      if (liveSessionRef.current && message.data?.sessionId && message.data.sessionId !== liveSessionRef.current) return;
      const b64 = message.data?.dataBase64;
      if (!b64) return;
      const mime = message.data?.mimeType || 'image/jpeg';
      const src = `data:${mime};base64,${b64}`;
      if (liveImgRef.current) liveImgRef.current.src = src;
      if (message.data?.sessionId) liveSessionRef.current = message.data.sessionId;
      setLiveStreaming(prev => (prev ? prev : true));
      setLiveStarting(prev => (prev ? false : prev));
      const now = Date.now();
      if (now - liveCaptionAtRef.current > 1000) {
        liveCaptionAtRef.current = now;
        setLiveFrameAt(message.data?.capturedAt || new Date().toISOString());
      }
    });
  }, [subscribeLiveFrames, t]);

  // Server ack / errors for start.
  useEffect(() => {
    if (!lastMessage || lastMessage.type !== 'admin:live-view-status') return;
    const data = lastMessage.data || {};
    if (data.active && data.sessionId) {
      liveSessionRef.current = data.sessionId;
      return;
    }
    if (data.error) {
      setLiveStarting(false);
      setLiveStreaming(false);
      setLiveError(String(data.error));
    }
  }, [lastMessage]);

  // Stop stream when switching employee (nothing streams until Start again).
  useEffect(() => {
    stopLiveStream(true);
    setLiveError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveEmployeeId]);

  useEffect(() => {
    return () => { stopLiveStream(true); };
  }, [stopLiveStream]);

  const loadData = async () => {
    try {
      setError(null);
      const tz = encodeURIComponent(getBrowserTz());
      const [statsData, employeesData] = await Promise.all([
        api.get(`/api/dashboard/stats?tz=${tz}&scope=${scope}`),
        api.get('/api/employees')
      ]);

      if (statsData.success) setStats(statsData.data);
      if (employeesData.success) {
        const list = employeesData.data || [];
        setEmployees(list);
        // Do not auto-select — nothing streams until the admin picks someone.
      }
    } catch (err) {
      console.error('Error loading dashboard data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={errorStyles.container}>
          <div style={errorStyles.icon}>⚠️</div>
          <h2 style={errorStyles.title}>{t('dashboard.failedLoad')}</h2>
          <p style={errorStyles.message}>{error}</p>
          <button onClick={loadData} style={errorStyles.retryButton}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Only block the dashboard when the org has no employees yet.
  // Once at least one employee exists (local testing or production), show
  // the live dashboard immediately — don't force the welcome checklist.
  if (employees.length === 0) {
    return (
      <div style={styles.container}>
        <GettingStarted
          orgName={org?.name || ''}
          onDismiss={() => {}}
          showDismiss={false}
        />
      </div>
    );
  }

  const getProductivityColor = (score: number) => {
    if (score >= 80) return 'var(--tt-success)';
    if (score >= 60) return 'var(--tt-amber)';
    if (score >= 40) return 'var(--tt-amber)';
    return 'var(--tt-danger)';
  };

  const employeeNameFor = (activity: Activity) =>
    activity.employeeName
    || employees.find(e => e.id === activity.employeeId)?.name
    || activity.employeeId.slice(0, 8);

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 style={{ ...styles.title, display: 'flex', alignItems: 'center', gap: 8 }}>
              {t('dashboard.title')}
              <HelpTip text={t('help.dashboard')} />
            </h1>
            <p style={styles.subtitle}>{t('dashboard.subtitle')}</p>
          </div>
          <div role="tablist" aria-label="Dashboard scope" style={{
            display: 'inline-flex',
            border: '1px solid var(--tt-border-strong)',
            borderRadius: '999px',
            overflow: 'hidden',
            backgroundColor: 'var(--tt-surface)',
            boxShadow: 'var(--tt-shadow-sm)',
          }}>
            {(['today', 'week', 'all'] as DashboardScope[]).map(s => (
              <button
                key={s}
                role="tab"
                aria-selected={scope === s}
                onClick={() => changeScope(s)}
                style={{
                  padding: '9px 16px',
                  border: 'none',
                  backgroundColor: scope === s ? 'var(--tt-teal)' : 'transparent',
                  color: scope === s ? '#fff' : 'var(--tt-text-muted)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 650,
                }}
              >
                {s === 'all' ? t('dashboard.all') : s === 'week' ? t('dashboard.week') : t('dashboard.today')}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Alert Banner for Suspicious Activity */}
      {stats && stats.suspiciousActivityCount > 0 && (
        <div style={styles.alertBanner}>
          <AlertTriangle size={16} style={{ marginRight: 8, verticalAlign: 'text-bottom' }} />
          {stats.suspiciousActivityCount} suspicious activities detected today
        </div>
      )}

      <div style={styles.grid}>
        {/* Key Stats */}
        <div style={styles.statsGrid}>
          <StatCard
            title={t('dashboard.teamProductivity')}
            value={`${stats?.averageProductivityScore || 0}%`}
            icon={<BarChart3 size={22} strokeWidth={2.1} />}
            color={getProductivityColor(stats?.averageProductivityScore || 0)}
            tooltip={t('help.teamProductivity')}
          />
          {(() => {
            const prod = stats?.productiveSecondsToday ?? 0;
            const total = stats?.totalSecondsToday ?? 0;
            const util = total > 0 ? Math.round((prod / total) * 100) : 0;
            return (
              <StatCard
                title={t('dashboard.utilization')}
                value={`${util}%`}
                icon={<Zap size={22} strokeWidth={2.1} />}
                color={getProductivityColor(util)}
                tooltip={t('help.utilization')}
              />
            );
          })()}
          <StatCard
            title={t('dashboard.focusTime')}
            value={formatDurationSeconds(stats?.focusSecondsToday ?? (stats?.focusTimeMinutes || 0) * 60)}
            icon={<Focus size={22} strokeWidth={2.1} />}
            color="var(--tt-success)"
            tooltip={t('help.focusTime')}
          />
          <StatCard
            title={t('dashboard.idleTime')}
            value={formatDurationSeconds(stats?.distractedSecondsToday ?? (stats?.distractedTimeMinutes || 0) * 60)}
            icon={<Moon size={22} strokeWidth={2.1} />}
            color="var(--tt-danger)"
            tooltip={t('help.idleTime')}
          />
          <StatCard
            title={t('dashboard.suspicious')}
            value={stats?.suspiciousActivityCount || 0}
            icon={<ShieldAlert size={22} strokeWidth={2.1} />}
            color={stats?.suspiciousActivityCount ? 'var(--tt-danger)' : 'var(--tt-text-faint)'}
            tooltip={t('help.suspicious')}
          />
        </div>

        {/* Live Activity — pick one employee, then start on-demand screen stream */}
        <div style={styles.section}>
          <SectionTitle
            icon={<Monitor size={18} strokeWidth={2.1} />}
            help={t('help.liveActivity')}
            style={{ marginBottom: 16 }}
          >
            {t('live.title')}
          </SectionTitle>

          <div style={styles.liveLayout} className="dashboard-live-layout">
            <div style={styles.liveEmployeeList} role="listbox" aria-label={t('live.employees')}>
              {employees.length === 0 ? (
                <p style={styles.emptyText}>{t('live.noEmployees')}</p>
              ) : (
                employees.map(emp => {
                  const empActivity = stats?.employeeActivity?.find(e => e.employeeId === emp.id);
                  const online = isEmployeeOnline(emp.id);
                  const selected = liveEmployeeId === emp.id;
                  return (
                    <button
                      key={emp.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => setLiveEmployeeId(emp.id)}
                      style={styles.liveEmployeeRow(selected, online)}
                    >
                      <span style={styles.statusIndicator(online)} />
                      <span style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                        <span style={styles.liveEmployeeName}>{emp.name}</span>
                        <span style={styles.liveEmployeeMeta}>
                          {empActivity?.currentActivity || (online ? t('live.online') : t('live.offline'))}
                        </span>
                      </span>
                      <span style={online ? styles.onlineBadge : styles.offlineBadge}>
                        {online ? t('live.onlineBadge') : t('live.offlineBadge')}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div style={styles.liveScreenPanel}>
              {(() => {
                const selected = employees.find(e => e.id === liveEmployeeId);
                const empActivity = stats?.employeeActivity?.find(e => e.employeeId === liveEmployeeId);
                const online = liveEmployeeId ? isEmployeeOnline(liveEmployeeId) : false;
                if (!selected) {
                  return (
                    <div style={styles.liveEmptyScreen}>
                      <Monitor size={36} color="var(--tt-text-faint)" />
                      <p style={{ margin: '12px 0 4px', fontWeight: 600 }}>{t('live.pickEmployee')}</p>
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--tt-text-muted)', maxWidth: 360, textAlign: 'center' }}>
                        {t('live.pickHint')}
                      </p>
                    </div>
                  );
                }
                const canStart = online && isConnected && !liveStarting && !liveStreaming;
                return (
                  <>
                    <div style={styles.liveScreenHeader}>
                      <div style={{ minWidth: 0 }}>
                        <div style={styles.liveScreenTitle}>{selected.name}</div>
                        <div style={styles.liveScreenSub}>
                          {liveStreaming
                            ? t('live.streaming')
                            : liveStarting
                              ? t('live.connecting')
                              : empActivity?.currentActivity
                                ? `${empActivity.currentActivity}${empActivity.currentCategory ? ` · ${empActivity.currentCategory}` : ''}`
                                : online
                                  ? t('live.ready')
                                  : t('live.trackerOffline')}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                        {liveStreaming && (
                          <>
                            <button
                              type="button"
                              onClick={() => captureLiveSnapshot(selected.name)}
                              style={styles.liveGhostBtn}
                              title={t('live.snapTitle')}
                            >
                              <Camera size={14} />
                              {t('live.snap')}
                            </button>
                            <button
                              type="button"
                              onClick={() => void toggleLiveFullscreen()}
                              style={styles.liveGhostBtn}
                              title={liveFullscreen ? t('live.exitFullscreen') : t('live.fullscreenTitle')}
                            >
                              {liveFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                              {liveFullscreen ? t('live.exitFullscreen') : t('live.fullscreen')}
                            </button>
                          </>
                        )}
                        {liveStreaming || liveStarting ? (
                          <button
                            type="button"
                            onClick={() => stopLiveStream(true)}
                            style={styles.liveGhostBtn}
                            title={t('live.stopTitle')}
                          >
                            <Square size={14} />
                            {t('live.stop')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startLiveStream(liveEmployeeId)}
                            disabled={!canStart}
                            style={{
                              ...styles.livePrimaryBtn,
                              opacity: canStart ? 1 : 0.55,
                              cursor: canStart ? 'pointer' : 'not-allowed',
                            }}
                            title={
                              !isConnected
                                ? t('live.wsRequired')
                                : online
                                  ? t('live.startTitle')
                                  : t('live.mustOnline')
                            }
                          >
                            <Play size={14} />
                            {t('live.start')}
                          </button>
                        )}
                      </div>
                    </div>

                    {liveError && <div style={styles.liveError}>{liveError}</div>}
                    {liveSnapMsg && <div style={styles.liveSnapOk}>{liveSnapMsg}</div>}

                    <div
                      ref={liveStageRef}
                      style={{
                        ...styles.liveScreenStage,
                        ...(liveFullscreen ? styles.liveScreenStageFullscreen : null),
                      }}
                    >
                      <img
                        ref={liveImgRef}
                        alt={t('live.screenAlt', { name: selected.name })}
                        style={{
                          ...styles.liveScreenImage,
                          ...(liveFullscreen ? styles.liveScreenImageFullscreen : null),
                          display: liveStreaming ? 'block' : 'none',
                        }}
                      />
                      {!liveStreaming && (
                        <div style={styles.liveEmptyScreen}>
                          <Monitor size={36} color="var(--tt-text-faint)" />
                          <p style={{ margin: '12px 0 4px', fontWeight: 600 }}>
                            {liveStarting ? t('live.connecting') : t('live.idleTitle')}
                          </p>
                          <p style={{ margin: 0, fontSize: 13, color: 'var(--tt-text-muted)', maxWidth: 360, textAlign: 'center' }}>
                            {!isConnected
                              ? t('live.wsRequired')
                              : online
                                ? t('live.idleHint')
                                : t('live.offlineHint')}
                          </p>
                        </div>
                      )}
                      {liveStreaming && (
                        <div style={styles.liveOverlayBar}>
                          <span style={styles.liveOverlayLive}>
                            {t('live.liveBadge')}
                            {liveFrameAt ? ` · ${new Date(liveFrameAt).toLocaleTimeString()}` : ''}
                          </span>
                          <span style={{ display: 'flex', gap: 8 }}>
                            <button
                              type="button"
                              onClick={() => captureLiveSnapshot(selected.name)}
                              style={styles.liveOverlayBtn}
                              title={t('live.snapTitle')}
                            >
                              <Camera size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={() => void toggleLiveFullscreen()}
                              style={styles.liveOverlayBtn}
                              title={liveFullscreen ? t('live.exitFullscreen') : t('live.fullscreenTitle')}
                            >
                              {liveFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                            </button>
                          </span>
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Time Breakdown */}
        <div style={styles.section}>
          <SectionTitle
            icon={<Clock3 size={18} strokeWidth={2.1} />}
            help={t('help.timeBreakdown')}
            style={{ marginBottom: 16 }}
          >
            Time Breakdown ({scope === 'all' ? 'All Time' : scope === 'week' ? 'This Week' : 'Today'})
          </SectionTitle>
          <div style={styles.breakdownGrid}>
            <BreakdownItem
              label="Core Work"
              minutes={stats?.productivityBreakdown?.coreWork || 0}
              color="var(--tt-success)"
            />
            <BreakdownItem
              label="Communication"
              minutes={stats?.productivityBreakdown?.communication || 0}
              color="var(--tt-teal)"
            />
            <BreakdownItem
              label="Research & Learning"
              minutes={stats?.productivityBreakdown?.researchLearning || 0}
              color="#9b59b6"
            />
            <BreakdownItem
              label="Planning & Docs"
              minutes={stats?.productivityBreakdown?.planningDocs || 0}
              color="#1abc9c"
            />
            <BreakdownItem
              label="Break/Idle"
              minutes={stats?.productivityBreakdown?.breakIdle || 0}
              color="var(--tt-text-faint)"
            />
            <BreakdownItem
              label="Entertainment"
              minutes={stats?.productivityBreakdown?.entertainment || 0}
              color="var(--tt-danger)"
            />
            <BreakdownItem
              label="Social Media"
              minutes={stats?.productivityBreakdown?.socialMedia || 0}
              color="var(--tt-amber)"
            />
            <BreakdownItem
              label="Shopping/Personal"
              minutes={stats?.productivityBreakdown?.shoppingPersonal || 0}
              color="var(--tt-amber)"
            />
            <BreakdownItem
              label="Other"
              minutes={stats?.productivityBreakdown?.other || 0}
              color="var(--tt-text-faint)"
            />
          </div>
        </div>

        {/* Suspicious Activity Log */}
        {stats?.recentActivities?.some(a => a.isSuspicious) && (
          <div style={{ ...styles.section, border: '2px solid var(--tt-danger)' }}>
            <SectionTitle
              icon={<ShieldAlert size={18} strokeWidth={2.1} color="var(--tt-danger)" />}
              help={t('help.suspiciousLog')}
              style={{ marginBottom: 16, color: 'var(--tt-danger)' }}
            >
              Suspicious Activity Log
            </SectionTitle>
            <div style={styles.suspiciousList}>
              {stats.recentActivities
                .filter(a => a.isSuspicious)
                .slice(0, 10)
                .map((activity) => (
                  <div key={activity.id} style={styles.suspiciousItem}>
                    <div style={styles.suspiciousHeader}>
                      <span style={styles.suspiciousApp}>
                        {employeeNameFor(activity)} · {activity.appName}
                      </span>
                      <span style={styles.suspiciousTime}>
                        {new Date(activity.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div style={styles.suspiciousTitle}>{activity.windowTitle}</div>
                    <div style={styles.suspiciousReasonText}>
                      {activity.suspiciousReason}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
  tooltip?: string;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, icon, color, tooltip }) => {
  return (
    <div style={{ ...styles.statCard, borderLeftColor: color }}>
      <div style={styles.statIcon(color)}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...styles.statValue, color }}>{value}</div>
        <div style={{ ...styles.statTitle, display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>{title}</span>
          {tooltip ? <HelpTip text={tooltip} /> : null}
        </div>
      </div>
    </div>
  );
};

interface BreakdownItemProps {
  label: string;
  minutes: number;
  color: string;
}

const BreakdownItem: React.FC<BreakdownItemProps> = ({ label, minutes, color }) => {
  return (
    <div style={styles.breakdownItem}>
      <div style={styles.breakdownLabel}>
        <span style={{ ...styles.breakdownDot, backgroundColor: color }} />
        {label}
      </div>
      <div style={styles.breakdownValue}>{formatDurationSeconds(minutes * 60)}</div>
    </div>
  );
};

const errorStyles: { [key: string]: React.CSSProperties } = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px',
    textAlign: 'center'
  },
  icon: {
    fontSize: '48px',
    marginBottom: '16px'
  },
  title: {
    fontSize: '24px',
    fontWeight: 600,
    color: 'var(--tt-danger)',
    marginBottom: '8px'
  },
  message: {
    fontSize: '16px',
    color: 'var(--tt-text-muted)',
    marginBottom: '24px'
  },
  retryButton: {
    padding: '12px 24px',
    backgroundColor: 'var(--tt-teal)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--tt-radius-sm)',
    fontSize: '16px',
    fontWeight: 500,
    cursor: 'pointer'
  }
};

const styles: { [key: string]: React.CSSProperties | any } = {
  container: {
    padding: '8px 4px 24px',
    animation: 'tt-rise 0.45s var(--tt-ease) both',
    maxWidth: 1400,
    margin: '0 auto',
  },
  loading: {
    padding: '40px',
    textAlign: 'center',
    color: 'var(--tt-text-muted)'
  },
  header: {
    marginBottom: '28px'
  },
  title: {
    fontSize: 'clamp(1.75rem, 2.5vw, 2.15rem)',
    fontWeight: 750,
    fontFamily: 'var(--tt-font-display)',
    letterSpacing: '-0.03em',
    color: 'var(--tt-text)',
    margin: 0
  },
  subtitle: {
    fontSize: '15px',
    color: 'var(--tt-text-muted)',
    marginTop: '6px'
  },
  alertBanner: {
    backgroundColor: 'var(--tt-danger-soft)',
    border: '1px solid rgba(232, 93, 76, 0.25)',
    color: 'var(--tt-danger)',
    padding: '14px 18px',
    borderRadius: 'var(--tt-radius)',
    marginBottom: '20px',
    fontWeight: 600,
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '14px'
  },
  statCard: {
    backgroundColor: 'var(--tt-surface)',
    border: '1px solid var(--tt-border)',
    borderRadius: 'var(--tt-radius)',
    boxShadow: 'var(--tt-shadow-sm)',
    padding: '18px 18px 18px 20px',
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    borderLeft: '4px solid var(--tt-teal)',
    transition: 'transform 0.25s var(--tt-ease), box-shadow 0.25s var(--tt-ease)',
  },
  grid: {
    display: 'grid',
    gap: '24px'
  },
  statIcon: (color: string) => ({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color,
    backgroundColor: `${color}20`,
    padding: '12px',
    borderRadius: 'var(--tt-radius-sm)',
  }),
  statValue: {
    fontSize: '26px',
    fontWeight: 750,
    fontFamily: 'var(--tt-font-display)',
    letterSpacing: '-0.02em',
  },
  statTitle: {
    fontSize: '13px',
    color: 'var(--tt-text-muted)',
    fontWeight: 600,
  },
  section: {
    backgroundColor: 'var(--tt-surface)',
    border: '1px solid var(--tt-border)',
    padding: '24px',
    borderRadius: 'var(--tt-radius)',
    boxShadow: 'var(--tt-shadow-sm)'
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: 600,
    marginBottom: '16px',
    color: 'var(--tt-text)'
  },
  employeeGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: '16px'
  },
  employeeCard: (online: boolean, isIdle?: boolean) => ({
    padding: '16px',
    borderRadius: 'var(--tt-radius-sm)',
    backgroundColor: isIdle ? '#fff5f5' : online ? 'var(--tt-success-soft)' : 'var(--tt-surface-muted)',
    border: `2px solid ${isIdle ? 'var(--tt-danger)' : online ? 'var(--tt-success)' : 'var(--tt-border-strong)'}`,
    transition: 'all 0.2s'
  }),
  employeeHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px'
  },
  statusIndicator: (online: boolean) => ({
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: online ? 'var(--tt-success)' : 'var(--tt-text-faint)'
  }),
  employeeName: {
    fontWeight: 600,
    fontSize: '16px',
    color: 'var(--tt-text)',
    flex: 1
  },
  onlineBadge: {
    fontSize: '10px',
    fontWeight: 700,
    color: 'var(--tt-success)',
    backgroundColor: '#d4edda',
    padding: '2px 8px',
    borderRadius: '4px'
  },
  offlineBadge: {
    fontSize: '10px',
    fontWeight: 700,
    color: 'var(--tt-text-faint)',
    backgroundColor: 'var(--tt-surface-muted)',
    padding: '2px 8px',
    borderRadius: '4px'
  },
  liveLayout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(220px, 280px) 1fr',
    gap: 16,
    alignItems: 'stretch',
  },
  liveEmployeeList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
    maxHeight: 480,
    overflowY: 'auto' as const,
    paddingRight: 4,
  },
  liveEmployeeRow: (selected: boolean, online: boolean) => ({
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    textAlign: 'left' as const,
    padding: '10px 12px',
    borderRadius: 10,
    border: selected ? '1px solid var(--tt-ink)' : '1px solid var(--tt-border)',
    backgroundColor: selected ? 'var(--tt-surface-muted)' : 'var(--tt-surface)',
    cursor: 'pointer',
    opacity: online || selected ? 1 : 0.72,
  }),
  liveEmployeeName: {
    display: 'block',
    fontWeight: 650,
    fontSize: 14,
    color: 'var(--tt-text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  liveEmployeeMeta: {
    display: 'block',
    fontSize: 11,
    color: 'var(--tt-text-muted)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    marginTop: 2,
  },
  liveScreenPanel: {
    border: '1px solid var(--tt-border)',
    borderRadius: 12,
    backgroundColor: 'var(--tt-surface-muted)',
    padding: 14,
    minHeight: 360,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
  },
  liveScreenHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap' as const,
  },
  liveScreenTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: 'var(--tt-text)',
  },
  liveScreenSub: {
    fontSize: 12,
    color: 'var(--tt-text-muted)',
    marginTop: 2,
  },
  liveGhostBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid var(--tt-border-strong)',
    background: 'var(--tt-surface)',
    color: 'var(--tt-text)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  livePrimaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 12px',
    borderRadius: 8,
    border: 'none',
    background: 'var(--tt-ink)',
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
  },
  liveError: {
    backgroundColor: 'var(--tt-danger-soft)',
    border: '1px solid rgba(232, 93, 76, 0.25)',
    color: 'var(--tt-danger)',
    padding: '8px 10px',
    borderRadius: 8,
    fontSize: 12,
  },
  liveSnapOk: {
    backgroundColor: 'var(--tt-success-soft, rgba(34, 160, 107, 0.12))',
    border: '1px solid rgba(34, 160, 107, 0.28)',
    color: 'var(--tt-success, #1a8f5c)',
    padding: '8px 10px',
    borderRadius: 8,
    fontSize: 12,
  },
  liveScreenStage: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    background: '#111',
    borderRadius: 10,
    overflow: 'hidden',
    minHeight: 280,
    position: 'relative' as const,
  },
  liveScreenStageFullscreen: {
    borderRadius: 0,
    minHeight: '100vh',
    width: '100vw',
    height: '100vh',
    background: '#000',
  },
  liveScreenImage: {
    width: '100%',
    maxHeight: 420,
    objectFit: 'contain' as const,
    display: 'block',
    background: '#111',
  },
  liveScreenImageFullscreen: {
    maxHeight: '100%',
    height: '100%',
    width: '100%',
    background: '#000',
  },
  liveOverlayBar: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    bottom: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '10px 14px',
    background: 'linear-gradient(transparent, rgba(0,0,0,0.72))',
    color: '#fff',
    fontSize: 12,
  },
  liveOverlayLive: {
    fontWeight: 700,
    letterSpacing: 0.4,
  },
  liveOverlayBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.25)',
    background: 'rgba(0,0,0,0.45)',
    color: '#fff',
    cursor: 'pointer',
  },
  liveScreenCaption: {
    width: '100%',
    padding: '8px 12px',
    fontSize: 11,
    color: 'rgba(255,255,255,0.75)',
    background: 'rgba(0,0,0,0.55)',
  },
  liveEmptyScreen: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--tt-text)',
    padding: 24,
    background: 'var(--tt-surface)',
    width: '100%',
    minHeight: 280,
  },
  suspiciousBadge: {
    fontSize: '10px',
    fontWeight: 700,
    color: '#fff',
    backgroundColor: 'var(--tt-danger)',
    padding: '2px 8px',
    borderRadius: '4px'
  },
  currentActivity: {
    fontSize: '14px',
    color: 'var(--tt-text)',
    marginBottom: '4px'
  },
  categoryTag: (category?: string) => ({
    display: 'inline-block',
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    color: category === 'break_idle' ? 'var(--tt-danger)' :
          category === 'entertainment' ? 'var(--tt-danger)' :
          category === 'core_work' ? 'var(--tt-success)' :
          category === 'communication' ? 'var(--tt-teal)' : 'var(--tt-text-muted)',
    backgroundColor: category === 'break_idle' ? 'var(--tt-danger-soft)' :
                     category === 'entertainment' ? 'var(--tt-danger-soft)' :
                     category === 'core_work' ? 'var(--tt-success-soft)' :
                     category === 'communication' ? 'var(--tt-info-soft)' : 'var(--tt-surface-muted)',
    padding: '2px 8px',
    borderRadius: '4px',
    marginBottom: '8px'
  }),
  productivityBar: {
    position: 'relative',
    height: '20px',
    backgroundColor: 'var(--tt-surface-muted)',
    borderRadius: '10px',
    overflow: 'hidden',
    marginBottom: '8px'
  },
  productivityFill: (score: number) => ({
    height: '100%',
    width: `${score}%`,
    backgroundColor: score >= 80 ? 'var(--tt-success)' : score >= 60 ? 'var(--tt-amber)' : 'var(--tt-danger)',
    borderRadius: '10px',
    transition: 'width 0.3s'
  }),
  productivityText: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontSize: '11px',
    fontWeight: 600,
    color: 'var(--tt-text)'
  },
  employeeMeta: {
    fontSize: '12px',
    color: 'var(--tt-text-muted)'
  },
  noActivity: {
    fontSize: '14px',
    color: 'var(--tt-text-faint)',
    fontStyle: 'italic'
  },
  breakdownGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '12px'
  },
  breakdownItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px',
    backgroundColor: 'var(--tt-surface-muted)',
    borderRadius: 'var(--tt-radius-sm)'
  },
  breakdownLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    color: 'var(--tt-text)'
  },
  breakdownDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%'
  },
  breakdownValue: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--tt-text)'
  },
  activityList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  activityItem: (isSuspicious: boolean, isIdle: boolean) => ({
    padding: '12px',
    backgroundColor: isSuspicious ? 'var(--tt-danger-soft)' : isIdle ? 'var(--tt-surface-muted)' : '#fff',
    border: `1px solid ${isSuspicious ? 'rgba(232, 93, 76, 0.25)' : isIdle ? 'var(--tt-border-strong)' : 'var(--tt-surface-muted)'}`,
    borderRadius: 'var(--tt-radius-sm)',
    borderLeft: isSuspicious ? '4px solid var(--tt-danger)' : isIdle ? '4px solid var(--tt-text-faint)' : '4px solid var(--tt-success)'
  }),
  activityHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '4px'
  },
  activityIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    flexShrink: 0,
  },
  activityEmployee: {
    fontWeight: 650,
    fontSize: '13px',
    color: 'var(--tt-text)',
    maxWidth: 140,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  activityApp: {
    fontWeight: 600,
    fontSize: '14px',
    color: 'var(--tt-text-muted)'
  },
  activityCategory: (category: string) => ({
    fontSize: '11px',
    fontWeight: 500,
    color: category === 'break_idle' ? 'var(--tt-danger)' :
          category === 'entertainment' ? 'var(--tt-danger)' :
          category === 'core_work' ? 'var(--tt-success)' :
          category === 'communication' ? 'var(--tt-teal)' : 'var(--tt-text-muted)',
    backgroundColor: category === 'break_idle' ? 'var(--tt-danger-soft)' :
                     category === 'entertainment' ? 'var(--tt-danger-soft)' :
                     category === 'core_work' ? 'var(--tt-success-soft)' :
                     category === 'communication' ? 'var(--tt-info-soft)' : 'var(--tt-surface-muted)',
    padding: '2px 6px',
    borderRadius: '4px'
  }),
  activityTime: {
    marginLeft: 'auto',
    fontSize: '12px',
    color: 'var(--tt-text-faint)'
  },
  activityTitle: {
    fontSize: '13px',
    color: 'var(--tt-text-muted)',
    marginLeft: '22px'
  },
  suspiciousReason: {
    fontSize: '12px',
    color: 'var(--tt-danger)',
    marginLeft: '22px',
    marginTop: '4px',
    fontWeight: 500
  },
  suspiciousList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  suspiciousItem: {
    padding: '12px',
    backgroundColor: 'var(--tt-danger-soft)',
    border: '1px solid rgba(232, 93, 76, 0.25)',
    borderRadius: 'var(--tt-radius-sm)'
  },
  suspiciousHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '4px'
  },
  suspiciousApp: {
    fontWeight: 600,
    color: 'var(--tt-text)'
  },
  suspiciousTime: {
    fontSize: '12px',
    color: 'var(--tt-text-faint)'
  },
  suspiciousTitle: {
    fontSize: '13px',
    color: 'var(--tt-text-muted)',
    marginBottom: '4px'
  },
  suspiciousReasonText: {
    fontSize: '12px',
    color: 'var(--tt-danger)',
    fontWeight: 500
  },
  emptyText: {
    color: 'var(--tt-text-faint)',
    textAlign: 'center',
    padding: '20px'
  }
};

// Loading Skeleton Component
const DashboardSkeleton: React.FC = () => (
  <div style={skeletonStyles.container}>
    <div style={skeletonStyles.header}>
      <div style={skeletonStyles.title} />
      <div style={skeletonStyles.subtitle} />
    </div>
    <div style={skeletonStyles.statsGrid}>
      {[1, 2, 3, 4].map(i => (
        <div key={i} style={skeletonStyles.statCard}>
          <div style={skeletonStyles.statIcon} />
          <div style={skeletonStyles.statValue} />
          <div style={skeletonStyles.statLabel} />
        </div>
      ))}
    </div>
    <div style={skeletonStyles.contentGrid}>
      <div style={skeletonStyles.card}>
        <div style={skeletonStyles.cardTitle} />
        <div style={skeletonStyles.cardContent} />
      </div>
      <div style={skeletonStyles.card}>
        <div style={skeletonStyles.cardTitle} />
        <div style={skeletonStyles.cardContent} />
      </div>
    </div>
  </div>
);

const skeletonStyles: { [key: string]: React.CSSProperties } = {
  container: {
    padding: '24px',
    animation: 'fadeIn 0.3s ease'
  },
  header: {
    marginBottom: '24px'
  },
  title: {
    height: '32px',
    width: '200px',
    backgroundColor: 'var(--tt-border-strong)',
    borderRadius: '4px',
    marginBottom: '8px',
    animation: 'pulse 1.5s infinite'
  },
  subtitle: {
    height: '16px',
    width: '300px',
    backgroundColor: 'var(--tt-border-strong)',
    borderRadius: '4px',
    animation: 'pulse 1.5s infinite'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '16px',
    marginBottom: '24px'
  },
  statCard: {
    backgroundColor: 'var(--tt-surface)',
    padding: '20px',
    borderRadius: 'var(--tt-radius-sm)',
    boxShadow: 'var(--tt-shadow-sm)'
  },
  statIcon: {
    width: '40px',
    height: '40px',
    backgroundColor: 'var(--tt-border-strong)',
    borderRadius: 'var(--tt-radius-sm)',
    marginBottom: '12px',
    animation: 'pulse 1.5s infinite'
  },
  statValue: {
    height: '28px',
    width: '80px',
    backgroundColor: 'var(--tt-border-strong)',
    borderRadius: '4px',
    marginBottom: '8px',
    animation: 'pulse 1.5s infinite'
  },
  statLabel: {
    height: '14px',
    width: '120px',
    backgroundColor: 'var(--tt-border-strong)',
    borderRadius: '4px',
    animation: 'pulse 1.5s infinite'
  },
  contentGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
    gap: '24px'
  },
  card: {
    backgroundColor: 'var(--tt-surface)',
    padding: '20px',
    borderRadius: 'var(--tt-radius-sm)',
    boxShadow: 'var(--tt-shadow-sm)'
  },
  cardTitle: {
    height: '20px',
    width: '150px',
    backgroundColor: 'var(--tt-border-strong)',
    borderRadius: '4px',
    marginBottom: '16px',
    animation: 'pulse 1.5s infinite'
  },
  cardContent: {
    height: '200px',
    backgroundColor: 'var(--tt-border-strong)',
    borderRadius: '4px',
    animation: 'pulse 1.5s infinite'
  }
};

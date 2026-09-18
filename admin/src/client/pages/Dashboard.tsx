import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  Camera,
  EyeOff,
  Focus,
  LayoutDashboard,
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
import { HelpTip } from '../components/HelpTip';
import { PageEmpty, PageHero, PagePanel } from '../components/PageHero';

import type { Employee } from '../../../shared-types';
import { formatDurationSeconds } from '../../../shared-types';
import {
  LiveViewSessionController,
  type LiveViewMetrics,
} from '../live-view/LiveViewSessionController';
import type { LiveViewQualityMode } from '../../../shared/live-view/quality';
import type { LiveViewSignalPayload } from '../../../shared/live-view/protocol';

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
  const [livePrivacyBlocked, setLivePrivacyBlocked] = useState(false);
  const [livePrivacyApp, setLivePrivacyApp] = useState<string | null>(null);
  const [livePrivacyPattern, setLivePrivacyPattern] = useState<string | null>(null);
  const [liveQuality, setLiveQuality] = useState<LiveViewQualityMode>('auto');
  const [liveMetrics, setLiveMetrics] = useState<LiveViewMetrics | null>(null);
  const [liveShowDetails, setLiveShowDetails] = useState(false);
  const [httpOnlineIds, setHttpOnlineIds] = useState<Set<string>>(new Set());
  const liveImgRef = useRef<HTMLImageElement | null>(null);
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const liveStageRef = useRef<HTMLDivElement | null>(null);
  const liveSessionRef = useRef<string | null>(null);
  const liveEmployeeIdRef = useRef(liveEmployeeId);
  const liveCaptionAtRef = useRef(0);
  const liveSnapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveResumeRef = useRef(false);
  const liveWasOfflineRef = useRef(false);
  const liveControllerRef = useRef<LiveViewSessionController | null>(null);
  const liveQualityRef = useRef(liveQuality);
  liveEmployeeIdRef.current = liveEmployeeId;
  liveQualityRef.current = liveQuality;
  const {
    onlineEmployees,
    lastMessage,
    sendMessage,
    subscribeLiveFrames,
    subscribeLiveBinary,
    isConnected,
  } = useWebSocket();
  const { org } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

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

  const ensureController = useCallback(() => {
    if (liveControllerRef.current) return liveControllerRef.current;
    const controller = new LiveViewSessionController({
      sendJson: (message) => sendMessage(message),
      onMetrics: (m) => {
        setLiveMetrics(m);
        if (m.qualityMode && m.qualityMode !== liveQualityRef.current) {
          // Controller may clamp Ultra off LAN — keep UI in sync
          if (m.qualityMode !== 'ultra' || m.ultraAllowed) {
            setLiveQuality(m.qualityMode);
            liveQualityRef.current = m.qualityMode;
          } else if (liveQualityRef.current === 'ultra') {
            setLiveQuality('high');
            liveQualityRef.current = 'high';
          }
        }
      },
      onPrivacy: (blocked) => {
        setLivePrivacyBlocked(blocked);
        if (blocked) {
          if (liveImgRef.current) liveImgRef.current.removeAttribute('src');
        }
      },
      attachVideo: (stream) => {
        const video = liveVideoRef.current;
        if (!video) return;
        video.srcObject = stream;
        if (stream) {
          void video.play().catch(() => {});
          setLiveStreaming(true);
          setLiveStarting(false);
          if (liveStartTimerRef.current) {
            clearTimeout(liveStartTimerRef.current);
            liveStartTimerRef.current = null;
          }
        }
      },
      attachBinaryFrame: (url, meta) => {
        if (meta.privacyBlocked) {
          setLivePrivacyBlocked(true);
          if (liveImgRef.current) liveImgRef.current.removeAttribute('src');
          setLiveStreaming(true);
          setLiveStarting(false);
          return;
        }
        setLivePrivacyBlocked(false);
        if (liveImgRef.current && url) liveImgRef.current.src = url;
        setLiveStreaming(true);
        setLiveStarting(false);
        if (liveStartTimerRef.current) {
          clearTimeout(liveStartTimerRef.current);
          liveStartTimerRef.current = null;
        }
        const now = Date.now();
        if (now - liveCaptionAtRef.current > 1000) {
          liveCaptionAtRef.current = now;
          setLiveFrameAt(new Date().toISOString());
        }
      },
    });
    liveControllerRef.current = controller;
    return controller;
  }, [sendMessage]);

  const stopLiveStream = useCallback((notifyServer = true) => {
    if (liveStartTimerRef.current) {
      clearTimeout(liveStartTimerRef.current);
      liveStartTimerRef.current = null;
    }
    if (liveControllerRef.current) {
      if (notifyServer) liveControllerRef.current.stop();
      else liveControllerRef.current.destroy();
      liveControllerRef.current = null;
    } else if (notifyServer) {
      sendMessage({ type: 'admin:live-view-stop' });
    }
    liveSessionRef.current = null;
    setLiveStreaming(false);
    setLiveStarting(false);
    setLiveFrameAt(null);
    setLiveSnapMsg(null);
    setLivePrivacyBlocked(false);
    setLivePrivacyApp(null);
    setLivePrivacyPattern(null);
    setLiveMetrics(null);
    if (liveImgRef.current) liveImgRef.current.removeAttribute('src');
    if (liveVideoRef.current) liveVideoRef.current.srcObject = null;
    if (document.fullscreenElement === liveStageRef.current) {
      void document.exitFullscreen().catch(() => {});
    }
  }, [sendMessage]);

  const startLiveStream = useCallback((employeeId: string) => {
    if (!employeeId) return;
    setLiveError(null);
    setLiveStarting(true);
    setLiveStreaming(false);
    setLivePrivacyBlocked(false);
    setLivePrivacyApp(null);
    setLivePrivacyPattern(null);
    setLiveFrameAt(null);
    setLiveMetrics(null);
    liveResumeRef.current = true;
    if (liveImgRef.current) liveImgRef.current.removeAttribute('src');
    if (liveVideoRef.current) liveVideoRef.current.srcObject = null;
    if (liveStartTimerRef.current) clearTimeout(liveStartTimerRef.current);
    liveStartTimerRef.current = setTimeout(() => {
      setLiveStarting(prev => {
        if (!prev) return prev;
        setLiveError(t('live.startTimeout'));
        return false;
      });
    }, 15000);
    if (liveControllerRef.current) {
      liveControllerRef.current.destroy();
      liveControllerRef.current = null;
    }
    const controller = ensureController();
    const ok = controller.start(employeeId, liveQualityRef.current);
    if (!ok) {
      if (liveStartTimerRef.current) clearTimeout(liveStartTimerRef.current);
      setLiveStarting(false);
      setLiveError(t('live.wsRequired'));
    }
  }, [ensureController, t]);

  const changeLiveQuality = useCallback((mode: LiveViewQualityMode) => {
    setLiveQuality(mode);
    liveQualityRef.current = mode;
    liveControllerRef.current?.setQualityMode(mode);
  }, []);

  const changeLiveFps = useCallback((fps: number) => {
    liveControllerRef.current?.setTargetFps(fps);
  }, []);

  const liveTransportLabel = useCallback((metrics: LiveViewMetrics) => {
    switch (metrics.networkPath) {
      case 'webrtc-p2p-lan':
        return t('live.pathLan');
      case 'webrtc-p2p-internet':
        return t('live.pathInternet');
      case 'webrtc-turn':
        return t('live.pathTurn');
      case 'binary-ws':
        return t('live.pathBinary');
      default:
        if (metrics.transport === 'webrtc') return t('live.pathUnknown');
        if (metrics.transport === 'binary-ws') return t('live.pathBinary');
        return t('live.transportUnknown');
    }
  }, [t]);

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
    try {
      const canvas = document.createElement('canvas');
      const video = liveVideoRef.current;
      const img = liveImgRef.current;
      let w = 0;
      let h = 0;
      if (video && video.videoWidth > 0 && liveMetrics?.transport === 'webrtc') {
        w = video.videoWidth;
        h = video.videoHeight;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas');
        ctx.drawImage(video, 0, 0);
      } else if (img?.src && img.naturalWidth) {
        w = img.naturalWidth;
        h = img.naturalHeight;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas');
        ctx.drawImage(img, 0, 0);
      } else {
        setLiveError(t('live.snapNoFrame'));
        return;
      }
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
  }, [liveMetrics?.transport, t]);

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

  useEffect(() => {
    return subscribeLiveFrames((message) => {
      if (message.type === 'live-view:ended') {
        const sid = message.data?.sessionId;
        if (!liveSessionRef.current || !sid || sid === liveSessionRef.current) {
          liveSessionRef.current = null;
          setLiveStreaming(false);
          setLiveStarting(false);
          if (liveStartTimerRef.current) {
            clearTimeout(liveStartTimerRef.current);
            liveStartTimerRef.current = null;
          }
          liveControllerRef.current?.destroy();
          liveControllerRef.current = null;
          const reason = message.data?.reason;
          if (reason === 'device-disconnect' || reason === 'ws-disconnect') {
            setLiveError(t('live.deviceReconnecting'));
          } else if (reason && reason !== 'admin-stop' && reason !== 'switched') {
            setLiveError(t('live.ended'));
          }
        }
        return;
      }
      if (message.type === 'live-view:signal') {
        const signal = message.data?.signal as LiveViewSignalPayload | undefined;
        if (signal) liveControllerRef.current?.handleSignal(signal);
        return;
      }
      if (message.type === 'live-view:transport') {
        liveControllerRef.current?.handleTransport({
          transport: message.data?.transport,
          state: message.data?.state,
          reason: message.data?.reason,
        });
        return;
      }
      if (message.type !== 'live-view:frame') return;
      const empId = liveEmployeeIdRef.current;
      if (!empId || message.data?.employeeId !== empId) return;
      liveControllerRef.current?.handleLegacyFrame({
        dataBase64: message.data?.dataBase64,
        privacyBlocked: message.data?.privacyBlocked,
        capturedAt: message.data?.capturedAt,
        sessionId: message.data?.sessionId,
      });
      if (message.data?.sessionId) liveSessionRef.current = message.data.sessionId;
      if (message.data?.privacyBlocked) {
        setLivePrivacyPattern(message.data.pattern || null);
        setLivePrivacyApp(
          message.data.windowTitle || message.data.appName || message.data.pattern || null
        );
      }
    });
  }, [subscribeLiveFrames, t]);

  useEffect(() => {
    return subscribeLiveBinary((buffer) => {
      liveControllerRef.current?.handleBinaryFrame(buffer);
    });
  }, [subscribeLiveBinary]);

  // Server ack / errors for start.
  useEffect(() => {
    if (!lastMessage || lastMessage.type !== 'admin:live-view-status') return;
    const data = lastMessage.data || {};
    liveControllerRef.current?.handleStatus(data);
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
    liveResumeRef.current = false;
    stopLiveStream(true);
    setLiveError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveEmployeeId]);

  // If the employee drops offline mid-view, clear the stuck "connecting" UI.
  // When they come back after an offline gap and we still want to watch, resume once.
  useEffect(() => {
    if (!liveEmployeeId) return;
    const online = onlineEmployees.has(liveEmployeeId) || httpOnlineIds.has(liveEmployeeId);
    if (!online) {
      if (liveStreaming || liveStarting || liveResumeRef.current) {
        liveWasOfflineRef.current = true;
        setLiveStreaming(false);
        setLiveStarting(false);
        if (liveStartTimerRef.current) {
          clearTimeout(liveStartTimerRef.current);
          liveStartTimerRef.current = null;
        }
        if (liveResumeRef.current) setLiveError(t('live.deviceReconnecting'));
      }
      return;
    }
    if (
      liveWasOfflineRef.current &&
      liveResumeRef.current &&
      !liveStreaming &&
      !liveStarting &&
      isConnected
    ) {
      liveWasOfflineRef.current = false;
      const timer = setTimeout(() => {
        if (!liveResumeRef.current) return;
        startLiveStream(liveEmployeeId);
      }, 700);
      return () => clearTimeout(timer);
    }
  }, [
    liveEmployeeId,
    onlineEmployees,
    httpOnlineIds,
    liveStreaming,
    liveStarting,
    isConnected,
    startLiveStream,
    t,
  ]);

  useEffect(() => {
    return () => {
      liveResumeRef.current = false;
      stopLiveStream(true);
    };
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
      <div className="tt-page tt-page--wide">
        <PageEmpty
          icon={AlertTriangle}
          title={t('dashboard.failedLoad')}
          hint={error}
          action={
            <button type="button" className="tt-btn tt-btn-primary" onClick={loadData}>
              {t('common.retry')}
            </button>
          }
        />
      </div>
    );
  }

  // Only block the dashboard when the org has no employees yet.
  // Once at least one employee exists (local testing or production), show
  // the live dashboard immediately — don't force the welcome checklist.
  if (employees.length === 0) {
    return (
      <div className="tt-page tt-page--wide">
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
    <div className="tt-page tt-page--wide" style={{ animation: 'tt-rise 0.45s var(--tt-ease) both' }}>
      <PageHero
        icon={LayoutDashboard}
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle')}
        help={t('help.dashboard')}
        action={
          <div role="tablist" aria-label="Dashboard scope" style={styles.scopeTabs}>
            {(['today', 'week', 'all'] as DashboardScope[]).map(s => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={scope === s}
                onClick={() => changeScope(s)}
                style={{
                  ...styles.scopeTab,
                  ...(scope === s ? styles.scopeTabActive : null),
                }}
              >
                {s === 'all' ? t('dashboard.all') : s === 'week' ? t('dashboard.week') : t('dashboard.today')}
              </button>
            ))}
          </div>
        }
      />

      {stats && stats.suspiciousActivityCount > 0 && (
        <div className="tt-error-banner" role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={16} aria-hidden />
          {t('dashboard.suspiciousBanner', { count: stats.suspiciousActivityCount })}
        </div>
      )}

      <div style={styles.grid}>
        <div style={styles.statTray}>
          <div className="tt-stat-grid">
          <StatCard
            title={t('dashboard.teamProductivity')}
            value={`${stats?.averageProductivityScore || 0}%`}
            icon={<BarChart3 size={20} strokeWidth={2.1} />}
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
                icon={<Zap size={20} strokeWidth={2.1} />}
                color={getProductivityColor(util)}
                tooltip={t('help.utilization')}
              />
            );
          })()}
          <StatCard
            title={t('dashboard.focusTime')}
            value={formatDurationSeconds(stats?.focusSecondsToday ?? (stats?.focusTimeMinutes || 0) * 60)}
            icon={<Focus size={20} strokeWidth={2.1} />}
            color="var(--tt-success)"
            tooltip={t('help.focusTime')}
          />
          <StatCard
            title={t('dashboard.idleTime')}
            value={formatDurationSeconds(stats?.distractedSecondsToday ?? (stats?.distractedTimeMinutes || 0) * 60)}
            icon={<Moon size={20} strokeWidth={2.1} />}
            color="var(--tt-danger)"
            tooltip={t('help.idleTime')}
          />
          <StatCard
            title={t('dashboard.suspicious')}
            value={stats?.suspiciousActivityCount || 0}
            icon={<ShieldAlert size={20} strokeWidth={2.1} />}
            color={stats?.suspiciousActivityCount ? 'var(--tt-danger)' : 'var(--tt-text-faint)'}
            tooltip={t('help.suspicious')}
          />
          </div>
        </div>

        {/* Live Activity — pick one employee, then start on-demand screen stream */}
        <PagePanel
          title={t('live.title')}
          headAction={<HelpTip text={t('help.liveActivity')} />}
        >
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
                          {liveStreaming && livePrivacyBlocked
                            ? t('live.privacyBlocked')
                            : liveStreaming
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
                      <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--tt-text-muted)' }}>
                          <span>{t('live.quality')}</span>
                          <select
                            value={
                              liveQuality === 'ultra' && !liveMetrics?.ultraAllowed
                                ? 'high'
                                : liveQuality
                            }
                            onChange={(e) => changeLiveQuality(e.target.value as LiveViewQualityMode)}
                            style={styles.liveQualitySelect}
                            aria-label={t('live.quality')}
                          >
                            <option value="auto">{t('live.qualityAuto')}</option>
                            <option value="low">{t('live.qualityLow')}</option>
                            <option value="medium">{t('live.qualityMedium')}</option>
                            <option value="high">{t('live.qualityHigh')}</option>
                            {liveMetrics?.ultraAllowed && (
                              <option value="ultra">{t('live.qualityUltra')}</option>
                            )}
                          </select>
                        </label>
                        {liveStreaming && liveMetrics && liveMetrics.allowedFps.length > 0 && liveQuality !== 'auto' && (
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--tt-text-muted)' }}>
                            <span>{t('live.fpsTarget')}</span>
                            <select
                              value={String(
                                liveMetrics.targetFps != null &&
                                  liveMetrics.allowedFps.includes(liveMetrics.targetFps)
                                  ? liveMetrics.targetFps
                                  : liveMetrics.allowedFps[
                                      Math.min(
                                        1,
                                        liveMetrics.allowedFps.length - 1
                                      )
                                    ]
                              )}
                              onChange={(e) => changeLiveFps(Number(e.target.value))}
                              style={styles.liveQualitySelect}
                              aria-label={t('live.fpsTarget')}
                            >
                              {liveMetrics.allowedFps.map((f) => (
                                <option key={f} value={f}>
                                  {f}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        {liveStreaming && !livePrivacyBlocked && (
                          <button
                            type="button"
                            onClick={() => captureLiveSnapshot(selected.name)}
                            style={styles.liveGhostBtn}
                            title={t('live.snapTitle')}
                          >
                            <Camera size={14} />
                            {t('live.snap')}
                          </button>
                        )}
                        {liveStreaming && (
                          <button
                            type="button"
                            onClick={() => void toggleLiveFullscreen()}
                            style={styles.liveGhostBtn}
                            title={liveFullscreen ? t('live.exitFullscreen') : t('live.fullscreenTitle')}
                          >
                            {liveFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                            {liveFullscreen ? t('live.exitFullscreen') : t('live.fullscreen')}
                          </button>
                        )}
                        {liveStreaming || liveStarting ? (
                          <button
                            type="button"
                            onClick={() => {
                              liveResumeRef.current = false;
                              stopLiveStream(true);
                            }}
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

                    {(liveStreaming || liveStarting) && liveMetrics && (
                      <div style={styles.liveMetaRow}>
                        <span style={styles.liveChip}>
                          {t('live.transport')}: {liveTransportLabel(liveMetrics)}
                        </span>
                        <span style={styles.liveChip}>
                          {t('live.connection')}: {t(`live.state.${liveMetrics.state}` as 'live.state.connected')}
                        </span>
                        <button
                          type="button"
                          onClick={() => setLiveShowDetails((v) => !v)}
                          style={styles.liveGhostBtn}
                        >
                          {liveShowDetails ? t('live.hideDetails') : t('live.showDetails')}
                        </button>
                      </div>
                    )}
                    {liveShowDetails && liveMetrics && (
                      <div style={styles.liveDetails}>
                        <span>{t('live.latency')}: {liveMetrics.latencyMs != null ? `${Math.round(liveMetrics.latencyMs)} ms` : '—'}</span>
                        <span>
                          {t('live.fps')}:{' '}
                          {liveMetrics.fps != null ? liveMetrics.fps.toFixed(1) : '—'}
                          {liveMetrics.targetFps != null ? ` / ${liveMetrics.targetFps}` : ''}
                        </span>
                        <span>
                          {t('live.resolution')}:{' '}
                          {liveMetrics.width && liveMetrics.height
                            ? `${liveMetrics.width} × ${liveMetrics.height}`
                            : '—'}
                        </span>
                        <span>
                          {t('live.bitrate')}:{' '}
                          {liveMetrics.bitrateKbps != null ? `${liveMetrics.bitrateKbps} kbps` : '—'}
                        </span>
                        <span>{t('live.encodeLevel')}: {liveMetrics.encodeLevel}</span>
                        {(liveMetrics.iceLocalType || liveMetrics.iceRemoteType) && (
                          <span>
                            ICE: {liveMetrics.iceLocalType || '—'} → {liveMetrics.iceRemoteType || '—'}
                          </span>
                        )}
                      </div>
                    )}

                    {liveError && <div style={styles.liveError}>{liveError}</div>}
                    {liveSnapMsg && <div style={styles.liveSnapOk}>{liveSnapMsg}</div>}

                    <div
                      ref={liveStageRef}
                      style={{
                        ...styles.liveScreenStage,
                        ...(liveFullscreen ? styles.liveScreenStageFullscreen : null),
                      }}
                    >
                      <video
                        ref={liveVideoRef}
                        autoPlay
                        playsInline
                        muted
                        style={{
                          ...styles.liveScreenImage,
                          ...(liveFullscreen ? styles.liveScreenImageFullscreen : null),
                          display:
                            liveStreaming &&
                            !livePrivacyBlocked &&
                            liveMetrics?.transport === 'webrtc'
                              ? 'block'
                              : 'none',
                        }}
                      />
                      <img
                        ref={liveImgRef}
                        alt={t('live.screenAlt', { name: selected.name })}
                        style={{
                          ...styles.liveScreenImage,
                          ...(liveFullscreen ? styles.liveScreenImageFullscreen : null),
                          display:
                            liveStreaming &&
                            !livePrivacyBlocked &&
                            liveMetrics?.transport !== 'webrtc'
                              ? 'block'
                              : 'none',
                        }}
                      />
                      {liveStreaming && livePrivacyBlocked && (
                        <div style={styles.liveEmptyScreen}>
                          <EyeOff size={36} color="var(--tt-text-faint)" />
                          <p style={{ margin: '12px 0 4px', fontWeight: 600 }}>{t('live.privacyBlocked')}</p>
                          <p style={{ margin: 0, fontSize: 13, color: 'var(--tt-text-muted)', maxWidth: 420, textAlign: 'center', lineHeight: 1.5 }}>
                            {t('live.privacyBlockedHint', {
                              rule: livePrivacyPattern || livePrivacyApp || '—',
                            })}
                          </p>
                          {livePrivacyApp && livePrivacyPattern && livePrivacyApp !== livePrivacyPattern && (
                            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--tt-text-faint)', maxWidth: 420, textAlign: 'center' }}>
                              {t('live.privacyBlockedWindow', { window: livePrivacyApp })}
                            </p>
                          )}
                          <button
                            type="button"
                            onClick={() => navigate('/privacy')}
                            style={styles.livePrivacyLink}
                          >
                            {t('live.privacyManage')}
                          </button>
                        </div>
                      )}
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
                            {!livePrivacyBlocked && (
                              <button
                                type="button"
                                onClick={() => captureLiveSnapshot(selected.name)}
                                style={styles.liveOverlayBtn}
                                title={t('live.snapTitle')}
                              >
                                <Camera size={16} />
                              </button>
                            )}
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
        </PagePanel>

        {/* Time Breakdown */}
        <PagePanel
          title={`Time Breakdown (${scope === 'all' ? 'All Time' : scope === 'week' ? 'This Week' : 'Today'})`}
          headAction={<HelpTip text={t('help.timeBreakdown')} />}
        >
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
        </PagePanel>

        {/* Suspicious Activity Log */}
        {stats?.recentActivities?.some(a => a.isSuspicious) && (
          <PagePanel
            title="Suspicious Activity Log"
            headAction={<HelpTip text={t('help.suspiciousLog')} />}
            className="dashboard-suspicious-panel"
          >
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
          </PagePanel>
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
        <div style={styles.statValue}>{value}</div>
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

const styles: { [key: string]: React.CSSProperties | any } = {
  loading: {
    padding: '40px',
    textAlign: 'center',
    color: 'var(--tt-text-muted)'
  },
  scopeTabs: {
    display: 'inline-flex',
    gap: 4,
    padding: 4,
    borderRadius: 999,
    backgroundColor: 'var(--tt-surface-muted)',
    border: '1px solid var(--tt-border)',
  },
  scopeTab: {
    padding: '9px 16px',
    border: 'none',
    borderRadius: 999,
    backgroundColor: 'transparent',
    color: 'var(--tt-text-muted)',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 650,
    transition: 'background 140ms ease, color 140ms ease',
  },
  scopeTabActive: {
    backgroundColor: 'var(--tt-ink)',
    color: '#fff',
    boxShadow: 'var(--tt-shadow-sm)',
  },
  statTray: {
    background: 'var(--tt-surface-muted)',
    border: '1px solid var(--tt-border)',
    borderRadius: 20,
    padding: 14,
  },
  statCard: {
    backgroundColor: 'var(--tt-surface)',
    border: '1px solid var(--tt-border)',
    borderRadius: 16,
    boxShadow: 'none',
    padding: '18px 18px 18px 20px',
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    borderLeft: '4px solid var(--tt-ink)',
    minHeight: 92,
  },
  grid: {
    display: 'grid',
    gap: 20,
  },
  statIcon: (color: string) => ({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color,
    backgroundColor: 'transparent',
    padding: 0,
    borderRadius: 0,
    flexShrink: 0,
  }),
  statValue: {
    fontSize: 28,
    fontWeight: 700,
    fontFamily: 'var(--tt-font-display)',
    letterSpacing: '-0.03em',
    color: 'var(--tt-text)',
    lineHeight: 1.15,
  },
  statTitle: {
    fontSize: 13,
    color: 'var(--tt-text-muted)',
    fontWeight: 550,
    marginTop: 4,
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
    fontSize: 10,
    fontWeight: 700,
    color: 'var(--tt-success)',
    backgroundColor: 'var(--tt-success-soft)',
    padding: '4px 8px',
    borderRadius: 999,
  },
  offlineBadge: {
    fontSize: 10,
    fontWeight: 700,
    color: 'var(--tt-text-faint)',
    backgroundColor: 'var(--tt-surface-muted)',
    padding: '4px 8px',
    borderRadius: 999,
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
    padding: '12px 14px',
    borderRadius: 14,
    border: selected ? '1px solid var(--tt-ink)' : '1px solid var(--tt-border)',
    backgroundColor: selected ? 'var(--tt-surface-muted)' : 'var(--tt-surface)',
    cursor: 'pointer',
    opacity: online || selected ? 1 : 0.72,
    boxShadow: selected ? 'var(--tt-shadow-sm)' : 'none',
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
    borderRadius: 16,
    backgroundColor: 'var(--tt-surface-muted)',
    padding: 16,
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
  liveQualitySelect: {
    padding: '6px 8px',
    borderRadius: 8,
    border: '1px solid var(--tt-border-strong)',
    background: 'var(--tt-surface)',
    color: 'var(--tt-text)',
    fontSize: 12,
    fontWeight: 600,
  },
  liveMetaRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
    marginBottom: 8,
  },
  liveChip: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 8px',
    borderRadius: 999,
    border: '1px solid var(--tt-border)',
    background: 'var(--tt-surface-2, var(--tt-surface))',
    fontSize: 11,
    color: 'var(--tt-text-muted)',
    fontWeight: 600,
  },
  liveDetails: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 8,
    fontSize: 11,
    color: 'var(--tt-text-muted)',
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
  livePrivacyLink: {
    marginTop: 14,
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--tt-teal)',
    background: 'transparent',
    border: '1px solid var(--tt-teal)',
    borderRadius: 6,
    cursor: 'pointer',
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
  <div className="tt-page tt-page--wide" style={skeletonStyles.container}>
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

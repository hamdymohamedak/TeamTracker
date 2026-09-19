import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Camera,
  EyeOff,
  Maximize2,
  Minimize2,
  Monitor,
  Play,
  Square,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { useI18n } from '@/contexts/I18nContext';
import { PagePanel } from '@/components/PageHero';
import { HelpTip } from '@/components/HelpTip';
import {
  LiveViewSessionController,
  type LiveViewMetrics,
} from '@/live-view/LiveViewSessionController';
import type { LiveViewQualityMode } from '../../../../../shared/live-view/quality';
import type { LiveViewSignalPayload } from '../../../../../shared/live-view/protocol';
import type { Employee } from '../../../../../shared-types';
import { formatDurationSeconds } from '../../../../../shared-types';
import type { EmployeeActivity } from '@/features/dashboard/types';
import { liveViewStyles as styles } from '../live-view.styles';

export interface LiveViewPanelProps {
  employees: Employee[];
  employeeActivity: EmployeeActivity[];
}

function formatRelativeAgo(
  iso: string | null | undefined,
  t: (key: string, vars?: Record<string, string | number>) => string
): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const diffSec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (diffSec < 45) return t('live.agoJustNow');
  if (diffSec < 3600) return t('live.agoMinutes', { n: Math.max(1, Math.round(diffSec / 60)) });
  if (diffSec < 86400) return t('live.agoHours', { n: Math.max(1, Math.round(diffSec / 3600)) });
  return t('live.agoDays', { n: Math.max(1, Math.round(diffSec / 86400)) });
}

function compactEmployeeStats(empActivity: EmployeeActivity | undefined, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (!empActivity) return '';
  const parts: string[] = [];
  if (typeof empActivity.productivityScore === 'number') {
    parts.push(t('live.score', { score: empActivity.productivityScore }));
  }
  if (typeof empActivity.hoursToday === 'number') {
    parts.push(t('live.hoursToday', { hours: empActivity.hoursToday }));
  }
  if (empActivity.suspiciousActivityCount > 0) {
    parts.push(t('live.suspiciousShort', { count: empActivity.suspiciousActivityCount }));
  }
  return parts.join(' · ');
}

export const LiveViewPanel: React.FC<LiveViewPanelProps> = ({ employees, employeeActivity }) => {
  const navigate = useNavigate();
  const { t } = useI18n();
  const {
    onlineEmployees,
    lastMessage,
    sendMessage,
    subscribeLiveFrames,
    subscribeLiveBinary,
    isConnected,
  } = useWebSocket();

  // ── HTTP online polling (supplements WS presence) ─────────────────────────
  const [httpOnlineIds, setHttpOnlineIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    const refreshOnline = async () => {
      try {
        const res = await api.get('/api/employees/online');
        if (cancelled || !res?.success) return;
        setHttpOnlineIds(
          new Set(
            (res.data || [])
              .map((e: { employeeId: string }) => e.employeeId)
              .filter(Boolean),
          ),
        );
      } catch { /* ignore */ }
    };
    void refreshOnline();
    const id = setInterval(() => void refreshOnline(), 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const isEmployeeOnline = (id: string) =>
    onlineEmployees.has(id) || httpOnlineIds.has(id);

  // ── Live-view state ───────────────────────────────────────────────────────
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
  /** Fresh focused-app labels from the device during an active live session. */
  const [liveContextByEmployee, setLiveContextByEmployee] = useState<Record<string, string>>({});

  // ── Refs ──────────────────────────────────────────────────────────────────
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

  // ── Controller factory ────────────────────────────────────────────────────
  const ensureController = useCallback(() => {
    if (liveControllerRef.current) return liveControllerRef.current;
    const controller = new LiveViewSessionController({
      sendJson: (message) => sendMessage(message),
      onMetrics: (m) => {
        setLiveMetrics(m);
        if (m.qualityMode && m.qualityMode !== liveQualityRef.current) {
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

  // ── Stop ──────────────────────────────────────────────────────────────────
  const stopLiveStream = useCallback(
    (notifyServer = true) => {
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
    },
    [sendMessage],
  );

  // ── Start ─────────────────────────────────────────────────────────────────
  const startLiveStream = useCallback(
    (employeeId: string) => {
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
        setLiveStarting((prev) => {
          if (!prev) return prev;
          setLiveError(t('live.startTimeout'));
          return false;
        });
      }, 15_000);
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
    },
    [ensureController, t],
  );

  // ── Quality / FPS ─────────────────────────────────────────────────────────
  const changeLiveQuality = useCallback((mode: LiveViewQualityMode) => {
    setLiveQuality(mode);
    liveQualityRef.current = mode;
    liveControllerRef.current?.setQualityMode(mode);
  }, []);

  const changeLiveFps = useCallback((fps: number) => {
    liveControllerRef.current?.setTargetFps(fps);
  }, []);

  // ── Transport label ───────────────────────────────────────────────────────
  const liveTransportLabel = useCallback(
    (metrics: LiveViewMetrics) => {
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
    },
    [t],
  );

  // ── Fullscreen ────────────────────────────────────────────────────────────
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

  // ── Snapshot ──────────────────────────────────────────────────────────────
  const captureLiveSnapshot = useCallback(
    (employeeName: string) => {
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
    },
    [liveMetrics?.transport, t],
  );

  // ── Effects ───────────────────────────────────────────────────────────────

  // Fullscreen change listener + cleanup
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

  // WS live-view frame messages
  useEffect(() => {
    return subscribeLiveFrames((message) => {
      if (message.type === 'live-view:ended') {
        const sid = message.data?.sessionId;
        const endedEmp = message.data?.employeeId as string | undefined;
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
        if (endedEmp) {
          setLiveContextByEmployee((prev) => {
            if (!(endedEmp in prev)) return prev;
            const next = { ...prev };
            delete next[endedEmp];
            return next;
          });
        } else if (liveEmployeeIdRef.current) {
          const empId = liveEmployeeIdRef.current;
          setLiveContextByEmployee((prev) => {
            if (!(empId in prev)) return prev;
            const next = { ...prev };
            delete next[empId];
            return next;
          });
        }
        return;
      }
      if (message.type === 'live-view:context') {
        const empId = message.data?.employeeId as string | undefined;
        if (!empId) return;
        const label =
          (typeof message.data?.label === 'string' && message.data.label) ||
          (typeof message.data?.appName === 'string' && message.data.appName) ||
          null;
        if (!label) return;
        setLiveContextByEmployee((prev) =>
          prev[empId] === label ? prev : { ...prev, [empId]: label }
        );
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
          message.data.windowTitle || message.data.appName || message.data.pattern || null,
        );
      }
    });
  }, [subscribeLiveFrames, t]);

  // WS binary frames
  useEffect(() => {
    return subscribeLiveBinary((buffer) => {
      liveControllerRef.current?.handleBinaryFrame(buffer);
    });
  }, [subscribeLiveBinary]);

  // Server ack / errors for start
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

  // Stop stream when switching employee
  useEffect(() => {
    liveResumeRef.current = false;
    stopLiveStream(true);
    setLiveError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveEmployeeId]);

  // Handle employee going offline / coming back online
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      liveResumeRef.current = false;
      stopLiveStream(true);
    };
  }, [stopLiveStream]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <PagePanel
      title={t('live.title')}
      headAction={<HelpTip text={t('help.liveActivity')} />}
    >
      <div style={styles.liveLayout as React.CSSProperties} className="dashboard-live-layout">
        {/* Employee list */}
        <div
          style={styles.liveEmployeeList as React.CSSProperties}
          role="listbox"
          aria-label={t('live.employees')}
        >
          {employees.length === 0 ? (
            <p style={styles.emptyText as React.CSSProperties}>{t('live.noEmployees')}</p>
          ) : (
            employees.map((emp) => {
              const empActivity = employeeActivity.find((e) => e.employeeId === emp.id);
              const online = isEmployeeOnline(emp.id);
              const selected = liveEmployeeId === emp.id;
              const activityLabel =
                liveContextByEmployee[emp.id] ||
                empActivity?.currentActivity ||
                (online ? t('live.online') : t('live.offline'));
              const statsLine = compactEmployeeStats(empActivity, t);
              return (
                <button
                  key={emp.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => setLiveEmployeeId(emp.id)}
                  style={(styles.liveEmployeeRow as (s: boolean, o: boolean) => React.CSSProperties)(selected, online)}
                >
                  <span style={(styles.statusIndicator as (o: boolean) => React.CSSProperties)(online)} />
                  <span style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                    <span style={styles.liveEmployeeName as React.CSSProperties}>{emp.name}</span>
                    <span style={styles.liveEmployeeMeta as React.CSSProperties}>
                      {activityLabel}
                    </span>
                    {statsLine ? (
                      <span
                        style={{
                          ...styles.liveEmployeeMeta as React.CSSProperties,
                          fontSize: 10,
                          opacity: 0.85,
                          marginTop: 1,
                        }}
                      >
                        {statsLine}
                      </span>
                    ) : null}
                  </span>
                  <span style={online ? (styles.onlineBadge as React.CSSProperties) : (styles.offlineBadge as React.CSSProperties)}>
                    {online ? t('live.onlineBadge') : t('live.offlineBadge')}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Screen panel */}
        <div style={styles.liveScreenPanel as React.CSSProperties}>
          {(() => {
            const selected = employees.find((e) => e.id === liveEmployeeId);
            const empActivity = employeeActivity.find((e) => e.employeeId === liveEmployeeId);
            const online = liveEmployeeId ? isEmployeeOnline(liveEmployeeId) : false;

            if (!selected) {
              return (
                <div style={styles.liveEmptyScreen as React.CSSProperties}>
                  <Monitor size={36} color="var(--tt-text-faint)" />
                  <p style={{ margin: '12px 0 4px', fontWeight: 600 }}>{t('live.pickEmployee')}</p>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--tt-text-muted)', maxWidth: 360, textAlign: 'center' }}>
                    {t('live.pickHint')}
                  </p>
                </div>
              );
            }

            const canStart = online && isConnected && !liveStarting && !liveStreaming;
            const presence = liveEmployeeId ? onlineEmployees.get(liveEmployeeId) : undefined;
            const lastSeenAgo = formatRelativeAgo(presence?.lastSeen, t);
            const lastActivityAgo = formatRelativeAgo(empActivity?.lastActivityAt, t);

            return (
              <>
                {/* Header row */}
                <div style={styles.liveScreenHeader as React.CSSProperties}>
                  <div style={{ minWidth: 0 }}>
                    <div style={styles.liveScreenTitle as React.CSSProperties}>{selected.name}</div>
                    <div style={styles.liveScreenSub as React.CSSProperties}>
                      {liveStreaming && livePrivacyBlocked
                        ? t('live.privacyBlocked')
                        : liveStreaming
                          ? (liveContextByEmployee[liveEmployeeId] || t('live.streaming'))
                          : liveStarting
                            ? t('live.connecting')
                            : (liveContextByEmployee[liveEmployeeId] || empActivity?.currentActivity)
                              ? `${liveContextByEmployee[liveEmployeeId] || empActivity?.currentActivity}${empActivity?.currentCategory && !liveContextByEmployee[liveEmployeeId] ? ` · ${empActivity.currentCategory}` : ''}`
                              : online
                                ? t('live.ready')
                                : t('live.trackerOffline')}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '6px 12px',
                        marginTop: 6,
                        fontSize: 11,
                        color: 'var(--tt-text-muted)',
                      }}
                    >
                      {online && lastSeenAgo ? (
                        <span title={t('live.lastSeenTracker')}>
                          {t('live.lastSeenAgo', { ago: lastSeenAgo })}
                        </span>
                      ) : lastActivityAgo ? (
                        <span>{t('live.lastActivity', { ago: lastActivityAgo })}</span>
                      ) : null}
                      {empActivity?.isIdle ? (
                        <span style={{ color: 'var(--tt-amber)' }}>{t('live.currentlyIdle')}</span>
                      ) : null}
                      {typeof empActivity?.productivityScore === 'number' ? (
                        <span>{t('live.score', { score: empActivity.productivityScore })}</span>
                      ) : null}
                      {typeof empActivity?.hoursToday === 'number' ? (
                        <span>{t('live.hoursToday', { hours: empActivity.hoursToday })}</span>
                      ) : null}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
                    {/* Quality selector */}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--tt-text-muted)' }}>
                      <span>{t('live.quality')}</span>
                      <select
                        value={
                          liveQuality === 'ultra' && !liveMetrics?.ultraAllowed
                            ? 'high'
                            : liveQuality
                        }
                        onChange={(e) => changeLiveQuality(e.target.value as LiveViewQualityMode)}
                        style={styles.liveQualitySelect as React.CSSProperties}
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

                    {/* FPS selector */}
                    {liveStreaming && liveMetrics && liveMetrics.allowedFps.length > 0 && liveQuality !== 'auto' && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--tt-text-muted)' }}>
                        <span>{t('live.fpsTarget')}</span>
                        <select
                          value={String(
                            liveMetrics.targetFps != null &&
                              liveMetrics.allowedFps.includes(liveMetrics.targetFps)
                              ? liveMetrics.targetFps
                              : liveMetrics.allowedFps[Math.min(1, liveMetrics.allowedFps.length - 1)],
                          )}
                          onChange={(e) => changeLiveFps(Number(e.target.value))}
                          style={styles.liveQualitySelect as React.CSSProperties}
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

                    {/* Snapshot button */}
                    {liveStreaming && !livePrivacyBlocked && (
                      <button
                        type="button"
                        onClick={() => captureLiveSnapshot(selected.name)}
                        style={styles.liveGhostBtn as React.CSSProperties}
                        title={t('live.snapTitle')}
                      >
                        <Camera size={14} />
                        {t('live.snap')}
                      </button>
                    )}

                    {/* Fullscreen button */}
                    {liveStreaming && (
                      <button
                        type="button"
                        onClick={() => void toggleLiveFullscreen()}
                        style={styles.liveGhostBtn as React.CSSProperties}
                        title={liveFullscreen ? t('live.exitFullscreen') : t('live.fullscreenTitle')}
                      >
                        {liveFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                        {liveFullscreen ? t('live.exitFullscreen') : t('live.fullscreen')}
                      </button>
                    )}

                    {/* Stop / Start button */}
                    {liveStreaming || liveStarting ? (
                      <button
                        type="button"
                        onClick={() => {
                          liveResumeRef.current = false;
                          stopLiveStream(true);
                        }}
                        style={styles.liveGhostBtn as React.CSSProperties}
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
                          ...(styles.livePrimaryBtn as React.CSSProperties),
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

                {/* Employee monitoring metrics (today) */}
                {empActivity && (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 8,
                      padding: '8px 12px',
                      borderBottom: '1px solid var(--tt-border)',
                      background: 'var(--tt-surface-muted)',
                      fontSize: 11,
                      color: 'var(--tt-text-muted)',
                    }}
                    aria-label={t('live.metricsToday')}
                  >
                    <span style={{ fontWeight: 600, color: 'var(--tt-text)' }}>
                      {t('live.metricsToday')}
                    </span>
                    <span>
                      {t('live.metricProductive', {
                        duration: formatDurationSeconds(empActivity.productiveSeconds ?? 0),
                      })}
                    </span>
                    <span>
                      {t('live.metricUnproductive', {
                        duration: formatDurationSeconds(empActivity.unproductiveSeconds ?? 0),
                      })}
                    </span>
                    <span>
                      {t('live.metricIdle', {
                        duration: formatDurationSeconds(empActivity.idleSeconds ?? 0),
                      })}
                    </span>
                    {(empActivity.privacyMatchedSeconds ?? 0) > 0 && (
                      <span title={t('live.metricPrivacyHint')}>
                        {t('live.metricPrivacy', {
                          duration: formatDurationSeconds(empActivity.privacyMatchedSeconds ?? 0),
                        })}
                      </span>
                    )}
                    {empActivity.topAppName && (
                      <span>
                        {t('live.metricTopApp', {
                          app: empActivity.topAppName,
                          duration: formatDurationSeconds(empActivity.topAppSeconds ?? 0),
                        })}
                      </span>
                    )}
                    {(empActivity.outsideHoursSeconds ?? 0) > 0 && (
                      <span>
                        {t('live.outsideHours', {
                          duration: formatDurationSeconds(empActivity.outsideHoursSeconds ?? 0),
                        })}
                      </span>
                    )}
                  </div>
                )}

                {/* Metrics row */}
                {(liveStreaming || liveStarting) && liveMetrics && (
                  <div style={styles.liveMetaRow as React.CSSProperties}>
                    <span style={styles.liveChip as React.CSSProperties}>
                      {t('live.transport')}: {liveTransportLabel(liveMetrics)}
                    </span>
                    <span style={styles.liveChip as React.CSSProperties}>
                      {t('live.connection')}: {t(`live.state.${liveMetrics.state}` as 'live.state.connected')}
                    </span>
                    <button
                      type="button"
                      onClick={() => setLiveShowDetails((v) => !v)}
                      style={styles.liveGhostBtn as React.CSSProperties}
                    >
                      {liveShowDetails ? t('live.hideDetails') : t('live.showDetails')}
                    </button>
                  </div>
                )}

                {/* Detailed metrics */}
                {liveShowDetails && liveMetrics && (
                  <div style={styles.liveDetails as React.CSSProperties}>
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

                {liveError && <div style={styles.liveError as React.CSSProperties}>{liveError}</div>}
                {liveSnapMsg && <div style={styles.liveSnapOk as React.CSSProperties}>{liveSnapMsg}</div>}

                {/* Screen stage */}
                <div
                  ref={liveStageRef}
                  style={{
                    ...(styles.liveScreenStage as React.CSSProperties),
                    ...(liveFullscreen ? (styles.liveScreenStageFullscreen as React.CSSProperties) : null),
                  }}
                >
                  {/* WebRTC video */}
                  <video
                    ref={liveVideoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{
                      ...(styles.liveScreenImage as React.CSSProperties),
                      ...(liveFullscreen ? (styles.liveScreenImageFullscreen as React.CSSProperties) : null),
                      display:
                        liveStreaming && !livePrivacyBlocked && liveMetrics?.transport === 'webrtc'
                          ? 'block'
                          : 'none',
                    }}
                  />

                  {/* Binary-WS image */}
                  <img
                    ref={liveImgRef}
                    alt={t('live.screenAlt', { name: selected.name })}
                    style={{
                      ...(styles.liveScreenImage as React.CSSProperties),
                      ...(liveFullscreen ? (styles.liveScreenImageFullscreen as React.CSSProperties) : null),
                      display:
                        liveStreaming && !livePrivacyBlocked && liveMetrics?.transport !== 'webrtc'
                          ? 'block'
                          : 'none',
                    }}
                  />

                  {/* Privacy block overlay */}
                  {liveStreaming && livePrivacyBlocked && (
                    <div style={styles.liveEmptyScreen as React.CSSProperties}>
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
                        style={styles.livePrivacyLink as React.CSSProperties}
                      >
                        {t('live.privacyManage')}
                      </button>
                    </div>
                  )}

                  {/* Idle / not started overlay */}
                  {!liveStreaming && (
                    <div style={styles.liveEmptyScreen as React.CSSProperties}>
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

                  {/* Live overlay bar */}
                  {liveStreaming && (
                    <div style={styles.liveOverlayBar as React.CSSProperties}>
                      <span style={styles.liveOverlayLive as React.CSSProperties}>
                        {t('live.liveBadge')}
                        {liveFrameAt ? ` · ${new Date(liveFrameAt).toLocaleTimeString()}` : ''}
                      </span>
                      <span style={{ display: 'flex', gap: 8 }}>
                        {!livePrivacyBlocked && (
                          <button
                            type="button"
                            onClick={() => captureLiveSnapshot(selected.name)}
                            style={styles.liveOverlayBtn as React.CSSProperties}
                            title={t('live.snapTitle')}
                          >
                            <Camera size={16} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void toggleLiveFullscreen()}
                          style={styles.liveOverlayBtn as React.CSSProperties}
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
  );
};

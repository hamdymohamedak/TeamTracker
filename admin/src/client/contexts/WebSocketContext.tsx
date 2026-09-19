import React, { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { useAuth } from './AuthContext';

const TOKEN_KEY = 'teamtracker_token';

type LiveFrameHandler = (message: {
  type: string;
  data: {
    sessionId?: string;
    employeeId?: string;
    mimeType?: string;
    dataBase64?: string;
    capturedAt?: string;
    reason?: string;
    privacyBlocked?: boolean;
    appName?: string;
    windowTitle?: string;
    pattern?: string;
    label?: string;
    signal?: unknown;
    transport?: string;
    state?: string;
  };
}) => void;

type LiveBinaryHandler = (buffer: ArrayBuffer) => void;

interface WebSocketContextType {
  isConnected: boolean;
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
  lastMessage: any;
  onlineEmployees: Map<string, { name: string; lastSeen: string; currentTask?: string }>;
  recentActivity: Array<{
    type: string;
    employeeName: string;
    message: string;
    timestamp: string;
  }>;
  reconnect: () => void;
  sendMessage: (message: Record<string, unknown>) => boolean;
  /** High-frequency live frames — do not go through React state. */
  subscribeLiveFrames: (handler: LiveFrameHandler) => () => void;
  /** Binary TLV1 live frames. */
  subscribeLiveBinary: (handler: LiveBinaryHandler) => () => void;
}

const WebSocketContext = createContext<WebSocketContextType>({
  isConnected: false,
  connectionStatus: 'disconnected',
  lastMessage: null,
  onlineEmployees: new Map(),
  recentActivity: [],
  reconnect: () => {},
  sendMessage: () => false,
  subscribeLiveFrames: () => () => {},
  subscribeLiveBinary: () => () => {},
});

export const useWebSocket = () => useContext(WebSocketContext);

interface WebSocketProviderProps {
  children: ReactNode;
}

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [lastMessage, setLastMessage] = useState<any>(null);
  const [onlineEmployees, setOnlineEmployees] = useState<Map<string, any>>(new Map());
  const [recentActivity, setRecentActivity] = useState<Array<any>>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const isMountedRef = useRef(true);
  const intentionalCloseRef = useRef(false);
  const liveFrameHandlersRef = useRef(new Set<LiveFrameHandler>());
  const liveBinaryHandlersRef = useRef(new Set<LiveBinaryHandler>());

  const addActivity = useCallback((type: string, employeeName: string, message: string, timestamp: string) => {
    if (!isMountedRef.current) return;
    setRecentActivity(prev => [
      { type, employeeName, message, timestamp },
      ...prev.slice(0, 49)
    ]);
  }, []);

  const handleMessage = useCallback((message: any) => {
    const timestamp = new Date().toISOString();

    // Hot path — skip React state for frames / signals / transport.
    if (
      message.type === 'live-view:frame' ||
      message.type === 'live-view:ended' ||
      message.type === 'live-view:signal' ||
      message.type === 'live-view:transport' ||
      message.type === 'live-view:context'
    ) {
      liveFrameHandlersRef.current.forEach(fn => {
        try { fn(message); } catch { /* ignore */ }
      });
      if (message.type === 'live-view:ended' || message.type === 'live-view:transport') {
        setLastMessage(message);
      }
      return;
    }

    switch (message.type) {
      case 'employee:online':
        setOnlineEmployees(prev => {
          const next = new Map(prev);
          next.set(message.data.employeeId, {
            name: message.data.employeeName,
            lastSeen: message.data.timestamp || timestamp
          });
          return next;
        });
        addActivity('online', message.data.employeeName, 'came online', timestamp);
        break;

      case 'presence:snapshot': {
        const list = Array.isArray(message.data?.employees) ? message.data.employees : [];
        const next = new Map<string, { name: string; lastSeen: string }>();
        for (const emp of list) {
          if (!emp?.employeeId) continue;
          next.set(emp.employeeId, {
            name: emp.employeeName || 'Employee',
            lastSeen: emp.timestamp || timestamp,
          });
        }
        setOnlineEmployees(next);
        break;
      }

      case 'employee:offline':
        setOnlineEmployees(prev => {
          const next = new Map(prev);
          next.delete(message.data.employeeId);
          return next;
        });
        addActivity('offline', message.data.employeeName, 'went offline', timestamp);
        break;

      case 'time-entry:started':
        setOnlineEmployees(prev => {
          const next = new Map(prev);
          const emp = next.get(message.data.employeeId);
          if (emp) {
            emp.currentTask = message.data.entry?.description || 'Working';
            next.set(message.data.employeeId, emp);
          }
          return next;
        });
        addActivity('tracking', message.data.employeeName, `started tracking: ${message.data.entry?.description || 'New task'}`, timestamp);
        break;

      case 'time-entry:stopped': {
        const duration = message.data.entry?.duration
          ? `${Math.round(message.data.entry.duration / 60)} min`
          : 'some time';
        addActivity('stopped', message.data.employeeName, `stopped tracking (${duration})`, timestamp);
        break;
      }

      case 'sync:completed':
        addActivity('sync', message.data.employeeName, `synced ${message.data.count} entries`, timestamp);
        break;

      case 'screenshot:new':
        addActivity(
          'screenshot',
          message.data.employeeName || message.data.employeeId || 'Employee',
          message.data.trigger === 'on_demand' ? 'sent an on-demand screenshot' : 'sent a screenshot',
          timestamp
        );
        break;

      case 'admin:live-view-status':
        setLastMessage(message);
        break;
    }
  }, [addActivity]);

  const connect = useCallback(() => {
    if (!isMountedRef.current) return;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      intentionalCloseRef.current = true;
      try { wsRef.current.close(); } catch { /* ignore */ }
      wsRef.current = null;
      intentionalCloseRef.current = false;
    }

    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setConnectionStatus('disconnected');
      setIsConnected(false);
      return;
    }

    setConnectionStatus('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      if (!isMountedRef.current) {
        ws.close();
        return;
      }
      setIsConnected(true);
      setConnectionStatus('connected');
      reconnectAttemptRef.current = 0;

      ws.send(JSON.stringify({
        type: 'register',
        employeeName: 'Administrator',
      }));
    };

    ws.onmessage = (event) => {
      if (!isMountedRef.current) return;
      if (event.data instanceof ArrayBuffer) {
        liveBinaryHandlersRef.current.forEach((fn) => {
          try { fn(event.data as ArrayBuffer); } catch { /* ignore */ }
        });
        return;
      }
      try {
        const message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
        if (
          message.type !== 'live-view:frame' &&
          message.type !== 'live-view:signal' &&
          message.type !== 'live-view:context'
        ) {
          setLastMessage(message);
        }
        handleMessage(message);
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    };

    ws.onclose = () => {
      if (!isMountedRef.current) return;
      if (wsRef.current === ws) wsRef.current = null;

      setIsConnected(false);
      setConnectionStatus('disconnected');

      if (intentionalCloseRef.current) return;

      const attempt = reconnectAttemptRef.current;
      if (attempt >= 10) return;

      const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
      reconnectAttemptRef.current = attempt + 1;
      reconnectTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) connect();
      }, delay);
    };

    ws.onerror = () => {
      // onclose will handle reconnect
    };
  }, [handleMessage]);

  useEffect(() => {
    isMountedRef.current = true;

    if (isLoading) return;

    if (!isAuthenticated) {
      intentionalCloseRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* ignore */ }
        wsRef.current = null;
      }
      setIsConnected(false);
      setConnectionStatus('disconnected');
      setOnlineEmployees(new Map());
      intentionalCloseRef.current = false;
      return;
    }

    reconnectAttemptRef.current = 0;
    connect();

    return () => {
      isMountedRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        intentionalCloseRef.current = true;
        try { wsRef.current.close(); } catch { /* ignore */ }
        wsRef.current = null;
      }
    };
  }, [isAuthenticated, isLoading, connect]);

  const reconnect = useCallback(() => {
    reconnectAttemptRef.current = 0;
    connect();
  }, [connect]);

  const sendMessage = useCallback((message: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }, []);

  const subscribeLiveFrames = useCallback((handler: LiveFrameHandler) => {
    liveFrameHandlersRef.current.add(handler);
    return () => {
      liveFrameHandlersRef.current.delete(handler);
    };
  }, []);

  const subscribeLiveBinary = useCallback((handler: LiveBinaryHandler) => {
    liveBinaryHandlersRef.current.add(handler);
    return () => {
      liveBinaryHandlersRef.current.delete(handler);
    };
  }, []);

  return (
    <WebSocketContext.Provider value={{
      isConnected,
      connectionStatus,
      lastMessage,
      onlineEmployees,
      recentActivity,
      reconnect,
      sendMessage,
      subscribeLiveFrames,
      subscribeLiveBinary,
    }}>
      {children}
    </WebSocketContext.Provider>
  );
};

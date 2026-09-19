/**
 * Live View WebSocket control / signaling message type constants.
 */

export const LV_MSG = {
  ADMIN_START: 'admin:live-view-start',
  ADMIN_STOP: 'admin:live-view-stop',
  ADMIN_QUALITY: 'admin:live-view-quality',
  ADMIN_STATUS: 'admin:live-view-status',
  ADMIN_SIGNAL: 'admin:live-view-signal',

  COMMAND_START: 'command:live-view-start',
  COMMAND_STOP: 'command:live-view-stop',
  COMMAND_QUALITY: 'command:live-view-quality',
  COMMAND_SIGNAL: 'command:live-view-signal',

  /** Device → server → admin (JSON control, not media). */
  SIGNAL: 'live-view:signal',
  TRANSPORT: 'live-view:transport',
  ENDED: 'live-view:ended',
  /** Fresh focused app/title while a live session is active. */
  CONTEXT: 'live-view:context',
  /** Legacy Base64 JSON frames — deprecated; binary is default. */
  FRAME_JSON: 'live-view:frame',
} as const;

export type LiveViewSignalType =
  | 'offer'
  | 'answer'
  | 'ice'
  | 'renegotiate'
  | 'state'
  | 'fallback';

export interface LiveViewIceCandidateInit {
  candidate?: string | null;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface LiveViewSignalPayload {
  type: LiveViewSignalType;
  sdp?: string;
  candidate?: LiveViewIceCandidateInit | null;
  state?: string;
  reason?: string;
}

export interface LiveViewIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface LiveViewStartOptions {
  quality?: string;
  webrtcEnabled?: boolean;
  wsFallbackEnabled?: boolean;
  maxFrameBytes?: number;
  maxFps?: number;
  minFps?: number;
  iceServers?: LiveViewIceServer[];
  autoConfig?: Record<string, number>;
  profileConfig?: Record<string, number>;
}

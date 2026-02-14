export type ApiStatus = 'connected' | 'degraded' | 'offline';
export type WsStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
export type AppMode = 'judge' | 'debug' | 'clinician' | 'carier';

export type Maybe<T> = T | null;

export interface MergedMetrics {
  steps?: number | null;
  tiltDeg?: number | null;
  reliance?: number | null;
  balance?: number | null;
  fallSuspected?: boolean;
}

export interface MergedState {
  residentId: string;
  ts: number;
  walker?: Record<string, unknown> | null;
  vision?: Record<string, unknown> | null;
  metrics: MergedMetrics;
}

export interface EventLogEntry {
  id: string;
  time: string;
  residentId: string;
  source: 'snapshot' | 'merged_update' | 'manual_refresh' | 'test_walker' | 'test_vision' | 'mock';
  changedFields: string[];
}

export interface ToastMessage {
  id: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface Resident {
  residentId: string;
  name?: string | null;
  createdAt?: string;
}

export interface ResidentDocument {
  docId: string;
  filename: string;
  sourceType?: string;
  uploadedAt?: string;
}

export interface DocumentDetails {
  docId: string;
  residentId: string;
  filename: string;
  filepath?: string;
  uploadedAt?: string;
  textPreview: string;
}

export interface AgentAskResponse {
  answer: string;
  citations: string[];
  contextUsed?: Array<{ docId: string; snippet: string }>;
  heygen?: { textToSpeak?: string };
}

export interface HeyGenResponse {
  mode?: 'heygen' | 'fallback';
  text?: string;
  video_url?: string;
  url?: string;  // Alias for video_url for compatibility
  raw?: Record<string, unknown>;
  error?: string;
  detail?: string;
}

export interface LiveAgentSessionTokenResponse {
  ok: boolean;
  mode: string;
  residentId?: string;
  sessionAccessToken?: string;
  sessionId?: string;
  error?: string;
  raw?: Record<string, unknown> | null;
}

export interface LiveAgentSessionStartResponse {
  ok: boolean;
  sessionId?: string;
  livekitUrl?: string;
  livekitClientToken?: string;
  maxSessionDuration?: number;
  wsUrl?: string | null;
  error?: string;
  raw?: Record<string, unknown> | null;
}

export interface LiveAgentSessionBootstrapResponse {
  ok: boolean;
  residentId?: string;
  sessionId?: string;
  sessionAccessToken?: string;
  livekitUrl?: string;
  livekitClientToken?: string;
  maxSessionDuration?: number;
  wsUrl?: string | null;
  error?: string;
  raw?: Record<string, unknown> | null;
}

export interface LiveAgentSessionEventResponse {
  ok: boolean;
  error?: string;
  raw?: Record<string, unknown> | null;
}

export interface CoachScriptRequest {
  residentId: string;
  context: {
    steps?: number;
    tiltDeg?: number;
    balance?: number;
    cadence?: number;
    fallSuspected?: boolean;
    sessionPhase?: 'idle' | 'walking' | 'paused';
  };
  goal?: 'encourage' | 'correct_posture' | 'safety_warning' | 'answer_question';
  tone?: 'calm' | 'energetic';
  userPrompt?: string;
}

export interface CoachScriptResponse {
  script: string;
  intent: string;
  safetyFlags: string[];
  meta: Record<string, unknown>;
  reason: string;
}

export interface ZoomInviteResponse {
  ok: boolean;
  joinUrl: string;
  sentTo: string;
}

export interface LiveAvatarLiteCreateResponse {
  ok: boolean;
  session_id?: string;
  session_token?: string;
  error?: string;
  raw?: Record<string, unknown> | null;
}

export interface LiveAvatarLiteStartResponse {
  ok: boolean;
  session_id?: string;
  session_token?: string;
  livekit_url?: string;
  livekit_client_token?: string;
  livekit_agent_token?: string;
  ws_url?: string;
  max_session_duration?: number;
  agent_ws_registered?: boolean;
  error?: string;
  raw?: Record<string, unknown> | null;
}

export interface LiveAvatarLiteStopResponse {
  ok: boolean;
  error?: string;
  raw?: Record<string, unknown> | null;
}

export interface LiveAvatarLiteSpeakResponse {
  ok: boolean;
  error?: string;
  event_id?: string;
  chunk_count?: number;
}

export interface LiveAvatarLiteSessionStatus {
  exists: boolean;
  session_id?: string;
  ws_connected?: boolean;
  session_state?: string;
  livekit_state?: string;
  last_error?: string | null;
  ready?: boolean;
  last_event_type?: string | null;
}

export interface ApiErrorShape {
  status: number;
  message: string;
  details?: unknown;
}

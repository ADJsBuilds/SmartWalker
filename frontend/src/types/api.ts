export type ApiStatus = 'connected' | 'degraded' | 'offline';
export type WsStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

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
  mode?: string;
  text?: string;
  raw?: Record<string, unknown>;
  detail?: string;
}

export interface ApiErrorShape {
  status: number;
  message: string;
  details?: unknown;
}

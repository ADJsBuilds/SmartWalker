import type {
  AgentAskResponse,
  ApiErrorShape,
  CoachScriptRequest,
  CoachScriptResponse,
  DocumentDetails,
  HeyGenResponse,
  LiveAgentSessionEventResponse,
  LiveAgentSessionBootstrapResponse,
  LiveAgentSessionStartResponse,
  LiveAgentSessionTokenResponse,
  MergedState,
  Resident,
  ResidentDocument,
} from '../types/api';

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(payload: ApiErrorShape) {
    super(payload.message);
    this.name = 'ApiError';
    this.status = payload.status;
    this.details = payload.details;
  }
}

export function isNotImplementedError(error: unknown): boolean {
  return error instanceof ApiError && [404, 405, 501].includes(error.status);
}

export function isNetworkError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TypeError';
}

function parseReportId(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const reportId = obj.reportId || obj.report_id || obj.id;
  return typeof reportId === 'string' ? reportId : null;
}

export class ApiClient {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
          ...(init?.headers || {}),
        },
      });
    } catch (error) {
      throw error;
    }

    const text = await response.text();
    const parsed = text ? safeJsonParse(text) : null;

    if (!response.ok) {
      let message = response.statusText || 'Request failed';
      if (parsed && typeof parsed === 'object' && 'detail' in parsed) {
        const detail = (parsed as Record<string, unknown>).detail;
        if (detail !== undefined && detail !== null && String(detail).trim()) {
          message = String(detail);
        }
      }
      throw new ApiError({ status: response.status, message, details: parsed });
    }

    return (parsed as T) ?? ({} as T);
  }

  health(): Promise<{ ok: boolean }> {
    return this.request('/health', { method: 'GET' });
  }

  getState(residentId: string): Promise<MergedState> {
    return this.request(`/api/state/${encodeURIComponent(residentId)}`, { method: 'GET' });
  }

  postWalker(payload: Record<string, unknown>): Promise<{ ok: boolean }> {
    return this.request('/api/walker', { method: 'POST', body: JSON.stringify(payload) });
  }

  postVision(payload: Record<string, unknown>): Promise<{ ok: boolean }> {
    return this.request('/api/vision', { method: 'POST', body: JSON.stringify(payload) });
  }

  listResidents(): Promise<Resident[]> {
    return this.request('/api/residents', { method: 'GET' });
  }

  createResident(payload: { residentId: string; name?: string }): Promise<Resident> {
    return this.request('/api/residents', { method: 'POST', body: JSON.stringify(payload) });
  }

  getResident(residentId: string): Promise<Resident> {
    return this.request(`/api/residents/${encodeURIComponent(residentId)}`, { method: 'GET' });
  }

  listDocuments(residentId: string): Promise<ResidentDocument[]> {
    return this.request(`/api/residents/${encodeURIComponent(residentId)}/documents`, { method: 'GET' });
  }

  uploadDocument(residentId: string, file: File): Promise<ResidentDocument> {
    const form = new FormData();
    form.append('file', file);
    return this.request(`/api/residents/${encodeURIComponent(residentId)}/documents`, { method: 'POST', body: form });
  }

  getDocument(docId: string): Promise<DocumentDetails> {
    return this.request(`/api/documents/${encodeURIComponent(docId)}`, { method: 'GET' });
  }

  async generateDailyReport(residentId: string, date: string): Promise<string | null> {
    const raw = await this.request<Record<string, unknown>>(
      `/api/reports/daily/generate?residentId=${encodeURIComponent(residentId)}&date=${encodeURIComponent(date)}`,
      { method: 'POST' },
    );
    return parseReportId(raw);
  }

  getDailyReportDownloadUrl(reportId: string): string {
    return `${this.baseUrl}/api/reports/daily/${encodeURIComponent(reportId)}/download`;
  }

  askAgent(payload: { residentId: string; question: string; conversationId?: string }): Promise<AgentAskResponse> {
    return this.request('/api/agent/ask', { method: 'POST', body: JSON.stringify(payload) });
  }

  generateCoachScript(payload: CoachScriptRequest): Promise<CoachScriptResponse> {
    return this.request('/api/coach/script', { method: 'POST', body: JSON.stringify(payload) });
  }

  heygenSpeak(payload: { text: string; residentId?: string }): Promise<HeyGenResponse> {
    return this.request('/api/heygen/speak', { method: 'POST', body: JSON.stringify(payload) });
  }

  createLiveAgentSessionToken(payload: {
    residentId?: string;
    avatarId?: string;
    mode?: 'FULL';
    interactivityType?: 'PUSH_TO_TALK';
    language?: string;
  }): Promise<LiveAgentSessionTokenResponse> {
    return this.request('/api/liveagent/session/token', { method: 'POST', body: JSON.stringify(payload) });
  }

  startLiveAgentSession(payload: { sessionToken: string; sessionId?: string }): Promise<LiveAgentSessionStartResponse> {
    return this.request('/api/liveagent/session/start', { method: 'POST', body: JSON.stringify(payload) });
  }

  bootstrapLiveAgentSession(payload: {
    residentId?: string;
    mode?: 'FULL';
    avatarId?: string;
    interactivityType?: 'PUSH_TO_TALK';
    language?: string;
  }): Promise<LiveAgentSessionBootstrapResponse> {
    return this.request('/api/liveagent/session/bootstrap', { method: 'POST', body: JSON.stringify(payload) });
  }

  sendLiveAgentSessionEvent(payload: { sessionToken: string; sessionId: string; text: string }): Promise<LiveAgentSessionEventResponse> {
    return this.request('/api/liveagent/session/event', { method: 'POST', body: JSON.stringify(payload) });
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { detail: text };
  }
}

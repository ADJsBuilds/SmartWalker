export interface LiveAvatarLiteSessionStart {
  ok: boolean;
  session_id?: string;
  session_token?: string;
  livekit_url?: string;
  livekit_client_token?: string;
  ws_url?: string;
  agent_ws_registered?: boolean;
  error?: string;
}

export interface LiveAvatarLiteSessionCreate {
  ok: boolean;
  session_id?: string;
  session_token?: string;
  error?: string;
}

interface LiveAvatarLiteSessionStopResponse {
  ok: boolean;
  error?: string;
}

interface LiveAvatarLiteStatusResponse {
  exists?: boolean;
  ready?: boolean;
  ws_connected?: boolean;
  session_state?: string;
  last_error?: string | null;
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  const payload = text ? safeJsonParse(text) : {};
  if (!response.ok) {
    const detail =
      payload && typeof payload === 'object' && 'detail' in payload
        ? String((payload as Record<string, unknown>).detail || '')
        : '';
    throw new Error(detail || `Request failed: ${response.status}`);
  }
  return payload as T;
}

export async function createLiveAvatarLiteSession(baseUrl: string): Promise<LiveAvatarLiteSessionCreate> {
  const response = await fetch(`${baseUrl}/api/liveavatar/lite/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      language: 'en',
      video_quality: 'high',
      video_encoding: 'VP8',
      is_sandbox: false,
    }),
  });
  const text = await response.text();
  const payload = text ? safeJsonParse(text) : {};
  const raw = payload as Record<string, unknown>;

  if (!response.ok) {
    const detail = typeof raw.detail === 'string' ? raw.detail : '';
    const error = typeof raw.error === 'string' ? raw.error : '';
    return { ok: false, error: detail || error || `Request failed: ${response.status}` };
  }

  if (typeof raw.session_id === 'string' && typeof raw.session_token === 'string') {
    return {
      ok: true,
      session_id: raw.session_id,
      session_token: raw.session_token,
    };
  }

  return { ok: false, error: 'Unexpected liveavatar create response shape' };
}

export async function startLiveAvatarLiteSession(baseUrl: string, payload: { session_token: string }): Promise<LiveAvatarLiteSessionStart> {
  const response = await fetch(`${baseUrl}/api/liveavatar/lite/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  const parsed = text ? safeJsonParse(text) : {};
  const raw = parsed as Record<string, unknown>;

  if (!response.ok) {
    const detail = typeof raw.detail === 'string' ? raw.detail : '';
    const error = typeof raw.error === 'string' ? raw.error : '';
    return { ok: false, error: detail || error || `Request failed: ${response.status}` };
  }

  if (
    typeof raw.session_id === 'string' &&
    typeof raw.livekit_url === 'string' &&
    typeof raw.livekit_client_token === 'string'
  ) {
    return {
      ok: true,
      session_id: raw.session_id,
      session_token: typeof raw.session_token === 'string' ? raw.session_token : payload.session_token,
      livekit_url: raw.livekit_url,
      livekit_client_token: raw.livekit_client_token,
      ws_url: typeof raw.ws_url === 'string' ? raw.ws_url : undefined,
      agent_ws_registered: Boolean(raw.agent_ws_registered),
    };
  }

  return { ok: false, error: 'Unexpected liveavatar start response shape' };
}

// Optional fallback/debug helper for passthrough endpoint.
export async function createAndStartLiveAvatarLiteSessionViaNew(baseUrl: string): Promise<LiveAvatarLiteSessionStart> {
  const response = await fetch(`${baseUrl}/api/liveavatar/lite/new`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      language: 'en',
      video_quality: 'high',
      video_encoding: 'VP8',
      is_sandbox: false,
    }),
  });
  const text = await response.text();
  const parsed = text ? safeJsonParse(text) : {};
  const raw = parsed as Record<string, unknown>;

  if (!response.ok) {
    const detail = typeof raw.detail === 'string' ? raw.detail : '';
    const error = typeof raw.error === 'string' ? raw.error : '';
    return { ok: false, error: detail || error || `Request failed: ${response.status}` };
  }

  // HeyGen raw response shape from /api/liveavatar/lite/new passthrough.
  const data = raw.data && typeof raw.data === 'object' ? (raw.data as Record<string, unknown>) : null;
  if (Number(raw.code) === 100 && data && typeof data.session_id === 'string' && typeof data.url === 'string' && typeof data.access_token === 'string') {
    return {
      ok: true,
      session_id: data.session_id,
      session_token: typeof data.session_token === 'string' ? data.session_token : undefined,
      livekit_url: data.url,
      livekit_client_token: data.access_token,
      ws_url: typeof data.ws_url === 'string' ? data.ws_url : undefined,
    };
  }

  return { ok: false, error: 'Unexpected liveavatar /lite/new response shape' };
}

export async function stopLiveAvatarLiteSession(
  baseUrl: string,
  payload: { session_id: string; session_token: string },
): Promise<LiveAvatarLiteSessionStopResponse> {
  return requestJson<LiveAvatarLiteSessionStopResponse>(`${baseUrl}/api/liveavatar/lite/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function getLiveAvatarLiteStatus(baseUrl: string, sessionId: string): Promise<LiveAvatarLiteStatusResponse> {
  return requestJson<LiveAvatarLiteStatusResponse>(`${baseUrl}/api/liveavatar/lite/status/${encodeURIComponent(sessionId)}`, {
    method: 'GET',
  });
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { detail: text };
  }
}


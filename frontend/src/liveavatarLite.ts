export interface LiveAvatarLiteSessionStart {
  ok: boolean;
  session_id?: string;
  session_token?: string;
  livekit_url?: string;
  livekit_client_token?: string;
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

export async function createAndStartLiveAvatarLiteSession(baseUrl: string): Promise<LiveAvatarLiteSessionStart> {
  return requestJson<LiveAvatarLiteSessionStart>(`${baseUrl}/api/liveavatar/lite/new`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      language: 'en',
      video_quality: 'high',
      video_encoding: 'VP8',
      is_sandbox: false,
    }),
  });
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


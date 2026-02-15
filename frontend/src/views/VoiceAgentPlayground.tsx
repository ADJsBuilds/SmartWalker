import { useEffect, useMemo, useRef, useState } from 'react';

import { ContextManager } from '../lib/contextManager';
import { useRealtimeState } from '../store/realtimeState';

type SocketStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';
const QNA_FETCH_TIMEOUT_MS = 320;

interface LogEntry {
  id: string;
  ts: string;
  direction: 'in' | 'out' | 'sys';
  payload: unknown;
}

export function VoiceAgentPlayground() {
  const { activeResidentId, apiClient, notify } = useRealtimeState();
  const [agentId, setAgentId] = useState('');
  const [userId, setUserId] = useState('demo-user');
  const [messageText, setMessageText] = useState('');
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('idle');
  const [latestTranscript, setLatestTranscript] = useState('');
  const [latestAgentText, setLatestAgentText] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoMetrics, setAutoMetrics] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const contextManagerRef = useRef<ContextManager | null>(null);
  const metricTimerRef = useRef<number | null>(null);
  const stepsRef = useRef(150);
  const gaitAsymmetryRef = useRef(0.22);
  const tiltWarningRef = useRef(false);
  const connected = socketStatus === 'open';
  const contextCacheRef = useRef<{ text: string; ts: number }>({ text: '', ts: 0 });

  const canSend = useMemo(() => connected && Boolean(messageText.trim()), [connected, messageText]);

  useEffect(() => {
    return () => {
      stopAutoMetrics();
      contextManagerRef.current?.dispose();
      contextManagerRef.current = null;
      if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) wsRef.current.close();
      wsRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!autoMetrics || !connected) return;
    metricTimerRef.current = window.setInterval(() => {
      stepsRef.current += 1;
      gaitAsymmetryRef.current = clamp(gaitAsymmetryRef.current + randomInRange(-0.01, 0.02), 0, 1);
      contextManagerRef.current?.updateMetrics({
        steps_today: stepsRef.current,
        cadence_spm: Math.round(randomInRange(80, 95)),
        gait_asymmetry: gaitAsymmetryRef.current,
        tilt_deg: Number(randomInRange(1.5, 4.5).toFixed(2)),
        tilt_warning: tiltWarningRef.current,
        fall_risk: gaitAsymmetryRef.current >= 0.35 ? 'high' : gaitAsymmetryRef.current >= 0.25 ? 'moderate' : 'low',
      });
    }, 1000);
    return () => stopAutoMetrics();
  }, [autoMetrics, connected]);

  const appendLog = (direction: LogEntry['direction'], payload: unknown) => {
    const compactPayload = compactLargeAudioPayload(payload);
    setLogs((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: new Date().toLocaleTimeString(),
        direction,
        payload: compactPayload,
      },
      ...prev,
    ].slice(0, 120));
  };

  const startSession = async () => {
    if (connected || socketStatus === 'connecting') return;
    setSocketStatus('connecting');
    setLatestTranscript('');
    setLatestAgentText('');
    try {
      const session = await apiClient.createElevenSession({
        agent_id: agentId.trim() || undefined,
        user_id: userId.trim() || undefined,
      });
      const ws = new WebSocket(session.signed_url);
      wsRef.current = ws;

      ws.onopen = () => {
        setSocketStatus('open');
        appendLog('sys', { type: 'connected', session_id: session.session_id });

        const manager = new ContextManager({
          throttleMs: 2000,
          sendUpdateText: (text) => sendSocketEvent({ type: 'contextual_update', text }),
        });
        contextManagerRef.current = manager;
        manager.setPatientProfile({
          name: 'Margaret',
          age: 78,
          summary: 'post-hip replacement',
          risk: 'moderate',
        });
        manager.setGoals({ target_steps: 300 });
        manager.updateUiState({ screen: 'voice_agent_playground', exercise_phase: 'warmup' });
        manager.updateMetrics({
          steps_today: stepsRef.current,
          cadence_spm: 84,
          gait_asymmetry: gaitAsymmetryRef.current,
          tilt_deg: 3.1,
          tilt_warning: false,
          fall_risk: 'low',
        });
      };

      ws.onmessage = (event) => {
        let payload: unknown;
        try {
          payload = JSON.parse(String(event.data));
        } catch {
          payload = { type: 'raw', data: String(event.data) };
        }
        appendLog('in', payload);
        routeIncomingEvent(payload);
      };

      ws.onerror = () => {
        setSocketStatus('error');
        appendLog('sys', { type: 'error', detail: 'websocket error' });
      };

      ws.onclose = (event) => {
        setSocketStatus('closed');
        appendLog('sys', { type: 'closed', code: event.code, reason: event.reason });
      };
    } catch (error) {
      setSocketStatus('error');
      notify(error instanceof Error ? error.message : 'Failed to start ElevenLabs session.', 'error');
      appendLog('sys', { type: 'start_failed', error: error instanceof Error ? error.message : 'unknown' });
    }
  };

  const stopSession = () => {
    stopAutoMetrics();
    contextManagerRef.current?.dispose();
    contextManagerRef.current = null;
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) wsRef.current.close(1000, 'client stop');
    wsRef.current = null;
    setSocketStatus('closed');
    appendLog('sys', { type: 'stopped' });
  };

  const sendUserMessage = () => {
    void sendUserMessageAsync();
  };

  const fetchContextPrompt = async (): Promise<string> => {
    const now = Date.now();
    const cached = contextCacheRef.current;
    if (cached.text && now - cached.ts < 2000) return cached.text;
    try {
      const request = apiClient.getExerciseContextWindow(activeResidentId, { maxSamples: 50, stepWindow: 50 });
      const timeout = new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error('context timeout')), 260);
      });
      const context = await Promise.race([request, timeout]);
      const text = (context.promptText || '').trim();
      if (!text) return cached.text || '';
      const clipped = text.length <= 650 ? text : `${text.slice(0, 649).trim()}…`;
      contextCacheRef.current = { text: clipped, ts: Date.now() };
      return clipped;
    } catch {
      return cached.text || '';
    }
  };

  const fetchQnaContextBlock = async (question: string): Promise<string> => {
    const trimmed = question.trim();
    if (!trimmed) return '';
    try {
      const request = apiClient.getExerciseQnaContext(activeResidentId, trimmed, { maxSamples: 50 });
      const timeout = new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error('qna context timeout')), QNA_FETCH_TIMEOUT_MS);
      });
      const context = await Promise.race([request, timeout]);
      const facts = (context.groundingText || '').trim();
      if (!facts) return '';
      const focus = context.recommendedFocus.length ? ` Suggested focus: ${context.recommendedFocus.join(' ')}` : '';
      appendLog('sys', { type: 'qna_context', intent: context.intent, rowsUsed: context.rowsUsed, stale: context.staleDataFlag });
      const merged = `${facts}${focus} Rows used: ${context.rowsUsed}.`;
      return merged.length <= 780 ? merged : `${merged.slice(0, 779).trim()}…`;
    } catch {
      return '';
    }
  };

  const parseToolCallQuestion = (raw: unknown): string => {
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) return '';
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        return parseToolCallQuestion(parsed);
      } catch {
        return trimmed;
      }
    }
    if (!raw || typeof raw !== 'object') return '';
    const data = raw as Record<string, unknown>;
    for (const key of ['question', 'query', 'text', 'prompt', 'user_question']) {
      const value = data[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  };

  const sendUserMessageAsync = async () => {
    const text = messageText.trim();
    if (!text) return;
    const qnaContext = await fetchQnaContextBlock(text);
    const contextPrompt = qnaContext || await fetchContextPrompt();
    const contextualText = contextPrompt
      ? `Use only the following exercise context facts when relevant. If data is missing, say so briefly.\nContext: ${contextPrompt}\n\nUser question: ${text}`
      : text;
    sendSocketEvent({ type: 'user_message', text: contextualText });
    setMessageText('');
  };

  const sendSocketEvent = (payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
    appendLog('out', payload);
  };

  const sendCriticalTiltWarning = () => {
    tiltWarningRef.current = true;
    contextManagerRef.current?.updateMetrics({
      tilt_warning: true,
      tilt_deg: 12.5,
      fall_risk: 'high',
      gait_asymmetry: Number((gaitAsymmetryRef.current + 0.1).toFixed(2)),
    });
    contextManagerRef.current?.emitCriticalEvent('tilt_warning', { tilt_deg: 12.5, fall_risk: 'high' });
  };

  const routeIncomingEvent = (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return;
    const event = payload as Record<string, unknown>;
    const type = String(event.type || '');

    if (type === 'ping') {
      const pingEvent = (event.ping_event as Record<string, unknown> | undefined) || {};
      const eventId = String(pingEvent.event_id || event.event_id || '');
      if (eventId) sendSocketEvent({ type: 'pong', event_id: eventId });
      return;
    }

    if (type === 'client_tool_call') {
      const call = (event.client_tool_call as Record<string, unknown> | undefined) || {};
      const rawToolCallId = call.tool_call_id;
      const toolCallId = (typeof rawToolCallId === 'string' || typeof rawToolCallId === 'number') ? rawToolCallId : '';
      if (toolCallId !== '') {
        void (async () => {
          const question = parseToolCallQuestion(call.parameters ?? call.arguments ?? call.input ?? call.params);
          const qnaContext = question ? await fetchQnaContextBlock(question) : '';
          const fallback = qnaContext || await fetchContextPrompt();
          sendSocketEvent({
            type: 'client_tool_result',
            tool_call_id: toolCallId,
            result: fallback || 'No recent exercise samples are available yet.',
            is_error: false,
          });
        })();
      }
      return;
    }

    const transcriptText = extractText(event, [
      'user_transcript',
      'transcript',
      'text',
      'user_text',
    ]);
    if (type.includes('transcript') && transcriptText) {
      setLatestTranscript(transcriptText);
    }

    const agentText = extractText(event, ['agent_response', 'response', 'text']);
    if ((type.includes('agent') || type.includes('response')) && agentText) {
      setLatestAgentText(agentText);
    }
  };

  const stopAutoMetrics = () => {
    if (metricTimerRef.current) {
      window.clearInterval(metricTimerRef.current);
      metricTimerRef.current = null;
    }
  };

  return (
    <section className="space-y-4 pb-24">
      <div className="rounded-2xl bg-slate-900 p-4 text-slate-100 sm:p-6">
        <h2 className="text-2xl font-bold">Voice Agent Playground (ElevenLabs)</h2>
        <p className="mt-2 text-sm text-slate-300">
          Text-first websocket testbed with rapid contextual updates and event routing.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl bg-slate-900 p-4 text-slate-100">
          <p className="mb-3 text-sm uppercase tracking-wide text-slate-300">Session</p>
          <label className="mb-2 block text-sm text-slate-300">Agent ID (optional)</label>
          <input
            value={agentId}
            onChange={(event) => setAgentId(event.target.value)}
            placeholder="Uses backend ELEVENLABS_AGENT_ID if empty"
            className="mb-3 w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
          />
          <label className="mb-2 block text-sm text-slate-300">User ID (optional)</label>
          <input
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder="demo-user"
            className="mb-4 w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={startSession}
              disabled={connected || socketStatus === 'connecting'}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              Start session
            </button>
            <button
              type="button"
              onClick={stopSession}
              disabled={!connected}
              className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              Stop
            </button>
          </div>
          <p className="mt-3 text-sm text-slate-300">Status: {socketStatus}</p>
        </div>

        <div className="rounded-2xl bg-slate-900 p-4 text-slate-100">
          <p className="mb-3 text-sm uppercase tracking-wide text-slate-300">Messaging</p>
          <input
            value={messageText}
            onChange={(event) => setMessageText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') sendUserMessage();
            }}
            placeholder="Type a user message..."
            className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={sendUserMessage}
              disabled={!canSend}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              Send user_message
            </button>
            <button
              type="button"
              onClick={() => setAutoMetrics((prev) => !prev)}
              disabled={!connected}
              className="rounded-xl bg-slate-700 px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {autoMetrics ? 'Stop metrics timer' : 'Start metrics timer'}
            </button>
            <button
              type="button"
              onClick={sendCriticalTiltWarning}
              disabled={!connected}
              className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              Trigger tilt warning
            </button>
          </div>
          <div className="mt-4 space-y-1 rounded-xl border border-slate-700 bg-slate-800 p-3 text-sm">
            <p>
              <span className="text-slate-300">Latest transcript:</span> {latestTranscript || '—'}
            </p>
            <p>
              <span className="text-slate-300">Latest agent response:</span> {latestAgentText || '—'}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-slate-900 p-4 text-slate-100">
        <p className="mb-3 text-sm uppercase tracking-wide text-slate-300">Event log</p>
        <div className="max-h-[420px] space-y-2 overflow-y-auto">
          {logs.length === 0 ? (
            <p className="text-sm text-slate-400">No events yet.</p>
          ) : (
            logs.map((entry) => (
              <div key={entry.id} className="rounded-xl border border-slate-700 bg-slate-800 p-3 text-xs">
                <p className="mb-1 text-slate-400">
                  [{entry.ts}] {entry.direction.toUpperCase()}
                </p>
                <pre className="whitespace-pre-wrap break-words">{safePrettyJson(entry.payload)}</pre>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function extractText(payload: Record<string, unknown>, candidateKeys: string[]): string {
  for (const key of candidateKeys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object') {
      const inner = value as Record<string, unknown>;
      for (const nestedKey of ['text', 'response', 'transcript']) {
        const nestedValue = inner[nestedKey];
        if (typeof nestedValue === 'string' && nestedValue.trim()) return nestedValue.trim();
      }
    }
  }
  return '';
}

function safePrettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function compactLargeAudioPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  const asRecord = payload as Record<string, unknown>;
  const out: Record<string, unknown> = { ...asRecord };

  const userAudio = out.user_audio_chunk;
  if (typeof userAudio === 'string') {
    out.user_audio_chunk = `<${Math.max(0, Math.floor((userAudio.length * 3) / 4))} bytes base64>`;
  }

  const audioEvent = out.audio_event;
  if (audioEvent && typeof audioEvent === 'object') {
    const audioRecord = { ...(audioEvent as Record<string, unknown>) };
    const b64 = audioRecord.audio_base_64;
    if (typeof b64 === 'string') {
      audioRecord.audio_base_64 = `<${Math.max(0, Math.floor((b64.length * 3) / 4))} bytes base64>`;
    }
    out.audio_event = audioRecord;
  }

  return out;
}

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}


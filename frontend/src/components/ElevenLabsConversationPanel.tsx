import { useEffect, useMemo, useRef, useState } from 'react';

import type { ApiClient } from '../lib/apiClient';
import { getSpeechRecognitionCtor, speakText, type SpeechRecognitionLike } from '../lib/speech';

type SessionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

interface ElevenLabsConversationPanelProps {
  apiClient: ApiClient;
  notify: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

interface EventLog {
  id: string;
  ts: string;
  direction: 'in' | 'out' | 'sys';
  text: string;
}

export function ElevenLabsConversationPanel({ apiClient, notify }: ElevenLabsConversationPanelProps) {
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [isListening, setIsListening] = useState(false);
  const [inputText, setInputText] = useState('');
  const [lastUserText, setLastUserText] = useState('');
  const [lastAgentText, setLastAgentText] = useState('');
  const [logs, setLogs] = useState<EventLog[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const speechSupported = useMemo(() => Boolean(getSpeechRecognitionCtor()), []);

  useEffect(() => {
    return () => {
      recRef.current?.stop();
      recRef.current = null;
      const ws = wsRef.current;
      if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000, 'component cleanup');
      wsRef.current = null;
    };
  }, []);

  const appendLog = (direction: EventLog['direction'], text: string) => {
    setLogs((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: new Date().toLocaleTimeString(),
        direction,
        text,
      },
      ...prev,
    ].slice(0, 80));
  };

  const sendEvent = (payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
    appendLog('out', JSON.stringify(payload));
  };

  const startSession = async () => {
    if (status === 'connecting' || status === 'connected') return;
    setStatus('connecting');
    setLastUserText('');
    setLastAgentText('');
    try {
      const session = await apiClient.createElevenSession({});
      const ws = new WebSocket(session.signed_url);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('connected');
        appendLog('sys', `Connected (${session.session_id})`);
      };

      ws.onclose = (event) => {
        setStatus('disconnected');
        appendLog('sys', `Closed: ${event.code} ${event.reason || ''}`.trim());
      };

      ws.onerror = () => {
        setStatus('error');
        appendLog('sys', 'WebSocket error');
      };

      ws.onmessage = (event) => {
        let payload: unknown;
        try {
          payload = JSON.parse(String(event.data));
        } catch {
          appendLog('in', `RAW: ${String(event.data)}`);
          return;
        }
        if (!payload || typeof payload !== 'object') return;
        const message = payload as Record<string, unknown>;
        const type = String(message.type || '');
        appendLog('in', JSON.stringify(message));

        if (type === 'ping') {
          const pingEvent = (message.ping_event as Record<string, unknown> | undefined) || {};
          const eventId = String(pingEvent.event_id || message.event_id || '');
          if (eventId) sendEvent({ type: 'pong', event_id: eventId });
          return;
        }

        if (type === 'client_tool_call') {
          const toolCall = (message.client_tool_call as Record<string, unknown> | undefined) || {};
          const toolCallId = String(toolCall.tool_call_id || '');
          if (toolCallId) {
            sendEvent({
              type: 'client_tool_result',
              tool_call_id: toolCallId,
              result: 'NOT IMPLEMENTED',
              is_error: true,
            });
          }
          return;
        }

        const transcriptText = extractEventText(message, ['user_transcript', 'transcript', 'user_text']);
        if (transcriptText && type.includes('transcript')) {
          setLastUserText(transcriptText);
          return;
        }

        const agentText = extractEventText(message, ['agent_response', 'response', 'text']);
        if (agentText && (type.includes('agent') || type.includes('response'))) {
          setLastAgentText(agentText);
          speakText(agentText);
        }
      };
    } catch (error) {
      setStatus('error');
      notify(error instanceof Error ? error.message : 'Failed to start ElevenLabs session.', 'error');
    }
  };

  const stopSession = () => {
    recRef.current?.stop();
    recRef.current = null;
    const ws = wsRef.current;
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000, 'manual stop');
    wsRef.current = null;
    setIsListening(false);
    setStatus('disconnected');
    appendLog('sys', 'Disconnected');
  };

  const sendText = () => {
    const text = inputText.trim();
    if (!text) return;
    setLastUserText(text);
    sendEvent({ type: 'user_message', text });
    setInputText('');
  };

  const talk = () => {
    if (status !== 'connected') return;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      notify('Speech recognition is not supported in this browser.', 'warn');
      return;
    }

    recRef.current?.stop();
    const rec = new Ctor();
    recRef.current = rec;
    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = false;
    rec.onerror = () => setIsListening(false);
    rec.onend = () => setIsListening(false);
    rec.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim() || '';
      setIsListening(false);
      if (!transcript) return;
      setLastUserText(transcript);
      sendEvent({ type: 'user_message', text: transcript });
    };
    setIsListening(true);
    rec.start();
  };

  return (
    <div className="rounded-2xl bg-slate-900 p-4 sm:p-6">
      <h3 className="text-2xl font-black text-white">ElevenLabs Voice Agent</h3>
      <p className="mt-1 text-sm text-slate-300">Direct conversation using backend signed WebSocket session.</p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={startSession}
          disabled={status === 'connecting' || status === 'connected'}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          Start Session
        </button>
        <button
          type="button"
          onClick={stopSession}
          disabled={status !== 'connected' && status !== 'connecting'}
          className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          Stop
        </button>
        <button
          type="button"
          onClick={talk}
          disabled={status !== 'connected' || !speechSupported}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {isListening ? 'Listening...' : 'Tap To Talk'}
        </button>
      </div>

      <p className="mt-3 text-xs text-slate-300">
        Status: <span className="font-bold">{status}</span>
        {!speechSupported ? ' | Mic unavailable in this browser (text still works).' : ''}
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-slate-200">
          <p className="text-xs text-slate-400">You</p>
          <p>{lastUserText || '...'}</p>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-slate-200">
          <p className="text-xs text-slate-400">Agent</p>
          <p>{lastAgentText || '...'}</p>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={inputText}
          onChange={(event) => setInputText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') sendText();
          }}
          placeholder="Type a message to the agent..."
          className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
        />
        <button
          type="button"
          onClick={sendText}
          disabled={status !== 'connected' || !inputText.trim()}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          Send
        </button>
      </div>

      <div className="mt-3 max-h-44 overflow-auto rounded-lg border border-slate-700 bg-slate-950 p-3 text-xs text-slate-300">
        {logs.length ? logs.map((log) => <p key={log.id}>[{log.ts}] {log.direction.toUpperCase()}: {log.text}</p>) : <p>No events yet.</p>}
      </div>
    </div>
  );
}

function extractEventText(payload: Record<string, unknown>, candidateKeys: string[]): string {
  for (const key of candidateKeys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object') {
      const nested = value as Record<string, unknown>;
      for (const nestedKey of ['text', 'response', 'transcript', 'agent_response']) {
        const nestedValue = nested[nestedKey];
        if (typeof nestedValue === 'string' && nestedValue.trim()) return nestedValue.trim();
      }
    }
  }
  return '';
}


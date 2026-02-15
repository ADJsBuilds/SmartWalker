import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrack, type RemoteTrackPublication } from 'livekit-client';

import type { ApiClient } from '../lib/apiClient';

type SessionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
type CaptureMode = 'ptt' | 'handsfree';

interface ElevenLabsConversationPanelProps {
  apiClient: ApiClient;
  residentId: string;
  notify: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

interface EventLog {
  id: string;
  ts: string;
  direction: 'in' | 'out' | 'sys';
  text: string;
}

const LIVEAVATAR_TARGET_RATE = 24000;
const ELEVEN_USER_INPUT_RATE = 16000;
const LIVEAVATAR_CHUNK_SECONDS = 1;
const LIVEAVATAR_CHUNK_BYTES = LIVEAVATAR_TARGET_RATE * 2 * LIVEAVATAR_CHUNK_SECONDS;
const CONTEXT_CACHE_TTL_MS = 2000;
const CONTEXT_FETCH_TIMEOUT_MS = 320;
const QNA_FETCH_TIMEOUT_MS = 320;
const REALTIME_CONTEXT_MIN_INTERVAL_MS = 5000;
const REALTIME_CONTEXT_MAX_CHARS = 360;
const TOOL_RESULT_MAX_CHARS = 480;
const MAX_OUTBOUND_TEXT_CHARS = 150;
const DIAGNOSTIC_DISABLE_DB_CONTEXT = true;
const LIVEAVATAR_LOG_SUPPRESSED_TYPES = new Set([
  'session.keep_alive',
  'agent.start_listening',
  'agent.stop_listening',
]);

export function ElevenLabsConversationPanel({ apiClient, residentId, notify }: ElevenLabsConversationPanelProps) {
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [isTalking, setIsTalking] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode>('ptt');
  const [pttPressed, setPttPressed] = useState(false);
  const [debugConversion, setDebugConversion] = useState(false);
  const [inputText, setInputText] = useState('');
  const [lastUserText, setLastUserText] = useState('');
  const [lastAgentText, setLastAgentText] = useState('');
  const [liveAvatarState, setLiveAvatarState] = useState('idle');
  const [logs, setLogs] = useState<EventLog[]>([]);

  const videoHostRef = useRef<HTMLDivElement | null>(null);
  const livekitRoomRef = useRef<Room | null>(null);
  const liveAvatarWsRef = useRef<WebSocket | null>(null);
  const elevenWsRef = useRef<WebSocket | null>(null);
  const keepAliveTimerRef = useRef<number | null>(null);
  const speakEndTimerRef = useRef<number | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const avatarReadyRef = useRef(false);
  const avatarSpeakingRef = useRef(false);
  const currentTurnIdRef = useRef<string | null>(null);
  const liveAvatarPcmBufferRef = useRef<Uint8Array>(new Uint8Array(0));
  const elevenOutputRateRef = useRef<number>(16000);
  const elevenInputRateRef = useRef<number>(ELEVEN_USER_INPUT_RATE);
  const sentAudioChunksRef = useRef(0);
  const vadHighFramesRef = useRef(0);
  const vadLowFramesRef = useRef(0);
  const lastContextFetchAtRef = useRef(0);
  const pttPressedRef = useRef(false);
  const speechActiveRef = useRef(false);
  const listeningSignaledRef = useRef(false);
  const noiseFloorRef = useRef(0.01);
  const speechAttackFramesRef = useRef(0);
  const speechReleaseFramesRef = useRef(0);
  const contextCacheRef = useRef<{ text: string; ts: number }>({ text: '', ts: 0 });
  const textTurnTimeoutRef = useRef<number | null>(null);
  const pendingTextTurnRef = useRef<{ id: string; plainText: string; retried: boolean } | null>(null);
  const providerRecoveryRef = useRef<{ lastSignature: string; attempts: number }>({ lastSignature: '', attempts: 0 });

  useEffect(() => {
    return () => {
      void stopSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    ].slice(0, 120));
  };

  const compactLiveAvatarPayloadForLog = (payload: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...payload };
    const audio = out.audio;
    if (typeof audio === 'string') {
      const approxBytes = Math.max(0, Math.floor((audio.length * 3) / 4));
      out.audio = `<${approxBytes} bytes base64>`;
    }
    return out;
  };

  const clampOutboundText = (value: string): string => {
    const trimmed = value.trim();
    return trimmed.length <= MAX_OUTBOUND_TEXT_CHARS ? trimmed : trimmed.slice(0, MAX_OUTBOUND_TEXT_CHARS).trim();
  };

  const sendLiveAvatarEvent = (payload: Record<string, unknown>) => {
    const ws = liveAvatarWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
    const payloadType = String(payload.type || '');
    if (!LIVEAVATAR_LOG_SUPPRESSED_TYPES.has(payloadType)) {
      appendLog('out', `liveavatar: ${JSON.stringify(compactLiveAvatarPayloadForLog(payload))}`);
    }
  };

  const sendElevenEvent = (payload: Record<string, unknown>) => {
    const ws = elevenWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const outboundPayload: Record<string, unknown> = { ...payload };
    if (typeof outboundPayload.text === 'string') {
      outboundPayload.text = clampOutboundText(outboundPayload.text);
    }
    if (typeof outboundPayload.result === 'string') {
      outboundPayload.result = clampOutboundText(outboundPayload.result);
    }
    ws.send(JSON.stringify(outboundPayload));
    const rawAudio = outboundPayload.user_audio_chunk;
    if (typeof rawAudio === 'string') {
      // Avoid flooding the UI with megabytes of base64 logs.
      const approxBytes = Math.max(0, Math.floor((rawAudio.length * 3) / 4));
      appendLog('out', `eleven: {"user_audio_chunk":"<${approxBytes} bytes base64>"}`);
      return;
    }
    appendLog('out', `eleven: ${JSON.stringify(outboundPayload)}`);
  };

  const compactIncomingElevenPayload = (payload: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...payload };
    const audioEvent = out.audio_event;
    if (audioEvent && typeof audioEvent === 'object') {
      const audioRecord = { ...(audioEvent as Record<string, unknown>) };
      const b64 = audioRecord.audio_base_64;
      if (typeof b64 === 'string') {
        const approxBytes = Math.max(0, Math.floor((b64.length * 3) / 4));
        audioRecord.audio_base_64 = `<${approxBytes} bytes base64>`;
      }
      out.audio_event = audioRecord;
    }
    return out;
  };

  const fetchContextPrompt = async (options?: { preferCache?: boolean; timeoutMs?: number }): Promise<string> => {
    if (DIAGNOSTIC_DISABLE_DB_CONTEXT) return '';
    const preferCache = options?.preferCache ?? true;
    const timeoutMs = Math.max(80, options?.timeoutMs ?? CONTEXT_FETCH_TIMEOUT_MS);
    const now = Date.now();
    const cached = contextCacheRef.current;
    if (preferCache && cached.text && now - cached.ts <= CONTEXT_CACHE_TTL_MS) {
      return cached.text;
    }
    try {
      const request = apiClient.getExerciseContextWindow(residentId, { maxSamples: 50, stepWindow: 50 });
      const timeout = new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error('context timeout')), timeoutMs);
      });
      const context = await Promise.race([request, timeout]);
      const text = (context.promptText || '').trim();
      if (!text) return '';
      const clipped = text.length <= 650 ? text : `${text.slice(0, 649).trim()}…`;
      contextCacheRef.current = { text: clipped, ts: Date.now() };
      return clipped;
    } catch (error) {
      appendLog('sys', `context unavailable: ${error instanceof Error ? error.message : 'unknown error'}`);
      const fallback = contextCacheRef.current;
      return fallback.text || '';
    }
  };

  const fetchQnaContextBlock = async (question: string, options?: { timeoutMs?: number }): Promise<string> => {
    if (DIAGNOSTIC_DISABLE_DB_CONTEXT) return '';
    const trimmed = question.trim();
    if (!trimmed) return '';
    const timeoutMs = Math.max(120, options?.timeoutMs ?? QNA_FETCH_TIMEOUT_MS);
    try {
      const request = apiClient.getExerciseQnaContext(residentId, trimmed, { maxSamples: 50 });
      const timeout = new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error('qna context timeout')), timeoutMs);
      });
      const context = await Promise.race([request, timeout]);
      const facts = (context.groundingText || '').trim();
      if (!facts) return '';
      const focus = context.recommendedFocus.length ? ` Suggested focus: ${context.recommendedFocus.join(' ')}` : '';
      const envelope = `${facts}${focus} Rows used: ${context.rowsUsed}.`;
      const clipped = envelope.length <= TOOL_RESULT_MAX_CHARS ? envelope : `${envelope.slice(0, TOOL_RESULT_MAX_CHARS - 1).trim()}…`;
      appendLog('sys', `qna context intent=${context.intent} rows=${context.rowsUsed} stale=${context.staleDataFlag}`);
      return clipped;
    } catch (error) {
      appendLog('sys', `qna context unavailable: ${error instanceof Error ? error.message : 'unknown error'}`);
      return '';
    }
  };

  const signalStartListening = () => {
    if (listeningSignaledRef.current) return;
    listeningSignaledRef.current = true;
    sentAudioChunksRef.current = 0;
    sendLiveAvatarEvent({ type: 'agent.start_listening', event_id: makeEventId() });
    void fetchContextPrompt({ preferCache: false, timeoutMs: 220 });
  };

  const clearPendingTextTurn = () => {
    pendingTextTurnRef.current = null;
    if (textTurnTimeoutRef.current) {
      window.clearTimeout(textTurnTimeoutRef.current);
      textTurnTimeoutRef.current = null;
    }
  };

  const scheduleTextTurnWatchdog = (turnId: string, plainText: string) => {
    clearPendingTextTurn();
    pendingTextTurnRef.current = { id: turnId, plainText, retried: false };
    textTurnTimeoutRef.current = window.setTimeout(() => {
      const pending = pendingTextTurnRef.current;
      if (!pending || pending.id !== turnId) return;
      const ws = elevenWsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (!pending.retried) {
        pending.retried = true;
        sendElevenEvent({ type: 'user_message', text: pending.plainText });
        appendLog('sys', `Retrying stalled text turn id=${turnId} with plain question`);
        textTurnTimeoutRef.current = window.setTimeout(() => {
          if (pendingTextTurnRef.current?.id === turnId) {
            appendLog('sys', `No response after retry for text turn id=${turnId}`);
            clearPendingTextTurn();
          }
        }, 4500);
        return;
      }
      appendLog('sys', `Text turn timeout id=${turnId}`);
      clearPendingTextTurn();
    }, 3500);
  };

  const signalStopListening = () => {
    if (!listeningSignaledRef.current) return;
    listeningSignaledRef.current = false;
    if (sentAudioChunksRef.current > 0) {
      // Eleven websocket examples support chunk streaming; an empty terminal chunk helps
      // finalize VAD turns quickly when user releases PTT/hands-free capture drops.
      sendElevenEvent({ user_audio_chunk: '' });
      appendLog('sys', `Sent end-of-turn audio sentinel (chunks=${sentAudioChunksRef.current})`);
    }
    sendLiveAvatarEvent({ type: 'agent.stop_listening', event_id: makeEventId() });
  };

  const pushRealtimeContextUpdate = async (question?: string) => {
    if (DIAGNOSTIC_DISABLE_DB_CONTEXT) return;
    const now = Date.now();
    if (now - lastContextFetchAtRef.current < REALTIME_CONTEXT_MIN_INTERVAL_MS) return;
    lastContextFetchAtRef.current = now;
    const qnaContext = question ? await fetchQnaContextBlock(question, { timeoutMs: 260 }) : '';
    const contextPrompt = qnaContext || await fetchContextPrompt({ preferCache: true, timeoutMs: 240 });
    if (!contextPrompt) return;
    const realtimeText = contextPrompt.length <= REALTIME_CONTEXT_MAX_CHARS
      ? contextPrompt
      : `${contextPrompt.slice(0, REALTIME_CONTEXT_MAX_CHARS - 1).trim()}…`;
    sendElevenEvent({ type: 'contextual_update', text: realtimeText });
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

  const handleClientToolCall = async (msg: Record<string, unknown>) => {
    const call = (msg.client_tool_call as Record<string, unknown> | undefined) || {};
    const rawToolCallId = call.tool_call_id;
    const toolCallId = (typeof rawToolCallId === 'string' || typeof rawToolCallId === 'number') ? rawToolCallId : '';
    if (toolCallId === '') {
      appendLog('sys', 'client_tool_call missing tool_call_id');
      return;
    }
    const toolName = String(call.tool_name || call.name || 'unknown_tool');
    if (DIAGNOSTIC_DISABLE_DB_CONTEXT) {
      sendElevenEvent({
        type: 'client_tool_result',
        tool_call_id: toolCallId,
        result: 'Context is temporarily disabled for diagnostics.',
        is_error: false,
      });
      appendLog('sys', `Replied to client_tool_call name=${toolName} id=${toolCallId} with diagnostic fallback`);
      return;
    }
    const question = parseToolCallQuestion(call.parameters ?? call.arguments ?? call.input ?? call.params);
    const qnaContext = question ? await fetchQnaContextBlock(question, { timeoutMs: 260 }) : '';
    const fallbackContext = qnaContext || await fetchContextPrompt({ preferCache: true, timeoutMs: 220 });
    const resultText = fallbackContext || 'No recent exercise samples are available yet. Ask the user to continue walking to collect signals.';
    sendElevenEvent({
      type: 'client_tool_result',
      tool_call_id: toolCallId,
      result: resultText,
      is_error: false,
    });
    appendLog('sys', `Replied to client_tool_call name=${toolName} id=${toolCallId}`);
  };

  const maybeRecoverFromProviderError = (msg: Record<string, unknown>) => {
    const details = (msg.details && typeof msg.details === 'object') ? (msg.details as Record<string, unknown>) : {};
    const title = String(details.title || '');
    const detail = String(details.detail || '');
    const signature = `${title}:${detail}`.slice(0, 200);
    if (!signature) return;

    const state = providerRecoveryRef.current;
    if (state.lastSignature !== signature) {
      providerRecoveryRef.current = { lastSignature: signature, attempts: 0 };
    }
    if (providerRecoveryRef.current.attempts >= 1) return;

    const fallbackText = (lastUserText || '').trim();
    if (!fallbackText) return;
    const ws = elevenWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    providerRecoveryRef.current.attempts += 1;
    window.setTimeout(() => {
      sendElevenEvent({ type: 'user_message', text: fallbackText });
      appendLog('sys', 'Recovered provider error by retrying last user text once.');
    }, 250);
  };

  const flushLiveAvatarAudio = () => {
    if (!avatarReadyRef.current) return;
    const turnId = currentTurnIdRef.current;
    if (!turnId) return;
    let buffer = liveAvatarPcmBufferRef.current;
    while (buffer.byteLength >= LIVEAVATAR_CHUNK_BYTES) {
      const chunk = buffer.slice(0, LIVEAVATAR_CHUNK_BYTES);
      buffer = buffer.slice(LIVEAVATAR_CHUNK_BYTES);
      sendLiveAvatarEvent({ type: 'agent.speak', audio: uint8ToBase64(chunk), event_id: turnId });
      if (debugConversion) appendLog('sys', `agent.speak chunk bytes=${chunk.byteLength} b64=${uint8ToBase64(chunk).length}`);
    }
    liveAvatarPcmBufferRef.current = buffer;
  };

  const endAgentTurn = () => {
    const turnId = currentTurnIdRef.current;
    if (!turnId) return;
    if (liveAvatarPcmBufferRef.current.byteLength > 0) {
      const chunk = liveAvatarPcmBufferRef.current;
      liveAvatarPcmBufferRef.current = new Uint8Array(0);
      sendLiveAvatarEvent({ type: 'agent.speak', audio: uint8ToBase64(chunk), event_id: turnId });
    }
    sendLiveAvatarEvent({ type: 'agent.speak_end', event_id: turnId });
    avatarSpeakingRef.current = false;
    currentTurnIdRef.current = null;
  };

  const resetSpeakEndTimer = () => {
    if (speakEndTimerRef.current) {
      window.clearTimeout(speakEndTimerRef.current);
    }
    speakEndTimerRef.current = window.setTimeout(() => {
      endAgentTurn();
      speakEndTimerRef.current = null;
    }, 500);
  };

  const handleBargeIn = async () => {
    if (!avatarSpeakingRef.current) return;
    sendLiveAvatarEvent({ type: 'agent.interrupt' });
    if (speakEndTimerRef.current) {
      window.clearTimeout(speakEndTimerRef.current);
      speakEndTimerRef.current = null;
    }
    currentTurnIdRef.current = null;
    liveAvatarPcmBufferRef.current = new Uint8Array(0);
    avatarSpeakingRef.current = false;
    appendLog('sys', 'Barge-in: interrupted avatar and cleared pending avatar speak buffers');
  };

  const connectLiveKit = async (livekitUrl: string, livekitClientToken: string) => {
    if (!videoHostRef.current) return;
    videoHostRef.current.innerHTML = '';
    const room = new Room();
    livekitRoomRef.current = room;
    room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        appendLog('sys', `LiveKit track subscribed: ${track.kind} (${participant.identity})`);
        const element = track.attach();
        if (track.kind === Track.Kind.Video) {
          element.className = 'h-full w-full rounded-xl object-cover bg-black';
        } else {
          const audioEl = element as HTMLAudioElement;
          audioEl.className = 'hidden';
          audioEl.autoplay = true;
          audioEl.muted = false;
          void audioEl.play().catch(() => appendLog('sys', 'LiveKit audio autoplay blocked; click Start Talking to unlock audio.'));
          videoHostRef.current?.appendChild(audioEl);
          return;
        }
        videoHostRef.current?.appendChild(element);
      },
    );
    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      track.detach().forEach((el: HTMLMediaElement) => el.remove());
    });
    await room.connect(livekitUrl, livekitClientToken);
    appendLog('sys', 'LiveKit connected');
  };

  const connectLiveAvatarWs = async (wsUrl: string) => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      liveAvatarWsRef.current = ws;
      ws.onopen = () => {
        appendLog('sys', 'LiveAvatar websocket connected');
        setLiveAvatarState('ws_connected');
        keepAliveTimerRef.current = window.setInterval(() => {
          sendLiveAvatarEvent({ type: 'session.keep_alive', event_id: makeEventId() });
        }, 45000);
        resolve();
      };
      ws.onerror = () => reject(new Error('LiveAvatar websocket failed'));
      ws.onclose = () => {
        avatarReadyRef.current = false;
        setLiveAvatarState('closed');
      };
      ws.onmessage = (event) => {
        let payload: unknown;
        try {
          payload = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (!payload || typeof payload !== 'object') return;
        const msg = payload as Record<string, unknown>;
        const type = String(msg.type || '');
        if (!LIVEAVATAR_LOG_SUPPRESSED_TYPES.has(type)) {
          appendLog('in', `liveavatar: ${JSON.stringify(compactLiveAvatarPayloadForLog(msg))}`);
        }
        if (type === 'session.state_updated') {
          const sessionState = String(msg.session_state || (msg.session as Record<string, unknown> | undefined)?.state || '').toLowerCase();
          setLiveAvatarState(sessionState || 'updated');
          if (sessionState === 'connected') {
            avatarReadyRef.current = true;
            appendLog('sys', 'LiveAvatar session connected and ready for agent.speak');
          }
        }
      };
    });
  };

  const connectElevenWs = async () => {
    const session = await apiClient.createElevenSession({});
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(session.signed_url);
      elevenWsRef.current = ws;
      ws.onopen = () => {
        appendLog('sys', `ElevenLabs websocket connected (${session.session_id})`);
        elevenInputRateRef.current = ELEVEN_USER_INPUT_RATE;
        sendElevenEvent({
          type: 'conversation_initiation_client_data',
          conversation_config_override: {},
        });
        resolve();
      };
      ws.onerror = () => reject(new Error('ElevenLabs websocket failed'));
      ws.onclose = () => appendLog('sys', 'ElevenLabs websocket closed');
      ws.onmessage = (event) => {
        let payload: unknown;
        try {
          payload = JSON.parse(String(event.data));
        } catch {
          appendLog('in', `eleven raw: ${String(event.data)}`);
          return;
        }
        if (!payload || typeof payload !== 'object') return;
        const msg = payload as Record<string, unknown>;
        const type = String(msg.type || '');
        appendLog('in', `eleven: ${JSON.stringify(compactIncomingElevenPayload(msg))}`);

        if (type === 'ping') {
          const pingEvent = (msg.ping_event as Record<string, unknown> | undefined) || {};
          const eventId = Number(pingEvent.event_id ?? msg.event_id);
          if (Number.isFinite(eventId)) {
            sendElevenEvent({ type: 'pong', event_id: eventId });
          }
          return;
        }

        if (type === 'conversation_initiation_metadata') {
          const metadataEvent = (msg.conversation_initiation_metadata_event as Record<string, unknown> | undefined) || {};
          const audioFormat = String(metadataEvent.agent_output_audio_format || '');
          const parsedRate = parseSampleRate(audioFormat);
          if (parsedRate) {
            elevenOutputRateRef.current = parsedRate;
            appendLog('sys', `Eleven output format=${audioFormat}`);
          }
          const userInputFormat = String(metadataEvent.user_input_audio_format || '');
          const parsedInputRate = parseSampleRate(userInputFormat);
          if (parsedInputRate) {
            elevenInputRateRef.current = parsedInputRate;
            appendLog('sys', `Eleven input format=${userInputFormat}`);
          }
          return;
        }

        if (type === 'client_tool_call') {
          void handleClientToolCall(msg);
          return;
        }

        if (type === 'interruption') {
          endAgentTurn();
          return;
        }

        if (type === 'error') {
          clearPendingTextTurn();
          const details = (msg.details && typeof msg.details === 'object') ? (msg.details as Record<string, unknown>) : {};
          const title = String(details.title || 'Error');
          const detail = String(details.detail || '');
          appendLog('sys', `Eleven error: ${title}${detail ? ` - ${detail}` : ''}`);
          maybeRecoverFromProviderError(msg);
          return;
        }

        if (type === 'audio') {
          clearPendingTextTurn();
          const audioEvent = (msg.audio_event as Record<string, unknown> | undefined) || {};
          const base64 = String(audioEvent.audio_base_64 || '');
          if (!base64) return;
          const rawPcm = base64ToUint8(base64);

          const float32 = pcm16ToFloat32(rawPcm);
          const resampled = resampleLinear(float32, elevenOutputRateRef.current, LIVEAVATAR_TARGET_RATE);
          const pcm24k = float32ToPcm16(resampled);
          liveAvatarPcmBufferRef.current = concatUint8(liveAvatarPcmBufferRef.current, pcm24k);

          if (!currentTurnIdRef.current) currentTurnIdRef.current = makeEventId();
          avatarSpeakingRef.current = true;
          flushLiveAvatarAudio();
          resetSpeakEndTimer();

          if (debugConversion) {
            appendLog('sys', `audio in=${rawPcm.byteLength}B@${elevenOutputRateRef.current} out=${pcm24k.byteLength}B@24000`);
          }
          return;
        }

        const transcript = extractEventText(msg, ['user_transcript', 'transcript', 'user_text']);
        if (transcript && type.includes('transcript')) {
          setLastUserText(transcript);
          void pushRealtimeContextUpdate(transcript);
        }
        const agentText = extractEventText(msg, ['agent_response', 'response', 'text']);
        if (agentText && (type.includes('agent') || type.includes('response'))) {
          clearPendingTextTurn();
          setLastAgentText(agentText);
        }
      };
    });
  };

  const startMicStreaming = async () => {
    if (isTalking) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48000,
      },
    });
    micStreamRef.current = stream;
    const ctx = new AudioContext();
    micCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    micProcessorRef.current = processor;
    speechAttackFramesRef.current = 0;
    speechReleaseFramesRef.current = 0;
    speechActiveRef.current = false;
    noiseFloorRef.current = 0.01;
    vadHighFramesRef.current = 0;
    vadLowFramesRef.current = 0;

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const rms = computeRms(input);
      const peak = computePeak(input);
      const noiseFloor = noiseFloorRef.current;
      const updatedFloor = speechActiveRef.current ? noiseFloor : (noiseFloor * 0.97) + (Math.min(0.06, rms) * 0.03);
      noiseFloorRef.current = Math.max(0.004, Math.min(0.03, updatedFloor));
      const dynamicThreshold = Math.max(0.016, noiseFloorRef.current * 2.8);
      const hasDirectVoice = peak >= 0.05 && rms >= dynamicThreshold;
      const isSpeechStrong = hasDirectVoice && rms >= dynamicThreshold * 1.05;
      const isSpeechWeak = hasDirectVoice && rms >= dynamicThreshold * 0.85;
      const shouldUseHandsfree = captureMode === 'handsfree';
      let shouldSendChunk = false;

      if (shouldUseHandsfree) {
        if (isSpeechStrong) {
          speechAttackFramesRef.current += 1;
          speechReleaseFramesRef.current = 0;
        } else if (speechActiveRef.current && isSpeechWeak) {
          speechReleaseFramesRef.current = 0;
        } else {
          speechAttackFramesRef.current = 0;
          speechReleaseFramesRef.current += 1;
        }

        if (!speechActiveRef.current && speechAttackFramesRef.current >= 3) {
          speechActiveRef.current = true;
          if (avatarSpeakingRef.current) void handleBargeIn();
          signalStartListening();
        }
        if (speechActiveRef.current && speechReleaseFramesRef.current >= 12) {
          speechActiveRef.current = false;
          signalStopListening();
        }
        shouldSendChunk = speechActiveRef.current && (isSpeechStrong || isSpeechWeak);
      } else {
        if (pttPressedRef.current) {
          if (!speechActiveRef.current) {
            speechActiveRef.current = true;
            if (avatarSpeakingRef.current) void handleBargeIn();
            signalStartListening();
          }
          shouldSendChunk = isSpeechWeak;
        } else if (speechActiveRef.current) {
          speechActiveRef.current = false;
          signalStopListening();
        }
      }

      if (!shouldSendChunk) return;

      const targetInputRate = Math.max(8000, elevenInputRateRef.current || ELEVEN_USER_INPUT_RATE);
      const downsampled = resampleLinear(input, ctx.sampleRate, targetInputRate);
      const pcm16 = float32ToPcm16(downsampled);
      sendElevenEvent({ user_audio_chunk: uint8ToBase64(pcm16) });
      sentAudioChunksRef.current += 1;
    };

    source.connect(processor);
    processor.connect(ctx.destination);
    setIsTalking(true);
    appendLog('sys', 'Microphone streaming started');
  };

  const stopMicStreaming = async () => {
    setIsTalking(false);
    setPttPressed(false);
    pttPressedRef.current = false;
    speechActiveRef.current = false;
    speechAttackFramesRef.current = 0;
    speechReleaseFramesRef.current = 0;
    if (micProcessorRef.current) {
      micProcessorRef.current.disconnect();
      micProcessorRef.current.onaudioprocess = null;
      micProcessorRef.current = null;
    }
    if (micCtxRef.current) {
      await micCtxRef.current.close();
      micCtxRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    signalStopListening();
    appendLog('sys', 'Microphone streaming stopped');
  };

  const beginPtt = async () => {
    if (status !== 'connected') return;
    if (!isTalking) await startMicStreaming();
    pttPressedRef.current = true;
    setPttPressed(true);
  };

  const endPtt = () => {
    pttPressedRef.current = false;
    setPttPressed(false);
  };

  const startSession = async () => {
    if (status === 'connecting' || status === 'connected') return;
    if (!videoHostRef.current) {
      notify('Video host not ready yet.', 'warn');
      return;
    }
    setStatus('connecting');
    setLastUserText('');
    setLastAgentText('');
    setLiveAvatarState('starting');
    try {
      const session = await apiClient.createLiveAvatarSession({});
      if (!session.ok || !session.livekit_url || !session.livekit_client_token || !session.ws_url) {
        throw new Error(session.error || 'LiveAvatar session bootstrap failed');
      }

      await connectLiveKit(session.livekit_url, session.livekit_client_token);
      await connectLiveAvatarWs(session.ws_url);
      await connectElevenWs();
      void fetchContextPrompt({ preferCache: false, timeoutMs: 240 });

      setStatus('connected');
      appendLog('sys', 'Session fully connected (LiveKit + LiveAvatar WS + Eleven WS)');
    } catch (error) {
      setStatus('error');
      notify(error instanceof Error ? error.message : 'Failed to start bridge session.', 'error');
    }
  };

  async function stopSession() {
    setStatus('disconnected');
    avatarReadyRef.current = false;
    if (keepAliveTimerRef.current) {
      window.clearInterval(keepAliveTimerRef.current);
      keepAliveTimerRef.current = null;
    }
    if (speakEndTimerRef.current) {
      window.clearTimeout(speakEndTimerRef.current);
      speakEndTimerRef.current = null;
    }
    clearPendingTextTurn();
    await stopMicStreaming();
    endAgentTurn();

    if (elevenWsRef.current && elevenWsRef.current.readyState <= WebSocket.OPEN) elevenWsRef.current.close(1000, 'manual stop');
    elevenWsRef.current = null;
    if (liveAvatarWsRef.current && liveAvatarWsRef.current.readyState <= WebSocket.OPEN) liveAvatarWsRef.current.close(1000, 'manual stop');
    liveAvatarWsRef.current = null;

    if (livekitRoomRef.current) {
      try {
        livekitRoomRef.current.removeAllListeners();
        await livekitRoomRef.current.disconnect();
      } catch {
        // best effort
      }
      livekitRoomRef.current = null;
    }
    setLiveAvatarState('idle');
    appendLog('sys', 'Disconnected all bridge resources');
  }

  const sendText = async () => {
    const text = inputText.trim();
    if (!text) return;
    setLastUserText(text);
    const turnId = makeEventId();
    sendElevenEvent({ type: 'user_message', text });
    scheduleTextTurnWatchdog(turnId, text);
    setInputText('');
  };

  return (
    <div className="rounded-2xl bg-slate-900 p-4 sm:p-6">
      <h3 className="text-2xl font-black text-white">ElevenLabs + LiveAvatar LITE Bridge</h3>
      <p className="mt-1 text-sm text-slate-300">Mic -&gt; ElevenLabs -&gt; LiveAvatar agent.speak -&gt; LiveKit avatar video+audio.</p>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-700 bg-black p-2">
            <div ref={videoHostRef} className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-950 text-xs text-slate-400">
              Waiting for avatar video track...
            </div>
          </div>
          <p className="text-xs text-slate-300">
            Session: <span className="font-bold">{status}</span> | LiveAvatar state: <span className="font-bold">{liveAvatarState}</span> | Mic:{' '}
            <span className="font-bold">{isTalking ? 'active' : 'idle'}</span>
          </p>
          <div className="flex items-center gap-2 text-xs text-slate-200">
            <span className="text-slate-300">Capture mode:</span>
            <button
              type="button"
              onClick={() => {
                setCaptureMode('ptt');
                void stopMicStreaming();
              }}
              className={`rounded-md px-2 py-1 font-bold ${captureMode === 'ptt' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-200'}`}
            >
              Push-to-talk (default)
            </button>
            <button
              type="button"
              onClick={() => {
                setCaptureMode('handsfree');
                endPtt();
              }}
              className={`rounded-md px-2 py-1 font-bold ${captureMode === 'handsfree' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-200'}`}
            >
              Hands-free
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void startSession()}
              disabled={status === 'connecting' || status === 'connected'}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              Start Session
            </button>
            <button
              type="button"
              onClick={() => void stopSession()}
              disabled={status === 'idle' || status === 'disconnected'}
              className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              Stop
            </button>
            {captureMode === 'handsfree' ? (
              <>
                <button
                  type="button"
                  onClick={() => void startMicStreaming()}
                  disabled={status !== 'connected' || isTalking}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  Start Hands-free
                </button>
                <button
                  type="button"
                  onClick={() => void stopMicStreaming()}
                  disabled={!isTalking}
                  className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  Stop Hands-free
                </button>
              </>
            ) : (
              <button
                type="button"
                onMouseDown={() => void beginPtt()}
                onMouseUp={endPtt}
                onMouseLeave={endPtt}
                onTouchStart={() => void beginPtt()}
                onTouchEnd={endPtt}
                disabled={status !== 'connected'}
                className={`rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50 ${pttPressed ? 'bg-rose-700' : 'bg-indigo-600'}`}
              >
                {pttPressed ? 'Listening… release to stop' : 'Hold to Talk'}
              </button>
            )}
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={debugConversion} onChange={(event) => setDebugConversion(event.target.checked)} />
            Debug audio conversion logs
          </label>
        </div>

        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-slate-200">
              <p className="text-xs text-slate-400">You</p>
              <p>{lastUserText || '...'}</p>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-slate-200">
              <p className="text-xs text-slate-400">Agent</p>
              <p>{lastAgentText || '...'}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <input
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void sendText();
              }}
              placeholder="Optional text input to prompt agent..."
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            />
            <button
              type="button"
              onClick={() => void sendText()}
              disabled={status !== 'connected' || !inputText.trim()}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              Send
            </button>
          </div>
          <div className="max-h-60 overflow-auto rounded-lg border border-slate-700 bg-slate-950 p-3 text-xs text-slate-300">
            {logs.length ? logs.map((log) => <p key={log.id}>[{log.ts}] {log.direction.toUpperCase()}: {log.text}</p>) : <p>No events yet.</p>}
          </div>
        </div>
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

function makeEventId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseSampleRate(format: string): number | null {
  const match = format.match(/pcm_(\d+)/i);
  if (!match) return null;
  const rate = Number(match[1]);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function base64ToUint8(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return window.btoa(binary);
}

function pcm16ToFloat32(pcm16le: Uint8Array): Float32Array {
  const frames = Math.floor(pcm16le.byteLength / 2);
  const out = new Float32Array(frames);
  const view = new DataView(pcm16le.buffer, pcm16le.byteOffset, pcm16le.byteLength);
  for (let i = 0; i < frames; i += 1) {
    out[i] = view.getInt16(i * 2, true) / 32768;
  }
  return out;
}

function float32ToPcm16(float32: Float32Array): Uint8Array {
  const out = new Uint8Array(float32.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < float32.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    const sample = clamped < 0 ? clamped * 32768 : clamped * 32767;
    view.setInt16(i * 2, Math.round(sample), true);
  }
  return out;
}

function resampleLinear(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (!input.length || inRate === outRate) return input;
  const ratio = outRate / inRate;
  const outLength = Math.max(1, Math.round(input.length * ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const srcIndex = i / ratio;
    const lo = Math.floor(srcIndex);
    const hi = Math.min(lo + 1, input.length - 1);
    const frac = srcIndex - lo;
    out[i] = input[lo] * (1 - frac) + input[hi] * frac;
  }
  return out;
}

function concatUint8(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (!a.byteLength) return b;
  if (!b.byteLength) return a;
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

function computeRms(input: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < input.length; i += 1) sum += input[i] * input[i];
  return Math.sqrt(sum / Math.max(input.length, 1));
}

function computePeak(input: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < input.length; i += 1) {
    const abs = Math.abs(input[i]);
    if (abs > peak) peak = abs;
  }
  return peak;
}


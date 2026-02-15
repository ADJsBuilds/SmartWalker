import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrack, type RemoteTrackPublication } from 'livekit-client';

import type { ApiClient } from '../lib/apiClient';

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

const LIVEAVATAR_TARGET_RATE = 24000;
const ELEVEN_USER_INPUT_RATE = 16000;
const LIVEAVATAR_CHUNK_SECONDS = 1;
const LIVEAVATAR_CHUNK_BYTES = LIVEAVATAR_TARGET_RATE * 2 * LIVEAVATAR_CHUNK_SECONDS;

export function ElevenLabsConversationPanel({ apiClient, notify }: ElevenLabsConversationPanelProps) {
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [isTalking, setIsTalking] = useState(false);
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
  const vadHighFramesRef = useRef(0);
  const vadLowFramesRef = useRef(0);

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

  const sendLiveAvatarEvent = (payload: Record<string, unknown>) => {
    const ws = liveAvatarWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
    appendLog('out', `liveavatar: ${JSON.stringify(payload)}`);
  };

  const sendElevenEvent = (payload: Record<string, unknown>) => {
    const ws = elevenWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
    appendLog('out', `eleven: ${JSON.stringify(payload)}`);
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
        appendLog('in', `liveavatar: ${JSON.stringify(msg)}`);
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
        appendLog('in', `eleven: ${JSON.stringify(msg)}`);

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
          return;
        }

        if (type === 'interruption') {
          endAgentTurn();
          return;
        }

        if (type === 'audio') {
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
        }
        const agentText = extractEventText(msg, ['agent_response', 'response', 'text']);
        if (agentText && (type.includes('agent') || type.includes('response'))) {
          setLastAgentText(agentText);
        }
      };
    });
  };

  const startMicStreaming = async () => {
    if (isTalking) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStreamRef.current = stream;
    const ctx = new AudioContext();
    micCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    micProcessorRef.current = processor;

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const rms = computeRms(input);
      if (rms > 0.02) {
        vadHighFramesRef.current += 1;
        vadLowFramesRef.current = 0;
      } else if (rms < 0.01) {
        vadLowFramesRef.current += 1;
      }

      if (vadHighFramesRef.current >= 2) {
        if (!isTalking) setIsTalking(true);
        if (avatarSpeakingRef.current) {
          void handleBargeIn();
        }
        sendLiveAvatarEvent({ type: 'agent.start_listening', event_id: makeEventId() });
        vadHighFramesRef.current = 0;
      }
      if (vadLowFramesRef.current >= 8) {
        setIsTalking(false);
        sendLiveAvatarEvent({ type: 'agent.stop_listening', event_id: makeEventId() });
        vadLowFramesRef.current = 0;
      }

      const downsampled = resampleLinear(input, ctx.sampleRate, ELEVEN_USER_INPUT_RATE);
      const pcm16 = float32ToPcm16(downsampled);
      sendElevenEvent({ user_audio_chunk: uint8ToBase64(pcm16) });
    };

    source.connect(processor);
    processor.connect(ctx.destination);
    setIsTalking(true);
    appendLog('sys', 'Microphone streaming started');
  };

  const stopMicStreaming = async () => {
    setIsTalking(false);
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
    sendLiveAvatarEvent({ type: 'agent.stop_listening', event_id: makeEventId() });
    appendLog('sys', 'Microphone streaming stopped');
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

  const sendText = () => {
    const text = inputText.trim();
    if (!text) return;
    setLastUserText(text);
    sendElevenEvent({ type: 'user_message', text });
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
            <button
              type="button"
              onClick={() => void startMicStreaming()}
              disabled={status !== 'connected' || isTalking}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              Start Talking
            </button>
            <button
              type="button"
              onClick={() => void stopMicStreaming()}
              disabled={!isTalking}
              className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              Stop Talking
            </button>
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
                if (event.key === 'Enter') sendText();
              }}
              placeholder="Optional text input to prompt agent..."
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


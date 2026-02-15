import { useEffect, useMemo, useRef, useState } from 'react';
import { Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrack, type RemoteTrackPublication } from 'livekit-client';

import {
  createLiveAvatarLiteSession,
  getLiveAvatarLiteStatus,
  startLiveAvatarLiteSession,
  stopLiveAvatarLiteSession,
} from './liveavatarLite';

type WsStatus = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';
type AvatarStatus = 'idle' | 'starting' | 'connected' | 'ready' | 'error';
type LogDirection = 'in' | 'out' | 'sys';

interface LogItem {
  id: string;
  ts: string;
  direction: LogDirection;
  text: string;
}

function nowTs(): string {
  return new Date().toLocaleTimeString();
}

function toWsUrl(httpBase: string, path: string): string {
  const trimmed = httpBase.trim().replace(/\/+$/, '');
  const wsBase = trimmed.startsWith('https://') ? trimmed.replace('https://', 'wss://') : trimmed.replace('http://', 'ws://');
  return `${wsBase}${path}`;
}

function compactPayload(payload: unknown): string {
  try {
    if (!payload || typeof payload !== 'object') return String(payload);
    const clone: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
    for (const key of ['audio_base64', 'audio', 'chunk']) {
      const v = clone[key];
      if (typeof v === 'string') {
        const approxBytes = Math.max(0, Math.floor((v.length * 3) / 4));
        clone[key] = `<${approxBytes} bytes base64>`;
      }
    }
    return JSON.stringify(clone);
  } catch {
    return String(payload);
  }
}

function useLog(max = 250) {
  const [logs, setLogs] = useState<LogItem[]>([]);
  const push = (direction: LogDirection, text: string) => {
    setLogs((prev) => [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ts: nowTs(), direction, text }, ...prev].slice(0, max));
  };
  return { logs, push, clear: () => setLogs([]) };
}

function LogPanel({ title, logs }: { title: string; logs: LogItem[] }) {
  return (
    <div className="panel">
      <h3>{title}</h3>
      <div className="logbox">
        {logs.length ? (
          logs.map((l) => (
            <div key={l.id} className={`logline ${l.direction}`}>
              <span className="ts">[{l.ts}]</span> <span className="dir">{l.direction.toUpperCase()}</span> {l.text}
            </div>
          ))
        ) : (
          <div className="muted">No events yet.</div>
        )}
      </div>
    </div>
  );
}

function StateStreamPanel({ baseUrl }: { baseUrl: string }) {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<WsStatus>('idle');
  const [residentId, setResidentId] = useState('');
  const [snapshotCount, setSnapshotCount] = useState(0);
  const [lastUpdateTs, setLastUpdateTs] = useState('');
  const { logs, push, clear } = useLog();

  const connect = () => {
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return;
    const query = residentId.trim() ? `?residentId=${encodeURIComponent(residentId.trim())}` : '';
    const url = toWsUrl(baseUrl, `/ws/live${query}`);
    setStatus('connecting');
    push('sys', `connect ${url}`);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      push('sys', 'connected');
    };
    ws.onerror = () => {
      setStatus('error');
      push('sys', 'websocket error');
    };
    ws.onclose = () => {
      setStatus('closed');
      push('sys', 'closed');
      wsRef.current = null;
    };
    ws.onmessage = (event) => {
      push('in', String(event.data));
      try {
        const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
        const type = String(msg.type || '');
        if (type === 'snapshot' && Array.isArray(msg.data)) {
          setSnapshotCount(msg.data.length);
        }
        if (type === 'merged_update' && msg.data && typeof msg.data === 'object') {
          const ts = (msg.data as Record<string, unknown>).ts;
          setLastUpdateTs(String(ts ?? ''));
        }
      } catch {
        // leave as raw
      }
    };
  };

  const disconnect = () => {
    wsRef.current?.close(1000, 'manual disconnect');
    wsRef.current = null;
  };

  const ping = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send('ping');
    push('out', 'ping');
  };

  return (
    <div className="panel">
      <h2>State WebSocket (/ws/live)</h2>
      <div className="row">
        <input value={residentId} onChange={(e) => setResidentId(e.target.value)} placeholder="residentId (optional)" />
        <button onClick={connect}>Connect</button>
        <button onClick={disconnect}>Disconnect</button>
        <button onClick={ping}>Ping</button>
        <button onClick={clear}>Clear Logs</button>
      </div>
      <div className="meta">status: <b>{status}</b> | snapshot rows: <b>{snapshotCount}</b> | last merged ts: <b>{lastUpdateTs || '-'}</b></div>
      <LogPanel title="State Stream Events" logs={logs} />
    </div>
  );
}

function AvatarPanel({
  baseUrl,
  onSessionChange,
}: {
  baseUrl: string;
  onSessionChange: (sessionId: string | null) => void;
}) {
  const videoHostRef = useRef<HTMLDivElement | null>(null);
  const roomRef = useRef<Room | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const sessionRef = useRef<{ sessionId: string; sessionToken: string | null; agentWsRegistered: boolean } | null>(null);
  const hasVideoTrackRef = useRef(false);
  const [status, setStatus] = useState<AvatarStatus>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [agentWsRegistered, setAgentWsRegistered] = useState(false);
  const [backendExists, setBackendExists] = useState(false);
  const [backendWsConnected, setBackendWsConnected] = useState(false);
  const [backendReady, setBackendReady] = useState(false);
  const [backendSessionState, setBackendSessionState] = useState('-');
  const [backendLastError, setBackendLastError] = useState('');
  const [errorText, setErrorText] = useState('');

  const clearPoll = () => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const startStatusPolling = (activeSessionId: string) => {
    clearPoll();
    const poll = async () => {
      try {
        const liveStatus = await getLiveAvatarLiteStatus(baseUrl, activeSessionId);
        const exists = Boolean(liveStatus.exists);
        const wsConnected = Boolean(liveStatus.ws_connected);
        const ready = Boolean(liveStatus.ready);
        setBackendExists(exists);
        setBackendWsConnected(wsConnected);
        setBackendReady(ready);
        setBackendSessionState(String(liveStatus.session_state || '-'));
        setBackendLastError(String(liveStatus.last_error || ''));
        if (ready || hasVideoTrackRef.current) {
          setStatus('ready');
        } else if (exists) {
          setStatus('connected');
        }
        if (liveStatus.last_error) setErrorText(String(liveStatus.last_error));
      } catch {
        // Keep existing status if status endpoint is temporarily unavailable.
      }
    };
    void poll();
    pollTimerRef.current = window.setInterval(() => void poll(), 2000);
  };

  const startSession = async () => {
    if (status === 'starting') return;
    await stopSession();
    setErrorText('');
    setSessionId(null);
    setAgentWsRegistered(false);
    setBackendExists(false);
    setBackendWsConnected(false);
    setBackendReady(false);
    setBackendSessionState('-');
    setBackendLastError('');
    hasVideoTrackRef.current = false;
    setStatus('starting');
    try {
      const created = await createLiveAvatarLiteSession(baseUrl);
      const createdToken = String(created.session_token || '').trim();
      if (!created.ok || !createdToken) {
        throw new Error(created.error || 'Failed to create LiveAvatar LITE session');
      }

      const started = await startLiveAvatarLiteSession(baseUrl, { session_token: createdToken });
      const createdSessionId = String(created.session_id || '').trim();
      const startedSessionId = String(started.session_id || createdSessionId).trim();
      const livekitUrl = String(started.livekit_url || '').trim();
      const livekitClientToken = String(started.livekit_client_token || '').trim();
      const registered = Boolean(started.agent_ws_registered);
      if (!started.ok || !startedSessionId || !livekitUrl || !livekitClientToken) {
        throw new Error(started.error || 'Failed to start LiveAvatar LITE session');
      }

      const host = videoHostRef.current;
      if (host) host.innerHTML = '';
      const room = new Room();
      roomRef.current = room;
      room.on(
        RoomEvent.TrackSubscribed,
        (track: RemoteTrack, _publication: RemoteTrackPublication, _participant: RemoteParticipant) => {
          const hostElement = videoHostRef.current;
          if (!hostElement) return;
          const element = track.attach();
          if (track.kind === Track.Kind.Video) {
            hasVideoTrackRef.current = true;
            element.className = 'avatar-video';
            setStatus('ready');
          } else {
            element.className = 'avatar-audio';
            const audioEl = element as HTMLAudioElement;
            audioEl.autoplay = true;
            audioEl.muted = false;
            void audioEl.play().catch(() => {
              setErrorText('Audio autoplay blocked. Interact with the page and retry.');
            });
          }
          hostElement.appendChild(element);
        },
      );
      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach((el: HTMLMediaElement) => el.remove());
        if (track.kind === Track.Kind.Video) {
          hasVideoTrackRef.current = false;
          if (!backendReady) setStatus('connected');
        }
      });
      await room.connect(livekitUrl, livekitClientToken);

      sessionRef.current = { sessionId: startedSessionId, sessionToken: createdToken, agentWsRegistered: registered };
      setSessionId(startedSessionId);
      setAgentWsRegistered(registered);
      onSessionChange(registered ? startedSessionId : null);
      setStatus('connected');
      if (!registered) {
        setErrorText('LiveAvatar started but backend manager did not register ws (agent_ws_registered=false). Voice bridge disabled.');
      }
      startStatusPolling(startedSessionId);
    } catch (error) {
      setStatus('error');
      setErrorText(error instanceof Error ? error.message : 'Failed to start avatar session');
      onSessionChange(null);
    }
  };

  const stopSession = async () => {
    clearPoll();
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      try {
        room.removeAllListeners();
        await room.disconnect();
      } catch {
        // Best effort room cleanup.
      }
    }

    const session = sessionRef.current;
    sessionRef.current = null;
    if (session && session.sessionToken) {
      try {
        await stopLiveAvatarLiteSession(baseUrl, {
          session_id: session.sessionId,
          session_token: session.sessionToken,
        });
      } catch {
        // Best effort backend stop.
      }
    }

    const host = videoHostRef.current;
    if (host) {
      host.innerHTML = '';
      const placeholder = document.createElement('p');
      placeholder.className = 'muted';
      placeholder.textContent = 'Avatar video will appear here.';
      host.appendChild(placeholder);
    }

    setSessionId(null);
    setAgentWsRegistered(false);
    setBackendExists(false);
    setBackendWsConnected(false);
    setBackendReady(false);
    setBackendSessionState('-');
    setBackendLastError('');
    hasVideoTrackRef.current = false;
    onSessionChange(null);
    setStatus('idle');
  };

  useEffect(() => {
    return () => {
      void stopSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="panel">
      <h2>LiveAvatar LITE (via LiveKit)</h2>
      <div className="row">
        <button onClick={() => void startSession()}>Start Avatar Session</button>
        <button onClick={() => void stopSession()}>Stop Avatar Session</button>
      </div>
      <div className="meta">
        status: <b>{status}</b> | session: <b>{sessionId || '-'}</b>
      </div>
      <div className="meta">
        agent_ws_registered: <b>{String(agentWsRegistered)}</b> | exists: <b>{String(backendExists)}</b> | ws_connected:{' '}
        <b>{String(backendWsConnected)}</b> | ready: <b>{String(backendReady)}</b> | session_state: <b>{backendSessionState}</b>
      </div>
      {backendLastError ? <div className="meta">backend_last_error: <b>{backendLastError}</b></div> : null}
      {errorText ? <div className="meta">error: <b>{errorText}</b></div> : null}
      <div className="avatar-host" ref={videoHostRef}>
        <p className="muted">Avatar video will appear here.</p>
      </div>
    </div>
  );
}

function VoiceAgentPanel({ baseUrl, liveavatarSessionId }: { baseUrl: string; liveavatarSessionId: string | null }) {
  const STREAM_TIMESLICE_MS = 140;
  const STREAM_BUFFER_CAP_BYTES = 2_000_000;
  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeUtteranceRef = useRef<{
    sessionId: string;
    sequenceNumber: number;
    droppedChunks: number;
    speechEndMs: number | null;
    lastChunkSentMs: number | null;
  } | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextStartRef = useRef(0);

  const [status, setStatus] = useState<WsStatus>('idle');
  const [residentId, setResidentId] = useState('r1');
  const [question, setQuestion] = useState('How am I doing today?');
  const [latestTranscript, setLatestTranscript] = useState('');
  const [latestAnswer, setLatestAnswer] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [avatarSync, setAvatarSync] = useState('idle');
  const { logs, push, clear } = useLog(400);

  const ensureAudioContext = async (): Promise<AudioContext> => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
      nextStartRef.current = 0;
    }
    if (audioCtxRef.current.state === 'suspended') await audioCtxRef.current.resume();
    return audioCtxRef.current;
  };

  const playPcm16Base64 = async (base64Audio: string, sampleRateHz = 24000) => {
    const ctx = await ensureAudioContext();
    const binary = atob(base64Audio);
    const sampleCount = Math.floor(binary.length / 2);
    if (sampleCount <= 0) return;

    const floatData = new Float32Array(sampleCount);
    let byteIndex = 0;
    for (let i = 0; i < sampleCount; i += 1) {
      const low = binary.charCodeAt(byteIndex++) & 0xff;
      const high = binary.charCodeAt(byteIndex++) & 0xff;
      let int16 = (high << 8) | low;
      if (int16 & 0x8000) int16 -= 0x10000;
      floatData[i] = int16 / 32768;
    }

    const buffer = ctx.createBuffer(1, sampleCount, sampleRateHz);
    buffer.copyToChannel(floatData, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime + 0.02, nextStartRef.current);
    src.start(startAt);
    nextStartRef.current = startAt + buffer.duration;
  };

  const sendSessionStart = (resident: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const msg: Record<string, unknown> = { type: 'session.start', resident_id: resident };
    if (liveavatarSessionId) msg.liveavatar_session_id = liveavatarSessionId;
    ws.send(JSON.stringify(msg));
    push('out', compactPayload(msg));
  };

  const connect = () => {
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return;
    const query = residentId.trim() ? `?residentId=${encodeURIComponent(residentId.trim())}` : '';
    const url = toWsUrl(baseUrl, `/ws/voice-agent${query}`);
    setStatus('connecting');
    push('sys', `connect ${url}`);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      push('sys', 'connected');
      sendSessionStart(residentId.trim() || 'r1');
    };
    ws.onerror = () => {
      setStatus('error');
      push('sys', 'websocket error');
    };
    ws.onclose = () => {
      setStatus('closed');
      push('sys', 'closed');
      wsRef.current = null;
      setIsRecording(false);
      activeUtteranceRef.current = null;
    };
    ws.onmessage = (event) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        push('in', String(event.data));
        return;
      }
      push('in', compactPayload(msg));
      if (!msg || typeof msg !== 'object') return;
      const rec = msg as Record<string, unknown>;
      const type = String(rec.type || '');
      if (type === 'user_transcript') {
        setIsTranscribing(false);
        setLatestTranscript(String(rec.user_transcript || ''));
      }
      if (type === 'agent_response') {
        setLatestAnswer(String(rec.text || ''));
      }
      if (type === 'audio_chunk') {
        const b64 = rec.audio_base64;
        const rate = Number(rec.sample_rate_hz || 24000);
        if (typeof b64 === 'string' && b64) void playPcm16Base64(b64, Number.isFinite(rate) ? rate : 24000);
      }
      if (type === 'error') {
        setIsTranscribing(false);
      }
      if (type === 'debug') {
        const stage = String(rec.stage || '');
        if (stage === 'liveavatar_stream_start') setAvatarSync('syncing');
        if (stage === 'liveavatar_stream_ok') setAvatarSync('ok');
        if (stage === 'liveavatar_stream_error') setAvatarSync('error');
      }
    };
  };

  useEffect(() => {
    if (status !== 'connected') return;
    sendSessionStart(residentId.trim() || 'r1');
    // Rebind backend session context when avatar session changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveavatarSessionId]);

  const disconnect = async () => {
    wsRef.current?.close(1000, 'manual disconnect');
    wsRef.current = null;
    if (recorderRef.current && recorderRef.current.state === 'recording') recorderRef.current.stop();
    recorderRef.current = null;
    activeUtteranceRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
    setIsTranscribing(false);
    if (audioCtxRef.current) {
      await audioCtxRef.current.close();
      audioCtxRef.current = null;
      nextStartRef.current = 0;
    }
  };

  const sendText = () => {
    const ws = wsRef.current;
    const text = question.trim();
    if (!ws || ws.readyState !== WebSocket.OPEN || !text) return;
    setIsTranscribing(false);
    const msg = { type: 'user_message', resident_id: residentId.trim() || 'r1', text } as Record<string, unknown>;
    if (liveavatarSessionId) msg.liveavatar_session_id = liveavatarSessionId;
    ws.send(JSON.stringify(msg));
    push('out', compactPayload(msg));
  };

  const startHoldToTalk = async () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (recorderRef.current && recorderRef.current.state === 'recording') return;

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      push('sys', 'microphone recording unsupported in this browser');
      return;
    }

    try {
      setIsTranscribing(false);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      const mimeType = preferred.find((m) => MediaRecorder.isTypeSupported(m));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;

      const trackSettings = stream.getAudioTracks()[0]?.getSettings?.() || {};
      const sampleRate = Number(trackSettings.sampleRate || 48000);
      const channels = Number(trackSettings.channelCount || 1);
      const utterance = {
        sessionId: `utt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        sequenceNumber: 0,
        droppedChunks: 0,
        speechEndMs: null as number | null,
        lastChunkSentMs: null as number | null,
      };
      activeUtteranceRef.current = utterance;

      const startPayload: Record<string, unknown> = {
        type: 'user_audio_start',
        session_id: utterance.sessionId,
        codec: mimeType || recorder.mimeType || 'audio/webm',
        sample_rate: Number.isFinite(sampleRate) ? sampleRate : 48000,
        channels: Number.isFinite(channels) ? channels : 1,
        timestamp_ms: Date.now(),
        resident_id: residentId.trim() || 'r1',
      };
      if (liveavatarSessionId) startPayload.liveavatar_session_id = liveavatarSessionId;
      ws.send(JSON.stringify(startPayload));
      push('out', compactPayload(startPayload));

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size <= 0) return;
        const current = activeUtteranceRef.current;
        const openWs = wsRef.current;
        if (!current || !openWs || openWs.readyState !== WebSocket.OPEN) return;
        if (openWs.bufferedAmount > STREAM_BUFFER_CAP_BYTES) {
          current.droppedChunks += 1;
          if (current.droppedChunks % 10 === 1) push('sys', `audio backpressure dropping chunks=${current.droppedChunks}`);
          return;
        }
        current.sequenceNumber += 1;
        current.lastChunkSentMs = Date.now();
        const metaPayload = {
          type: 'user_audio_chunk_meta',
          session_id: current.sessionId,
          sequence_number: current.sequenceNumber,
          byte_length: event.data.size,
          timestamp_ms: Date.now(),
        };
        openWs.send(JSON.stringify(metaPayload));
        push('out', compactPayload(metaPayload));
        openWs.send(event.data);
      };
      recorder.onerror = () => {
        setIsRecording(false);
        setIsTranscribing(false);
        push('sys', 'recorder error');
      };
      recorder.onstop = () => {
        const current = activeUtteranceRef.current;
        if (current && current.speechEndMs === null) current.speechEndMs = Date.now();
        setIsRecording(false);
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (!current) return;
        const openWs = wsRef.current;
        if (!openWs || openWs.readyState !== WebSocket.OPEN) {
          activeUtteranceRef.current = null;
          return;
        }
        const endPayload: Record<string, unknown> = {
          type: 'user_audio_end',
          session_id: current.sessionId,
          last_sequence_number: current.sequenceNumber,
          timestamp_ms: Date.now(),
          speech_end_ms: current.speechEndMs,
          last_chunk_sent_ms: current.lastChunkSentMs,
          resident_id: residentId.trim() || 'r1',
        };
        if (liveavatarSessionId) endPayload.liveavatar_session_id = liveavatarSessionId;
        openWs.send(JSON.stringify(endPayload));
        push('out', compactPayload(endPayload));
        activeUtteranceRef.current = null;
        setIsTranscribing(true);
        setLatestTranscript('Transcribing audio...');
      };

      setIsRecording(true);
      recorder.start(STREAM_TIMESLICE_MS);
      push('sys', 'hold-to-talk recording started');
    } catch (error) {
      setIsRecording(false);
      setIsTranscribing(false);
      push('sys', error instanceof Error ? error.message : 'failed to start recording');
    }
  };

  const endHoldToTalk = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    recorder.stop();
    push('sys', 'hold-to-talk released');
  };

  const ping = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const msg = { type: 'ping', event_id: String(Date.now()) };
    ws.send(JSON.stringify(msg));
    push('out', compactPayload(msg));
  };

  const statusText = isRecording ? 'recording' : isTranscribing ? 'transcribing' : 'idle';

  return (
    <div className="panel">
      <h2>Voice Agent WebSocket (/ws/voice-agent)</h2>
      <div className="row">
        <input value={residentId} onChange={(e) => setResidentId(e.target.value)} placeholder="residentId" />
        <button onClick={connect}>Connect</button>
        <button onClick={() => void disconnect()}>Disconnect</button>
        <button onClick={ping}>Ping</button>
        <button onClick={clear}>Clear Logs</button>
      </div>
      <div className="row">
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask a text question" />
        <button onClick={sendText}>Send Text</button>
        <button
          onPointerDown={() => void startHoldToTalk()}
          onPointerUp={endHoldToTalk}
          onPointerCancel={endHoldToTalk}
          onPointerLeave={endHoldToTalk}
        >
          {isRecording ? 'Release to Send' : 'Hold to Talk'}
        </button>
      </div>
      <div className="meta">status: <b>{status}</b> | mic: <b>{statusText}</b> | avatar sync: <b>{avatarSync}</b></div>
      <div className="panel transcript">
        <h3>Live Transcription (from backend STT)</h3>
        <div className="value">{latestTranscript || '-'}</div>
        <h3>Latest Agent Response</h3>
        <div className="value">{latestAnswer || '-'}</div>
      </div>
      <LogPanel title="Voice Stream Events" logs={logs} />
    </div>
  );
}

export function App() {
  const [baseUrl, setBaseUrl] = useState(() => {
    const envValue = String(import.meta.env.VITE_API_BASE_URL || '').trim();
    if (envValue) return envValue;
    if (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)) return 'http://localhost:8000';
    return 'https://smartwalker-back.onrender.com';
  });
  const [liveavatarSessionId, setLiveavatarSessionId] = useState<string | null>(null);

  const wsBase = useMemo(() => toWsUrl(baseUrl, ''), [baseUrl]);

  return (
    <main className="app">
      <h1>SmartWalker Backend Debug Console</h1>
      <div className="panel">
        <h2>Backend Target</h2>
        <div className="row">
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:8000" />
        </div>
        <div className="meta">HTTP base: <b>{baseUrl}</b></div>
        <div className="meta">WS base: <b>{wsBase}</b></div>
      </div>
      <AvatarPanel baseUrl={baseUrl} onSessionChange={setLiveavatarSessionId} />
      <StateStreamPanel baseUrl={baseUrl} />
      <VoiceAgentPanel baseUrl={baseUrl} liveavatarSessionId={liveavatarSessionId} />
    </main>
  );
}

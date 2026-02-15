import { useMemo, useRef, useState } from 'react';

type WsStatus = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';
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

function VoiceAgentPanel({ baseUrl }: { baseUrl: string }) {
  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextStartRef = useRef(0);

  const [status, setStatus] = useState<WsStatus>('idle');
  const [residentId, setResidentId] = useState('r1');
  const [question, setQuestion] = useState('How am I doing today?');
  const [latestTranscript, setLatestTranscript] = useState('');
  const [latestAnswer, setLatestAnswer] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
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
      const msg = { type: 'session.start', resident_id: residentId.trim() || 'r1' };
      ws.send(JSON.stringify(msg));
      push('out', compactPayload(msg));
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
    };
  };

  const disconnect = async () => {
    wsRef.current?.close(1000, 'manual disconnect');
    wsRef.current = null;
    if (recorderRef.current && recorderRef.current.state === 'recording') recorderRef.current.stop();
    recorderRef.current = null;
    chunksRef.current = [];
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
    const msg = { type: 'user_message', resident_id: residentId.trim() || 'r1', text };
    ws.send(JSON.stringify(msg));
    push('out', compactPayload(msg));
  };

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const value = String(reader.result || '');
        const idx = value.indexOf(',');
        if (idx < 0) {
          reject(new Error('failed to encode audio'));
          return;
        }
        resolve(value.slice(idx + 1));
      };
      reader.onerror = () => reject(new Error('failed to read blob'));
      reader.readAsDataURL(blob);
    });

  const startOrStopRecording = async () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.stop();
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    const mimeType = preferred.find((m) => MediaRecorder.isTypeSupported(m));
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onerror = () => {
      setIsRecording(false);
      setIsTranscribing(false);
      push('sys', 'recorder error');
    };
    recorder.onstop = () => {
      const finalMime = recorder.mimeType || mimeType || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type: finalMime });
      chunksRef.current = [];
      setIsRecording(false);
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (!blob.size) return;
      setIsTranscribing(true);
      setLatestTranscript('Transcribing audio...');
      void (async () => {
        try {
          const audioBase64 = await blobToBase64(blob);
          const msg = {
            type: 'user_audio',
            resident_id: residentId.trim() || 'r1',
            mime_type: blob.type || finalMime,
            audio_base64: audioBase64,
          };
          ws.send(JSON.stringify(msg));
          push('out', compactPayload(msg));
        } catch (err) {
          setIsTranscribing(false);
          push('sys', err instanceof Error ? err.message : 'audio send failed');
        }
      })();
    };

    setIsRecording(true);
    recorder.start(250);
    push('sys', 'recording started');
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
        <button onClick={() => void startOrStopRecording()}>{isRecording ? 'Stop Recording' : 'Record Audio'}</button>
      </div>
      <div className="meta">status: <b>{status}</b> | mic: <b>{statusText}</b></div>
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
      <StateStreamPanel baseUrl={baseUrl} />
      <VoiceAgentPanel baseUrl={baseUrl} />
    </main>
  );
}

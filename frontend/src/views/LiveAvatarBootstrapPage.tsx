import { useEffect, useMemo, useRef, useState } from 'react';
import { LiveAvatarLiteSessionManager, type LiteUiState } from '../lib/liveavatarSession';
import { useRealtimeState } from '../store/realtimeState';

export function LiveAvatarBootstrapPage() {
  const { apiClient } = useRealtimeState();
  const [status, setStatus] = useState<LiteUiState>('idle');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const videoHostRef = useRef<HTMLDivElement | null>(null);
  const pushLog = (message: string) => setLogLines((prev) => [message, ...prev].slice(0, 24));

  const manager = useMemo(
    () =>
      new LiveAvatarLiteSessionManager(apiClient, {
        onState: setStatus,
        onError: setErrorText,
        onLog: pushLog,
      }),
    [apiClient],
  );

  const connectLite = async () => {
    if (!videoHostRef.current) return;
    setErrorText(null);
    setLogLines([]);
    videoHostRef.current.innerHTML = '';
    await manager.start(
      {
        language: 'en',
        video_quality: 'high',
        video_encoding: 'VP8',
      },
      videoHostRef.current,
    );
    setSessionId(manager.currentSessionId);
  };

  const disconnect = async () => {
    await manager.stop();
    setSessionId(null);
    pushLog('Disconnected.');
  };

  useEffect(() => {
    return () => {
      void manager.stop();
    };
  }, [manager]);

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-white sm:p-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <div className="rounded-2xl bg-slate-900 p-4 sm:p-6">
          <h1 className="text-2xl font-black">LiveAvatar LITE Test</h1>
          <p className="mt-2 text-sm text-slate-300">
            Status: <span className="font-bold">{status}</span>
            {sessionId ? ` | sessionId: ${sessionId}` : ''}
          </p>
          {errorText ? <p className="mt-2 rounded-lg bg-rose-900/40 p-3 text-sm text-rose-200">{errorText}</p> : null}
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void connectLite()}
              className="rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white"
            >
              Connect via /api/liveavatar/lite/new
            </button>
            <button
              type="button"
              onClick={() => void disconnect()}
              className="rounded-xl bg-slate-700 px-4 py-2 font-bold text-white"
            >
              Disconnect
            </button>
            <button
              type="button"
              onClick={() => void manager.speakTestTone(1, 660)}
              className="rounded-xl bg-sky-700 px-4 py-2 font-bold text-white"
            >
              Send Test Tone
            </button>
            <button
              type="button"
              onClick={() => void manager.interrupt()}
              className="rounded-xl bg-rose-700 px-4 py-2 font-bold text-white"
            >
              Interrupt
            </button>
          </div>
        </div>

        <div className="h-[60vh] rounded-2xl bg-slate-900 p-3">
          <div ref={videoHostRef} className="flex h-full w-full items-center justify-center rounded-xl bg-black">
            <p className="text-sm text-slate-400">Waiting for remote track...</p>
          </div>
        </div>

        <div className="rounded-2xl bg-slate-900 p-4">
          <h2 className="text-lg font-bold">Event Log</h2>
          <div className="mt-2 max-h-48 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-300">
            {logLines.length ? logLines.map((line, idx) => <p key={`${idx}-${line}`}>{line}</p>) : <p>No events yet.</p>}
          </div>
        </div>
      </div>
    </main>
  );
}


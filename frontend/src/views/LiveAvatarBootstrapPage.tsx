import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { useRealtimeState } from '../store/realtimeState';

type ConnectStatus =
  | 'idle'
  | 'bootstrapping'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

function isUnauthorizedTokenError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes('401') || message.includes('unauthorized') || message.includes('invalid token');
}

export function LiveAvatarBootstrapPage() {
  const { apiClient, activeResidentId } = useRealtimeState();
  const [status, setStatus] = useState<ConnectStatus>('idle');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const roomRef = useRef<Room | null>(null);
  const videoHostRef = useRef<HTMLDivElement | null>(null);

  const pushLog = (message: string) => {
    setLogLines((prev) => [message, ...prev].slice(0, 16));
  };

  const cleanupMedia = () => {
    if (!videoHostRef.current) return;
    videoHostRef.current.innerHTML = '';
  };

  const disconnect = async () => {
    const room = roomRef.current;
    if (!room) return;
    room.removeAllListeners();
    await room.disconnect();
    roomRef.current = null;
    cleanupMedia();
    setStatus('disconnected');
    pushLog('Disconnected from LiveKit room.');
  };

  const connectWithBootstrap = async (retryOn401 = true) => {
    setErrorText(null);
    setStatus('bootstrapping');
    pushLog('Requesting /api/liveagent/session/bootstrap...');

    const bootstrap = await apiClient.bootstrapLiveAgentSession({
      residentId: activeResidentId,
      mode: 'FULL',
      interactivityType: 'PUSH_TO_TALK',
      language: 'en',
    });

    if (!bootstrap.ok || !bootstrap.livekitUrl || !bootstrap.livekitClientToken || !bootstrap.sessionId) {
      const message = bootstrap.error || 'Bootstrap failed: missing livekitUrl/livekitClientToken/sessionId.';
      setStatus('error');
      setErrorText(message);
      pushLog(`Bootstrap failed: ${message}`);
      return;
    }

    setSessionId(bootstrap.sessionId);
    pushLog(`Bootstrap success. sessionId=${bootstrap.sessionId}`);
    setStatus('connecting');

    const room = new Room();
    roomRef.current = room;

    room.on(RoomEvent.Connected, () => {
      setStatus('connected');
      pushLog('Connected to LiveKit room.');
    });

    room.on(RoomEvent.Reconnecting, () => {
      setStatus('reconnecting');
      pushLog('Reconnecting...');
    });

    room.on(RoomEvent.Reconnected, () => {
      setStatus('connected');
      pushLog('Reconnected.');
    });

    room.on(RoomEvent.Disconnected, (reason) => {
      setStatus('disconnected');
      pushLog(`Disconnected. reason=${String(reason || 'unknown')}`);
    });

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      pushLog(`Track subscribed: kind=${track.kind}, participant=${participant.identity}`);
      if (!videoHostRef.current) return;
      const element = track.attach();
      if (track.kind === Track.Kind.Video) {
        element.className = 'h-full w-full rounded-xl object-contain bg-black';
      }
      if (track.kind === Track.Kind.Audio) {
        element.className = 'hidden';
      }
      videoHostRef.current.appendChild(element);
      pushLog(`Rendered track (${publication.trackSid}).`);
    });

    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((el) => el.remove());
      pushLog('Track unsubscribed.');
    });

    try {
      await room.connect(bootstrap.livekitUrl, bootstrap.livekitClientToken);
    } catch (error) {
      pushLog(`Connect failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      await disconnect();
      if (retryOn401 && isUnauthorizedTokenError(error)) {
        pushLog('Detected invalid token (401). Re-running bootstrap and retrying once...');
        await connectWithBootstrap(false);
        return;
      }
      setStatus('error');
      setErrorText(error instanceof Error ? error.message : 'Failed to connect to LiveKit room.');
    }
  };

  useEffect(() => {
    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-white sm:p-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <div className="rounded-2xl bg-slate-900 p-4 sm:p-6">
          <h1 className="text-2xl font-black">LiveAvatar Bootstrap Test</h1>
          <p className="mt-2 text-sm text-slate-300">
            Status: <span className="font-bold">{status}</span>
            {sessionId ? ` | sessionId: ${sessionId}` : ''}
          </p>
          {errorText ? <p className="mt-2 rounded-lg bg-rose-900/40 p-3 text-sm text-rose-200">{errorText}</p> : null}
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => connectWithBootstrap(true)}
              className="rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white"
            >
              Connect via /bootstrap
            </button>
            <button
              type="button"
              onClick={disconnect}
              className="rounded-xl bg-slate-700 px-4 py-2 font-bold text-white"
            >
              Disconnect
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


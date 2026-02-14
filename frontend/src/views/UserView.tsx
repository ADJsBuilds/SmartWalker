import { useEffect, useRef, useState } from 'react';
import { LocalAudioTrack, Room, RoomEvent, Track, createLocalAudioTrack } from 'livekit-client';
import { useRealtimeState } from '../store/realtimeState';

type ConnectStatus = 'idle' | 'bootstrapping' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'disconnected';

function isUnauthorizedTokenError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes('401') || message.includes('unauthorized') || message.includes('invalid token');
}

export function UserView() {
  const { apiClient, activeResidentId } = useRealtimeState();
  const [status, setStatus] = useState<ConnectStatus>('idle');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isTalking, setIsTalking] = useState(false);
  const isUnmountedRef = useRef(false);
  const roomRef = useRef<Room | null>(null);
  const audioTrackRef = useRef<LocalAudioTrack | null>(null);
  const videoHostRef = useRef<HTMLDivElement | null>(null);

  const clearVideo = () => {
    if (videoHostRef.current) videoHostRef.current.innerHTML = '';
  };

  const disconnect = async (suppressStatusUpdate = false) => {
    const room = roomRef.current;
    if (!room) return;
    room.removeAllListeners();
    await room.disconnect();
    roomRef.current = null;
    clearVideo();
    if (!suppressStatusUpdate && !isUnmountedRef.current) {
      setStatus('disconnected');
    }
  };

  const connect = async (retryOn401 = true) => {
    if (isUnmountedRef.current) return;
    setStatus('bootstrapping');
    setErrorText(null);
    const bootstrap = await apiClient.bootstrapLiveAgentSession({
      residentId: activeResidentId,
      mode: 'FULL',
      interactivityType: 'PUSH_TO_TALK',
      language: 'en',
    });
    if (!bootstrap.ok || !bootstrap.livekitUrl || !bootstrap.livekitClientToken) {
      setStatus('error');
      setErrorText(bootstrap.error || 'Failed to bootstrap LiveAvatar session.');
      return;
    }

    const room = new Room();
    roomRef.current = room;
    room.on(RoomEvent.Connected, () => {
      if (!isUnmountedRef.current) setStatus('connected');
    });
    room.on(RoomEvent.Reconnecting, () => {
      if (!isUnmountedRef.current) setStatus('reconnecting');
    });
    room.on(RoomEvent.Reconnected, () => {
      if (!isUnmountedRef.current) setStatus('connected');
    });
    room.on(RoomEvent.Disconnected, () => {
      if (!isUnmountedRef.current) setStatus('disconnected');
    });
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (!videoHostRef.current) return;
      const el = track.attach();
      if (track.kind === Track.Kind.Video) el.className = 'h-full w-full rounded-xl object-cover';
      if (track.kind === Track.Kind.Audio) el.className = 'hidden';
      videoHostRef.current.appendChild(el);
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((el) => el.remove()));

    try {
      setStatus('connecting');
      await room.connect(bootstrap.livekitUrl, bootstrap.livekitClientToken);
    } catch (error) {
      await disconnect();
      if (retryOn401 && isUnauthorizedTokenError(error)) {
        await connect(false);
        return;
      }
      if (!isUnmountedRef.current) {
        setStatus('error');
        setErrorText(error instanceof Error ? error.message : 'Unable to connect to LiveKit.');
      }
    }
  };

  const startTalking = async () => {
    setIsTalking(true);
    const room = roomRef.current;
    if (!room) return;
    try {
      if (!audioTrackRef.current) {
        const track = await createLocalAudioTrack();
        audioTrackRef.current = track;
        await room.localParticipant.publishTrack(track);
      } else {
        await audioTrackRef.current.unmute();
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unable to enable microphone.');
      setStatus('error');
    }
  };

  const stopTalking = async () => {
    setIsTalking(false);
    if (!audioTrackRef.current) return;
    await audioTrackRef.current.mute();
  };

  useEffect(() => {
    isUnmountedRef.current = false;
    connect(true);
    return () => {
      isUnmountedRef.current = true;
      void (async () => {
        if (audioTrackRef.current) {
          await audioTrackRef.current.stop();
          audioTrackRef.current = null;
        }
        await disconnect(true);
      })();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="fixed inset-0 flex flex-col bg-black text-white">
      <section className="relative flex-1 p-4 sm:p-6">
        <div ref={videoHostRef} className="flex h-full w-full items-center justify-center overflow-hidden rounded-xl bg-slate-900">
          <p className="text-sm text-slate-300">
            {status === 'connected' ? 'Connected. Waiting for avatar stream...' : `Status: ${status}`}
          </p>
        </div>
        {errorText ? <p className="absolute left-8 right-8 top-8 rounded-md bg-rose-800/80 px-3 py-2 text-sm">{errorText}</p> : null}
      </section>

      <section className="flex justify-center px-6 pb-8 pt-2">
        <button
          type="button"
          onMouseDown={() => void startTalking()}
          onMouseUp={() => void stopTalking()}
          onMouseLeave={() => void stopTalking()}
          onTouchStart={() => void startTalking()}
          onTouchEnd={() => void stopTalking()}
          className={`w-full max-w-sm rounded-full px-8 py-6 text-2xl font-black shadow-xl transition ${
            isTalking ? 'bg-orange-700' : 'bg-orange-500'
          }`}
        >
          {isTalking ? 'Talking...' : 'Press to Talk'}
        </button>
      </section>
    </main>
  );
}


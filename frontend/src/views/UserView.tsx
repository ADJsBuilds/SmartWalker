import { useEffect, useMemo, useRef, useState } from 'react';
import { AvatarView } from '../components/AvatarView';
import { LiveAvatarLiteSessionManager, type LiteUiState } from '../lib/liveavatarSession';
import { useRealtimeState } from '../store/realtimeState';

export function UserView() {
  const { apiClient } = useRealtimeState();
  const [status, setStatus] = useState<LiteUiState>('idle');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [speakText, setSpeakText] = useState('Hello! This is ElevenLabs TTS driving LiveAvatar LITE mode.');
  const videoHostRef = useRef<HTMLDivElement | null>(null);

  const sessionManager = useMemo(
    () =>
      new LiveAvatarLiteSessionManager(apiClient, {
        onState: setStatus,
        onError: (message) => setErrorText(message),
        onLog: (line) => setLogLines((prev) => [line, ...prev].slice(0, 80)),
      }),
    [apiClient],
  );

  const connect = async () => {
    if (!videoHostRef.current) return;
    videoHostRef.current.innerHTML = '';
    setErrorText(null);
    setLogLines([]);
    await sessionManager.start(
      {
        language: 'en',
        video_quality: 'high',
        video_encoding: 'VP8',
        is_sandbox: false,
      },
      videoHostRef.current,
    );
  };

  useEffect(() => {
    void connect();
    return () => {
      void sessionManager.stop();
    };
  }, [sessionManager]);

  return (
    <AvatarView
      status={status}
      errorText={errorText}
      logLines={logLines}
      speakText={speakText}
      onSpeakTextChange={setSpeakText}
      videoHostRef={videoHostRef}
      onDisconnect={() => void sessionManager.stop()}
      onInterrupt={() => void sessionManager.interrupt()}
      onTestTone={() => void sessionManager.speakTestTone(1, 440)}
      onSpeakText={() => void sessionManager.speakText(speakText)}
    />
  );
}


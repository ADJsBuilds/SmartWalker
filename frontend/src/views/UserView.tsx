import { useEffect, useMemo, useRef, useState } from 'react';
import { AvatarView } from '../components/AvatarView';
import { LiveAvatarLiteSessionManager, type LiteUiState } from '../lib/liveavatarSession';
import { getSpeechRecognitionCtor, speakText, type SpeechRecognitionLike } from '../lib/speech';
import { useRealtimeState } from '../store/realtimeState';

export function UserView() {
  const { apiClient } = useRealtimeState();
  const [status, setStatus] = useState<LiteUiState>('idle');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [voiceAgentStatus, setVoiceAgentStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [latestUserTranscript, setLatestUserTranscript] = useState('');
  const [latestAgentResponse, setLatestAgentResponse] = useState('');
  const [isListening, setIsListening] = useState(false);
  const videoHostRef = useRef<HTMLDivElement | null>(null);
  const voiceWsRef = useRef<WebSocket | null>(null);
  const speechRecRef = useRef<SpeechRecognitionLike | null>(null);

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
      disconnectVoiceAgent();
      void sessionManager.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionManager]);

  const disconnectVoiceAgent = () => {
    speechRecRef.current?.stop();
    speechRecRef.current = null;
    const ws = voiceWsRef.current;
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000, 'client stop');
    voiceWsRef.current = null;
    setVoiceAgentStatus('idle');
    setIsListening(false);
  };

  const sendVoiceEvent = (payload: Record<string, unknown>) => {
    const ws = voiceWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
  };

  const extractAgentText = (payload: Record<string, unknown>): string => {
    for (const key of ['agent_response', 'response', 'text']) {
      const value = payload[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (value && typeof value === 'object') {
        const maybeNested = value as Record<string, unknown>;
        for (const nestedKey of ['text', 'response']) {
          const nestedValue = maybeNested[nestedKey];
          if (typeof nestedValue === 'string' && nestedValue.trim()) return nestedValue.trim();
        }
      }
    }
    return '';
  };

  const startVoiceAgent = async () => {
    if (voiceAgentStatus === 'connected' || voiceAgentStatus === 'connecting') return;
    try {
      setVoiceAgentStatus('connecting');
      const session = await apiClient.createElevenSession({});
      const ws = new WebSocket(session.signed_url);
      voiceWsRef.current = ws;

      ws.onopen = () => {
        setVoiceAgentStatus('connected');
        setLogLines((prev) => [`Voice agent connected (${session.session_id})`, ...prev].slice(0, 80));
        sendVoiceEvent({
          type: 'contextual_update',
          text: 'STATE UPDATE:\n- UI: user_view\n- Session intent: short voice back-and-forth coaching',
        });
      };

      ws.onclose = () => {
        setVoiceAgentStatus('idle');
      };

      ws.onerror = () => {
        setVoiceAgentStatus('error');
      };

      ws.onmessage = (event) => {
        let payload: unknown;
        try {
          payload = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (!payload || typeof payload !== 'object') return;
        const typed = payload as Record<string, unknown>;
        const type = String(typed.type || '');
        if (type === 'ping') {
          const pingEvent = (typed.ping_event as Record<string, unknown> | undefined) || {};
          const eventId = String(pingEvent.event_id || typed.event_id || '');
          if (eventId) sendVoiceEvent({ type: 'pong', event_id: eventId });
          return;
        }
        const text = extractAgentText(typed);
        if (text && (type.includes('agent') || type.includes('response'))) {
          setLatestAgentResponse(text);
          speakText(text);
        }
      };
    } catch (error) {
      setVoiceAgentStatus('error');
      setErrorText(error instanceof Error ? error.message : 'Failed to start voice agent.');
    }
  };

  const talkToAgent = () => {
    if (voiceAgentStatus !== 'connected') return;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setErrorText('Speech recognition not supported in this browser.');
      return;
    }
    speechRecRef.current?.stop();
    const recognition = new Ctor();
    speechRecRef.current = recognition;
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim() || '';
      setIsListening(false);
      if (!transcript) return;
      setLatestUserTranscript(transcript);
      sendVoiceEvent({ type: 'user_message', text: transcript });
    };
    setIsListening(true);
    recognition.start();
  };

  return (
    <AvatarView
      status={status}
      errorText={errorText}
      logLines={logLines}
      videoHostRef={videoHostRef}
      onDisconnect={() => void sessionManager.stop()}
      onInterrupt={() => void sessionManager.interrupt()}
      onStartVoiceAgent={() => void startVoiceAgent()}
      onStopVoiceAgent={disconnectVoiceAgent}
      onTalkToAgent={talkToAgent}
      voiceAgentStatus={voiceAgentStatus}
      latestUserTranscript={latestUserTranscript}
      latestAgentResponse={latestAgentResponse}
      isListening={isListening}
    />
  );
}


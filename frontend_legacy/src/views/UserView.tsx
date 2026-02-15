import { useEffect, useMemo, useRef, useState } from 'react';
import { AvatarView } from '../components/AvatarView';
import { LiveAvatarLiteSessionManager, type LiteUiState } from '../lib/liveavatarSession';
import { toWsBaseUrl } from '../lib/storage';
import { useRealtimeState } from '../store/realtimeState';
import { VoiceEndpointDetector } from '../lib/voiceEndpointing';

const VOICE_ENDPOINTING_ENABLED = String(import.meta.env.VITE_VOICE_ENDPOINTING_ENABLED || '').toLowerCase() === 'true';
const VOICE_STREAMING_ENABLED = String(import.meta.env.VITE_VOICE_STREAMING_ENABLED || '').toLowerCase() === 'true';
const FALLBACK_RECORDING_TIMEOUT_MS = 4500;
const STREAM_TIMESLICE_MS = 140;
const STREAM_BUFFER_CAP_BYTES = 2_000_000;

class PcmStreamPlayer {
  private audioCtx: AudioContext | null = null;
  private nextStartTime = 0;

  private ensureAudioContext(): AudioContext {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
      this.nextStartTime = 0;
    }
    return this.audioCtx;
  }

  async enqueuePcm16Base64(base64Audio: string, sampleRateHz = 24000): Promise<void> {
    const trimmed = base64Audio.trim();
    if (!trimmed) return;
    const ctx = this.ensureAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const binary = atob(trimmed);
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

    const audioBuffer = ctx.createBuffer(1, sampleCount, sampleRateHz);
    audioBuffer.copyToChannel(floatData, 0);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.02, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + audioBuffer.duration;
  }

  async reset(): Promise<void> {
    this.nextStartTime = 0;
    if (this.audioCtx) {
      try {
        await this.audioCtx.close();
      } catch {
        // no-op
      }
      this.audioCtx = null;
    }
  }
}

export function UserView() {
  const { apiClient, activeResidentId, apiBaseUrl } = useRealtimeState();
  const avatarEnabled = String(import.meta.env.VITE_ENABLE_HEYGEN_AVATAR || '').toLowerCase() === 'true';
  const [status, setStatus] = useState<LiteUiState>('idle');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [voiceAgentStatus, setVoiceAgentStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [latestUserTranscript, setLatestUserTranscript] = useState('');
  const [latestAgentResponse, setLatestAgentResponse] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const videoHostRef = useRef<HTMLDivElement | null>(null);
  const voiceWsRef = useRef<WebSocket | null>(null);
  const pcmPlayerRef = useRef<PcmStreamPlayer>(new PcmStreamPlayer());
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaChunksRef = useRef<BlobPart[]>([]);
  const endpointDetectorRef = useRef<VoiceEndpointDetector | null>(null);
  const recordingFallbackTimerRef = useRef<number | null>(null);
  const activeUtteranceRef = useRef<{
    sessionId: string;
    sequenceNumber: number;
    droppedChunks: number;
    speechEndMs: number | null;
    lastChunkSentMs: number | null;
    streamMode: boolean;
  } | null>(null);

  const sessionManager = useMemo(
    () =>
      new LiveAvatarLiteSessionManager(apiClient, {
        onState: setStatus,
        onError: (message) => setErrorText(message),
        onLog: (line) => setLogLines((prev) => [line, ...prev].slice(0, 80)),
      }),
    [apiClient],
  );

  const appendVoiceLog = (line: string) => {
    setLogLines((prev) => [`[${new Date().toLocaleTimeString()}] ${line}`, ...prev].slice(0, 160));
  };

  const compactPayloadForLog = (payload: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...payload };
    const maybeAudio = out.audio_base64 || out.audio || out.chunk;
    if (typeof maybeAudio === 'string') {
      const approxBytes = Math.max(0, Math.floor((maybeAudio.length * 3) / 4));
      if (typeof out.audio_base64 === 'string') out.audio_base64 = `<${approxBytes} bytes base64>`;
      if (typeof out.audio === 'string') out.audio = `<${approxBytes} bytes base64>`;
      if (typeof out.chunk === 'string') out.chunk = `<${approxBytes} bytes base64>`;
    }
    return out;
  };

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
    if (avatarEnabled) {
      void connect();
    } else {
      setLogLines((prev) => ['Avatar stream disabled for MVP (set VITE_ENABLE_HEYGEN_AVATAR=true to re-enable).', ...prev].slice(0, 80));
    }
    return () => {
      disconnectVoiceAgent();
      void sessionManager.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarEnabled, sessionManager]);

  const disconnectVoiceAgent = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    mediaChunksRef.current = [];
    activeUtteranceRef.current = null;
    if (recordingFallbackTimerRef.current !== null) {
      window.clearTimeout(recordingFallbackTimerRef.current);
      recordingFallbackTimerRef.current = null;
    }
    const endpointDetector = endpointDetectorRef.current;
    endpointDetectorRef.current = null;
    if (endpointDetector) {
      void endpointDetector.stop();
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    const ws = voiceWsRef.current;
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000, 'client stop');
    voiceWsRef.current = null;
    void pcmPlayerRef.current.reset();
    setVoiceAgentStatus('idle');
    setIsListening(false);
  };

  const sendVoiceEvent = (payload: Record<string, unknown>) => {
    const ws = voiceWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
    appendVoiceLog(`out ${JSON.stringify(compactPayloadForLog(payload))}`);
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
      const wsBase = toWsBaseUrl(apiBaseUrl);
      const wsPath = import.meta.env.VITE_VOICE_AGENT_WS_PATH || '/ws/voice-agent';
      const query = `?residentId=${encodeURIComponent(activeResidentId)}`;
      const ws = new WebSocket(`${wsBase}${wsPath}${query}`);
      voiceWsRef.current = ws;

      ws.onopen = () => {
        setVoiceAgentStatus('connected');
        appendVoiceLog(`sys connected ws for resident=${activeResidentId}`);
        sendVoiceEvent({
          type: 'session.start',
          resident_id: activeResidentId,
          text: 'STATE UPDATE:\n- UI: user_view\n- Session intent: short voice back-and-forth coaching',
        });
      };

      ws.onclose = () => {
        appendVoiceLog('sys websocket closed');
        setVoiceAgentStatus('idle');
      };

      ws.onerror = () => {
        appendVoiceLog('sys websocket error');
        setVoiceAgentStatus('error');
      };

      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        let payload: unknown;
        try {
          payload = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (!payload || typeof payload !== 'object') return;
        const typed = payload as Record<string, unknown>;
        appendVoiceLog(`in ${JSON.stringify(compactPayloadForLog(typed))}`);
        const type = String(typed.type || '');
        if (type === 'ping') {
          const pingEvent = (typed.ping_event as Record<string, unknown> | undefined) || {};
          const eventId = String(pingEvent.event_id || typed.event_id || '');
          if (eventId) sendVoiceEvent({ type: 'pong', event_id: eventId });
          return;
        }
        const transcript = typed.user_transcript;
        if (typeof transcript === 'string' && transcript.trim()) {
          setIsTranscribing(false);
          setLatestUserTranscript(transcript.trim());
        }

        const audioBase64 = typed.audio_base64 || typed.audio || typed.chunk;
        if (typeof audioBase64 === 'string' && audioBase64.trim()) {
          const sampleRateRaw = typed.sample_rate_hz || typed.sampleRateHz;
          const sampleRate = typeof sampleRateRaw === 'number' && Number.isFinite(sampleRateRaw) ? sampleRateRaw : 24000;
          void pcmPlayerRef.current.enqueuePcm16Base64(audioBase64, sampleRate);
        }

        const text = extractAgentText(typed);
        if (text && (type.includes('agent') || type.includes('response') || type.includes('text'))) {
          setLatestAgentResponse(text);
        }
        if (type === 'error') {
          setIsTranscribing(false);
          const detail = String(typed.error || 'Unknown websocket error');
          setErrorText(detail);
        }
        if (type === 'latency_metrics') {
          appendVoiceLog(`sys latency ${JSON.stringify(typed.metrics || typed)}`);
        }
      };
    } catch (error) {
      setVoiceAgentStatus('error');
      setErrorText(error instanceof Error ? error.message : 'Failed to start voice agent.');
    }
  };

  const talkToAgent = () => {
    if (voiceAgentStatus !== 'connected') {
      setErrorText('Connect the voice websocket first.');
      return;
    }
    const active = mediaRecorderRef.current;
    if (active && active.state === 'recording') {
      appendVoiceLog('sys stopping active recording');
      active.stop();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErrorText('Microphone recording is not supported in this browser.');
      return;
    }

    const blobToBase64 = (blob: Blob): Promise<string> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const value = String(reader.result || '');
          const comma = value.indexOf(',');
          if (comma === -1) {
            reject(new Error('Unable to encode audio payload.'));
            return;
          }
          resolve(value.slice(comma + 1));
        };
        reader.onerror = () => reject(new Error('Failed to read recorded audio.'));
        reader.readAsDataURL(blob);
      });

    void (async () => {
      try {
        setErrorText(null);
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        appendVoiceLog('sys microphone acquired');
        mediaStreamRef.current = stream;
        const preferredMimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
        const pickedMimeType = preferredMimeTypes.find((candidate) => MediaRecorder.isTypeSupported(candidate));
        const recorder = pickedMimeType ? new MediaRecorder(stream, { mimeType: pickedMimeType }) : new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;
        mediaChunksRef.current = [];
        const trackSettings = stream.getAudioTracks()[0]?.getSettings?.() || {};
        const sampleRate = Number(trackSettings.sampleRate || 48000);
        const channels = Number(trackSettings.channelCount || 1);
        const streamMode = VOICE_STREAMING_ENABLED;
        const utterance = {
          sessionId: `utt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          sequenceNumber: 0,
          droppedChunks: 0,
          speechEndMs: null as number | null,
          lastChunkSentMs: null as number | null,
          streamMode,
        };
        activeUtteranceRef.current = utterance;

        recorder.ondataavailable = (event: BlobEvent) => {
          if (event.data.size <= 0) return;
          const current = activeUtteranceRef.current;
          if (!current || !current.streamMode) {
            mediaChunksRef.current.push(event.data);
            return;
          }
          const ws = voiceWsRef.current;
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          if (ws.bufferedAmount > STREAM_BUFFER_CAP_BYTES) {
            current.droppedChunks += 1;
            if (current.droppedChunks % 10 === 1) {
              appendVoiceLog(`sys stream backpressure: droppedChunks=${current.droppedChunks}`);
            }
            return;
          }
          current.sequenceNumber += 1;
          current.lastChunkSentMs = performance.now();
          sendVoiceEvent({
            type: 'user_audio_chunk_meta',
            session_id: current.sessionId,
            sequence_number: current.sequenceNumber,
            byte_length: event.data.size,
            timestamp_ms: Date.now(),
          });
          ws.send(event.data);
        };
        recorder.onerror = () => {
          setIsListening(false);
          setErrorText('Microphone recording failed.');
          appendVoiceLog('sys microphone recording error');
        };
        recorder.onstop = () => {
          if (recordingFallbackTimerRef.current !== null) {
            window.clearTimeout(recordingFallbackTimerRef.current);
            recordingFallbackTimerRef.current = null;
          }
          const endpointDetector = endpointDetectorRef.current;
          endpointDetectorRef.current = null;
          if (endpointDetector) {
            void endpointDetector.stop();
          }
          const mimeType = recorder.mimeType || pickedMimeType || 'audio/webm';
          const current = activeUtteranceRef.current;
          if (current && current.speechEndMs === null) {
            current.speechEndMs = performance.now();
          }
          if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((track) => track.stop());
            mediaStreamRef.current = null;
          }
          setIsListening(false);
          if (current?.streamMode) {
            appendVoiceLog(
              `sys recording stopped stream mode session=${current.sessionId} seq=${current.sequenceNumber} dropped=${current.droppedChunks}`,
            );
            sendVoiceEvent({
              type: 'user_audio_end',
              session_id: current.sessionId,
              last_sequence_number: current.sequenceNumber,
              timestamp_ms: Date.now(),
              speech_end_ms: current.speechEndMs,
              last_chunk_sent_ms: current.lastChunkSentMs,
            });
            activeUtteranceRef.current = null;
            setIsTranscribing(true);
            setLatestUserTranscript('Transcribing audio...');
            return;
          }
          const blob = new Blob(mediaChunksRef.current, { type: mimeType });
          mediaChunksRef.current = [];
          appendVoiceLog(`sys recording stopped mime=${mimeType} bytes=${blob.size}`);
          if (!blob.size) {
            activeUtteranceRef.current = null;
            return;
          }
          setIsTranscribing(true);
          setLatestUserTranscript('Transcribing audio...');
          void (async () => {
            try {
              const audioBase64 = await blobToBase64(blob);
              sendVoiceEvent({
                type: 'user_audio',
                resident_id: activeResidentId,
                mime_type: blob.type || mimeType,
                audio_base64: audioBase64,
                speech_end_ms: current?.speechEndMs ?? performance.now(),
              });
            } catch (error) {
              setIsTranscribing(false);
              setErrorText(error instanceof Error ? error.message : 'Failed to send recorded audio.');
            }
          })();
          activeUtteranceRef.current = null;
        };

        setIsListening(true);
        appendVoiceLog('sys recording started');
        if (streamMode) {
          sendVoiceEvent({
            type: 'user_audio_start',
            session_id: utterance.sessionId,
            codec: pickedMimeType || recorder.mimeType || 'audio/webm',
            sample_rate: Number.isFinite(sampleRate) ? sampleRate : 48000,
            channels: Number.isFinite(channels) ? channels : 1,
            timestamp_ms: Date.now(),
          });
        }
        const endpointDetector = VOICE_ENDPOINTING_ENABLED
          ? new VoiceEndpointDetector({
              silenceHangoverMs: 320,
              minSpeechMs: 250,
              maxUtteranceMs: 8000,
              onSpeechStart: () => appendVoiceLog('sys endpoint speech_start'),
              onSpeechEndCandidate: () => appendVoiceLog('sys endpoint silence_candidate'),
              onEndpoint: (reason) => {
                const current = activeUtteranceRef.current;
                if (current && current.speechEndMs === null) {
                  current.speechEndMs = performance.now();
                }
                appendVoiceLog(`sys endpoint detected reason=${reason}`);
                if (recorder.state === 'recording') recorder.stop();
              },
            })
          : null;
        endpointDetectorRef.current = endpointDetector;
        if (endpointDetector) {
          try {
            await endpointDetector.start(stream);
          } catch (error) {
            appendVoiceLog(`sys endpoint detector unavailable, fallback timeout (${String(error)})`);
            endpointDetectorRef.current = null;
          }
        }
        recorder.start(streamMode ? STREAM_TIMESLICE_MS : 250);
        recordingFallbackTimerRef.current = window.setTimeout(() => {
          if (recorder.state === 'recording') recorder.stop();
        }, FALLBACK_RECORDING_TIMEOUT_MS);
      } catch (error) {
        setIsListening(false);
        setIsTranscribing(false);
        setErrorText(error instanceof Error ? error.message : 'Could not access microphone.');
      }
    })();
  };

  return (
    <AvatarView
      status={status}
      errorText={errorText}
      logLines={logLines}
      videoHostRef={videoHostRef}
      onDisconnect={() => {
        disconnectVoiceAgent();
        void sessionManager.stop();
      }}
      onInterrupt={() => void sessionManager.interrupt()}
      onStartVoiceAgent={() => void startVoiceAgent()}
      onStopVoiceAgent={disconnectVoiceAgent}
      onTalkToAgent={talkToAgent}
      voiceAgentStatus={voiceAgentStatus}
      latestUserTranscript={isListening ? 'Listening...' : isTranscribing ? 'Transcribing audio...' : latestUserTranscript}
      latestAgentResponse={latestAgentResponse}
      isListening={isListening}
    />
  );
}

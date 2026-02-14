import { Room, RoomEvent, Track } from 'livekit-client';
import type { ApiClient } from './apiClient';

export type LiteUiState = 'idle' | 'starting session...' | 'connecting livekit...' | 'connected' | 'ws connecting...' | 'ready' | 'error';

interface LiteSessionCallbacks {
  onState?: (state: LiteUiState) => void;
  onError?: (message: string) => void;
  onLog?: (line: string) => void;
}

export class LiveAvatarLiteSessionManager {
  private readonly apiClient: ApiClient;
  private readonly callbacks: LiteSessionCallbacks;
  private room: Room | null = null;
  private statusPollTimer: number | null = null;
  private sessionId: string | null = null;
  private sessionToken: string | null = null;

  constructor(apiClient: ApiClient, callbacks: LiteSessionCallbacks = {}) {
    this.apiClient = apiClient;
    this.callbacks = callbacks;
  }

  get currentSessionId(): string | null {
    return this.sessionId;
  }

  async start(
    params: {
      avatar_id?: string;
      voice_id?: string;
      context_id?: string;
      language?: string;
      video_encoding?: 'VP8' | 'H264';
      video_quality?: 'low' | 'medium' | 'high' | 'very_high';
      is_sandbox?: boolean;
    },
    videoHost: HTMLElement,
  ): Promise<void> {
    await this.stop();
    this.callbacks.onState?.('starting session...');

    const created = await this.apiClient.createAndStartLiveAvatarLiteSession(params);
    if (!created.ok || !created.session_id || !created.session_token || !created.livekit_url || !created.livekit_client_token) {
      this.callbacks.onState?.('error');
      this.callbacks.onError?.(created.error || 'Failed to create/start LITE session.');
      return;
    }
    this.sessionId = created.session_id;
    this.sessionToken = created.session_token;

    this.callbacks.onState?.('connecting livekit...');
    await this.connectLiveKit(created.livekit_url, created.livekit_client_token, videoHost);
    this.callbacks.onState?.('connected');
    this.callbacks.onState?.('ws connecting...');
    this.startStatusPolling();
  }

  async stop(): Promise<void> {
    if (this.statusPollTimer) {
      window.clearInterval(this.statusPollTimer);
      this.statusPollTimer = null;
    }
    const room = this.room;
    this.room = null;
    if (room) {
      try {
        room.removeAllListeners();
        await room.disconnect();
      } catch {
        // Best effort disconnect.
      }
    }
    if (this.sessionId && this.sessionToken) {
      try {
        await this.apiClient.stopLiveAvatarLiteSession({ session_id: this.sessionId, session_token: this.sessionToken });
      } catch {
        // Best effort server stop.
      }
    }
    this.sessionId = null;
    this.sessionToken = null;
    this.callbacks.onState?.('idle');
  }

  async interrupt(): Promise<void> {
    if (!this.sessionId) return;
    await this.apiClient.sendLiveAvatarLiteInterrupt({ session_id: this.sessionId });
  }

  async speakTestTone(durationSeconds = 1.0, frequencyHz = 440): Promise<void> {
    if (!this.sessionId) return;
    await this.apiClient.sendLiveAvatarLiteTestTone({ session_id: this.sessionId, duration_seconds: durationSeconds, frequency_hz: frequencyHz });
  }

  async speakText(text: string): Promise<void> {
    if (!this.sessionId || !text.trim()) return;
    const result = await this.apiClient.sendLiveAvatarLiteSpeakText({
      session_id: this.sessionId,
      text: text.trim(),
      interrupt_before_speak: true,
    });
    if (!result.ok) {
      this.callbacks.onError?.(result.error || 'Failed to synthesize/send speech.');
    }
  }

  private async connectLiveKit(livekitUrl: string, livekitClientToken: string, videoHost: HTMLElement): Promise<void> {
    const room = new Room();
    this.room = room;
    room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      this.callbacks.onLog?.(`Track subscribed: ${track.kind} (${participant.identity})`);
      const element = track.attach();
      if (track.kind === Track.Kind.Video) {
        element.className = 'h-full w-full rounded-xl object-cover bg-black';
      } else {
        element.className = 'hidden';
        const audioEl = element as HTMLAudioElement;
        audioEl.autoplay = true;
        audioEl.muted = false;
        void audioEl.play().catch(() => this.callbacks.onError?.('Audio autoplay blocked. Tap the screen and retry.'));
      }
      videoHost.appendChild(element);
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((el) => el.remove()));
    room.on(RoomEvent.Disconnected, () => this.callbacks.onLog?.('LiveKit disconnected.'));
    await room.connect(livekitUrl, livekitClientToken);
  }

  private startStatusPolling(): void {
    if (!this.sessionId) return;
    const poll = async () => {
      if (!this.sessionId) return;
      try {
        const status = await this.apiClient.getLiveAvatarLiteStatus(this.sessionId);
        if (status.ready) {
          this.callbacks.onState?.('ready');
        } else if (status.exists) {
          this.callbacks.onState?.('ws connecting...');
        }
        if (status.last_error) {
          this.callbacks.onError?.(String(status.last_error));
        }
      } catch {
        // Leave current state unchanged if status endpoint is temporarily unavailable.
      }
    };
    void poll();
    this.statusPollTimer = window.setInterval(() => void poll(), 2000);
  }
}


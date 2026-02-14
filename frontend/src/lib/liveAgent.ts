import { LocalAudioTrack, Room, RoomEvent, createLocalAudioTrack } from 'livekit-client';
import type { ApiClient } from './apiClient';

export interface LiveAgentEventHandlers {
  onStatus?: (status: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error') => void;
  onAgentTranscript?: (text: string, speaker: 'user' | 'avatar') => void;
  onError?: (message: string) => void;
}

export class LiveAgentController {
  private readonly apiClient: ApiClient;
  private room: Room | null = null;
  private localAudioTrack: LocalAudioTrack | null = null;
  private sessionId: string | null = null;
  private sessionAccessToken: string | null = null;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  async connectWithLiveKit(
    livekitUrl: string,
    livekitClientToken: string,
    mediaElement: HTMLVideoElement,
    handlers: LiveAgentEventHandlers = {},
    sessionContext?: { sessionId?: string; sessionAccessToken?: string },
  ): Promise<void> {
    await this.disconnect();
    handlers.onStatus?.('connecting');

    try {
      const room = new Room();
      this.room = room;
      room.on(RoomEvent.Connected, () => handlers.onStatus?.('connected'));
      room.on(RoomEvent.Disconnected, () => handlers.onStatus?.('disconnected'));
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === 'video') {
          track.attach(mediaElement);
        }
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((el) => el.remove()));
      await room.connect(livekitUrl, livekitClientToken);
      this.sessionId = sessionContext?.sessionId || null;
      this.sessionAccessToken = sessionContext?.sessionAccessToken || null;
      handlers.onStatus?.('connected');
    } catch (error) {
      handlers.onStatus?.('error');
      handlers.onError?.(error instanceof Error ? error.message : 'LiveAgent connection failed');
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.room) return;
    try {
      if (this.localAudioTrack) {
        await this.localAudioTrack.stop();
        this.localAudioTrack = null;
      }
      await this.room.disconnect();
    } catch {
      // Best-effort cleanup.
    } finally {
      this.room = null;
      this.sessionId = null;
      this.sessionAccessToken = null;
    }
  }

  get isConnected(): boolean {
    return Boolean(this.room);
  }

  async speakText(text: string): Promise<boolean> {
    if (!this.isConnected || !this.sessionId || !this.sessionAccessToken || !text.trim()) return false;
    try {
      const result = await this.apiClient.sendLiveAgentSessionEvent({
        sessionToken: this.sessionAccessToken,
        sessionId: this.sessionId,
        text: text.trim(),
      });
      return Boolean(result.ok);
    } catch {
      return false;
    }
  }

  askAndRespond(userPrompt: string): void {
    void userPrompt;
  }

  startListening(): void {
    void this.startListeningAsync();
  }

  stopListening(): void {
    void this.stopListeningAsync();
  }

  interrupt(): void {
    void 0;
  }

  private async startListeningAsync(): Promise<void> {
    if (!this.room) return;
    if (!this.localAudioTrack) {
      this.localAudioTrack = await createLocalAudioTrack();
      await this.room.localParticipant.publishTrack(this.localAudioTrack);
      return;
    }
    await this.localAudioTrack.unmute();
  }

  private async stopListeningAsync(): Promise<void> {
    if (!this.localAudioTrack) return;
    await this.localAudioTrack.mute();
  }
}

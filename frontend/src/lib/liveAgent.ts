import { AgentEventsEnum, LiveAvatarSession, SessionEvent, SessionState } from '@heygen/liveavatar-web-sdk';

export interface LiveAgentEventHandlers {
  onStatus?: (status: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error') => void;
  onAgentTranscript?: (text: string, speaker: 'user' | 'avatar') => void;
  onError?: (message: string) => void;
}

export class LiveAgentController {
  private session: LiveAvatarSession | null = null;

  async connect(sessionAccessToken: string, mediaElement: HTMLVideoElement, handlers: LiveAgentEventHandlers = {}): Promise<void> {
    await this.disconnect();
    handlers.onStatus?.('connecting');

    try {
      const session = new LiveAvatarSession(sessionAccessToken, { voiceChat: true });

      session.on(SessionEvent.SESSION_STREAM_READY, () => {
        try {
          session.attach(mediaElement);
        } catch {
          handlers.onError?.('LiveAgent stream ready but attach failed.');
        }
      });
      session.on(SessionEvent.SESSION_STATE_CHANGED, (state) => {
        if (state === SessionState.CONNECTED) handlers.onStatus?.('connected');
        else if (state === SessionState.DISCONNECTED) handlers.onStatus?.('disconnected');
      });
      session.on(SessionEvent.SESSION_DISCONNECTED, () => handlers.onStatus?.('disconnected'));

      session.on(AgentEventsEnum.USER_TRANSCRIPTION, (event) => handlers.onAgentTranscript?.(event.text, 'user'));
      session.on(AgentEventsEnum.AVATAR_TRANSCRIPTION, (event) => handlers.onAgentTranscript?.(event.text, 'avatar'));

      await session.start();
      this.session = session;
      handlers.onStatus?.('connected');
    } catch (error) {
      handlers.onStatus?.('error');
      handlers.onError?.(error instanceof Error ? error.message : 'LiveAgent connection failed');
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.session) return;
    try {
      await this.session.stop();
    } catch {
      // Best-effort cleanup; session may already be terminated server-side.
    } finally {
      this.session = null;
    }
  }

  get isConnected(): boolean {
    return this.session?.state === SessionState.CONNECTED;
  }

  speakText(text: string): void {
    if (!this.session || !text.trim()) return;
    this.session.repeat(text.trim());
  }

  askAndRespond(userPrompt: string): void {
    if (!this.session || !userPrompt.trim()) return;
    this.session.message(userPrompt.trim());
  }

  startListening(): void {
    this.session?.startListening();
  }

  stopListening(): void {
    this.session?.stopListening();
  }

  interrupt(): void {
    this.session?.interrupt();
  }
}

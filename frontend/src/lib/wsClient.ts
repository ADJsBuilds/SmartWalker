import { toWsBaseUrl } from './storage';
import type { MergedState, WsStatus } from '../types/api';

type EventPayload =
  | { type: 'snapshot'; data: MergedState[] }
  | { type: 'merged_update'; data: MergedState }
  | Record<string, unknown>;

interface WsClientOptions {
  baseUrl: string;
  residentId?: string;
  onMessage: (payload: EventPayload) => void;
  onStatus: (status: WsStatus) => void;
}

export class SmartWalkerWsClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private retryCount = 0;
  private closedByUser = false;

  constructor(private readonly options: WsClientOptions) {}

  connect(): void {
    this.closedByUser = false;
    this.openSocket();
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.options.onStatus('disconnected');
  }

  private openSocket(): void {
    const wsBase = toWsBaseUrl(this.options.baseUrl);
    const query = this.options.residentId ? `?residentId=${encodeURIComponent(this.options.residentId)}` : '';
    const url = `${wsBase}/ws${query}`;

    this.options.onStatus(this.retryCount === 0 ? 'connecting' : 'reconnecting');
    this.socket = new WebSocket(url);

    this.socket.onopen = () => {
      this.retryCount = 0;
      this.options.onStatus('connected');
    };

    this.socket.onmessage = (event) => {
      const payload = safeParse(event.data);
      this.options.onMessage(payload);
    };

    this.socket.onerror = () => {
      if (!this.closedByUser) {
        this.options.onStatus('disconnected');
      }
    };

    this.socket.onclose = () => {
      this.socket = null;
      if (!this.closedByUser) {
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect(): void {
    const delay = Math.min(1000 * Math.pow(2, this.retryCount), 15000);
    this.retryCount += 1;
    this.options.onStatus('reconnecting');
    this.reconnectTimer = window.setTimeout(() => this.openSocket(), delay);
  }
}

function safeParse(raw: string): EventPayload {
  try {
    return JSON.parse(raw) as EventPayload;
  } catch {
    return { type: 'unknown', raw };
  }
}

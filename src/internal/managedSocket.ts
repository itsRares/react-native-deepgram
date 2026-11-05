import { resolveAuthHeader } from '../helpers/auth';
import { toDeepgramError, type DeepgramError } from '../types/errors';
import type { DeepgramReconnectOptions } from '../types';

export const DEFAULT_RECONNECT: Required<DeepgramReconnectOptions> = {
  enabled: false,
  maxRetries: 5,
  initialDelayMs: 500,
  maxDelayMs: 10_000,
};

export interface SocketMessage {
  data?: unknown;
}

export interface SocketCloseInfo {
  event?: { code?: number; reason?: string };
  /** Reconnect was enabled and every attempt failed. */
  exhausted: boolean;
  maxRetries: number;
  /** Set when the connection could not be established (e.g. auth failed). */
  error?: DeepgramError;
}

export interface ManagedSocketOptions {
  url: () => string;
  binaryType?: 'arraybuffer';
  reconnect: () => DeepgramReconnectOptions | undefined;
  onOpen: (info: { reconnected: boolean }) => void;
  onMessage: (message: SocketMessage) => void;
  onError: (error: DeepgramError) => void;
  onReconnecting?: (attempt: number) => void;
  /** The session ended: closed by the server/user or reconnect gave up. */
  onClose: (info: SocketCloseInfo) => void;
}

type HeaderWebSocket = new (
  url: string,
  protocols: undefined,
  options: { headers: Record<string, string> }
) => WebSocket;

/**
 * A Deepgram WebSocket with auth-header resolution, exponential-backoff
 * reconnects and protection against events from superseded connections.
 */
export class ManagedSocket {
  private socket: WebSocket | null = null;
  private generation = 0;
  private closedByUser = true;
  private attempt = 0;
  private reconnecting = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: ManagedSocketOptions) {}

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** Start a new session (resets the reconnect budget). */
  open(): void {
    this.closedByUser = false;
    this.attempt = 0;
    this.reconnecting = false;
    this.clearReconnectTimer();
    this.connect();
  }

  /**
   * End the session. A connection still waiting for its auth header is
   * abandoned; an open socket still reports `onClose` once it has closed.
   */
  close(code = 1000, reason = 'cleanup'): void {
    this.closedByUser = true;
    this.reconnecting = false;
    this.clearReconnectTimer();
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.close(code, reason);
    } catch {
      // Already closed.
    }
  }

  /** Returns `false` when the socket is not open; send errors propagate. */
  send(data: string | ArrayBuffer): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    socket.send(data);
    return true;
  }

  sendJson(message: object): boolean {
    return this.send(JSON.stringify(message));
  }

  private connect(): void {
    const generation = ++this.generation;
    const isCurrent = () => generation === this.generation;

    resolveAuthHeader()
      .then((authHeader) => {
        if (!isCurrent() || this.closedByUser) {
          return;
        }

        const socket = new (WebSocket as unknown as HeaderWebSocket)(
          this.options.url(),
          undefined,
          { headers: { Authorization: authHeader } }
        );
        if (this.options.binaryType) {
          socket.binaryType = this.options.binaryType;
        }
        this.socket = socket;

        socket.onopen = () => {
          if (!isCurrent()) return;
          const reconnected = this.reconnecting;
          this.reconnecting = false;
          this.attempt = 0;
          this.options.onOpen({ reconnected });
        };
        socket.onmessage = (event) => {
          if (!isCurrent()) return;
          this.options.onMessage(event);
        };
        socket.onerror = (event) => {
          if (!isCurrent()) return;
          this.options.onError(toDeepgramError(event));
        };
        socket.onclose = (event) => {
          if (!isCurrent()) return;
          this.handleClose(event);
        };
      })
      .catch((err) => {
        if (!isCurrent()) return;
        const error = toDeepgramError(err);
        this.options.onError(error);
        this.handleClose(undefined, error);
      });
  }

  private handleClose(
    event?: { code?: number; reason?: string },
    error?: DeepgramError
  ): void {
    const cfg = { ...DEFAULT_RECONNECT, ...this.options.reconnect() };
    const unexpected = !this.closedByUser && cfg.enabled;

    if (unexpected && event?.code !== 1000 && this.attempt < cfg.maxRetries) {
      const attempt = this.attempt++;
      this.reconnecting = true;
      const backoff = Math.min(
        cfg.maxDelayMs,
        cfg.initialDelayMs * 2 ** attempt
      );
      const delay = backoff + Math.random() * backoff * 0.25;
      this.options.onReconnecting?.(attempt + 1);
      this.clearReconnectTimer();
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, delay);
      return;
    }

    this.options.onClose({
      event,
      exhausted: unexpected && this.attempt >= cfg.maxRetries,
      maxRetries: cfg.maxRetries,
      error,
    });
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

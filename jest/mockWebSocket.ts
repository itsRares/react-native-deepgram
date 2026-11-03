/**
 * WebSocket stand-in for hook tests. Sockets start OPEN (hooks check
 * `readyState` before sending); tests drive lifecycle events explicitly.
 */
export class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.OPEN;
  binaryType = '';
  sent: unknown[] = [];
  closeCalls: Array<{ code?: number; reason?: string }> = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;

  constructor(
    public url: string,
    _protocols?: unknown,
    public options?: { headers?: Record<string, string> }
  ) {
    MockWebSocket.instances.push(this);
  }

  static reset(): void {
    MockWebSocket.instances = [];
  }

  static last(): MockWebSocket {
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    if (!socket) throw new Error('No WebSocket was created');
    return socket;
  }

  send(data?: unknown): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = MockWebSocket.CLOSED;
  }

  /** JSON control messages sent by the hook, parsed. */
  sentJson(): Array<Record<string, unknown>> {
    return this.sent
      .filter((frame): frame is string => typeof frame === 'string')
      .map((frame) => JSON.parse(frame));
  }

  sentTypes(): unknown[] {
    return this.sentJson().map((message) => message.type);
  }

  serverJson(message: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  serverClose(code: number): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code });
  }
}

export function installMockWebSocket(): void {
  const g = globalThis as unknown as {
    WebSocket: unknown;
    __DEEPGRAM_API_KEY__: string;
  };
  g.WebSocket = MockWebSocket;
  g.__DEEPGRAM_API_KEY__ = 'test-key';
}

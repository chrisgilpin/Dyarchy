import type { ClientMessage, ServerMessage } from '@dyarchy/shared';

export type MessageHandler = (msg: ServerMessage) => void;

export class Connection {
  private ws: WebSocket | null = null;
  private handlers: MessageHandler[] = [];
  private _connected = false;

  get connected(): boolean {
    return this._connected;
  }

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this._connected = true;
        console.log('Connected to server');
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as ServerMessage;
          for (const handler of this.handlers) {
            handler(msg);
          }
        } catch (e) {
          console.error('Failed to parse server message:', e);
        }
      };

      this.ws.onclose = () => {
        this._connected = false;
        console.log('Disconnected from server');
      };

      this.ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        reject(err);
      };
    });
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
  }
}

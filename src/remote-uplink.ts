// Remote uplink — the OUTBOUND leg of remote control. Dials the relay over
// ws(s) with a device token, ferries the host<->webview protocol in the frames
// defined in remote-frames.ts, and reconnects with backoff. No inbound port on
// the dev box; the relay pairs this connection with browser clients. The
// sidebar owns the policy gate; this module is pure transport.

import WebSocket from "ws";
import type { HostMsg, WebviewMsg } from "./protocol";
import {
  buildUplinkUrl,
  helloFrame,
  hostFrame,
  snapshotFrame,
  parseRelayFrame,
  nextBackoffMs,
  INITIAL_BACKOFF_MS,
} from "./remote-frames";

export interface RemoteUplinkOptions {
  /** ws(s)://relay-host[:port] — the relay's base URL. */
  relayUrl: string;
  /** Long-lived device token from the link flow. */
  token: string;
  deviceName?: string;
  /** Ordered catch-up (already remote-transformed) for a newly-ready browser client. */
  snapshot: () => HostMsg[];
  /** A browser client's webview->host message (already relayed + parsed). */
  onClientMessage: (msg: WebviewMsg) => void;
  log: (line: string) => void;
}

export class RemoteUplink {
  private ws?: WebSocket;
  private backoff = INITIAL_BACKOFF_MS;
  private reconnectTimer?: NodeJS.Timeout;
  private disposed = false;

  constructor(private readonly opts: RemoteUplinkOptions) {}

  start(): void {
    this.connect();
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Fan a host->webview message out to the relay (which broadcasts to this
   *  device's browser clients). Silently dropped while disconnected — a
   *  reconnecting client re-syncs via its own `ready` -> snapshot. */
  broadcast(msg: HostMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(hostFrame(msg)));
      } catch {
        /* teardown race; reconnect handles it */
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    try {
      this.ws?.close();
    } catch {
      /* best effort */
    }
    this.ws = undefined;
  }

  private connect(): void {
    if (this.disposed) return;
    const url = buildUplinkUrl(this.opts.relayUrl, this.opts.token);
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.on("open", () => {
      this.backoff = INITIAL_BACKOFF_MS;
      this.opts.log(`[remote] uplink connected to ${this.opts.relayUrl}`);
      ws.send(JSON.stringify(helloFrame(this.opts.deviceName)));
    });
    ws.on("message", (raw) => {
      const frame = parseRelayFrame(raw.toString());
      if (!frame) return;
      switch (frame.t) {
        case "client-ready":
          // The relay-side twin of the LAN bridge's ready->snapshot: catch this
          // one browser client up, routed back through the relay by clientId.
          try {
            ws.send(JSON.stringify(snapshotFrame(frame.clientId, this.opts.snapshot())));
          } catch {
            /* teardown race */
          }
          return;
        case "msg":
          this.opts.onClientMessage(frame.msg);
          return;
        case "clients":
          this.opts.log(`[remote] relay clients: ${frame.count}`);
          return;
      }
    });
    ws.on("close", (code) => {
      if (this.disposed) return;
      // 4001 = relay rejected the token — retrying with the same token is
      // pointless; the user must re-link. Stop, loudly.
      if (code === 4001) {
        this.opts.log(`[remote] uplink rejected (bad/expired device token) — run "Grok: Link Remote Device" again`);
        return;
      }
      this.opts.log(`[remote] uplink disconnected (code ${code}); retrying in ${Math.round(this.backoff / 1000)}s`);
      this.reconnectTimer = setTimeout(() => this.connect(), this.backoff);
      this.backoff = nextBackoffMs(this.backoff);
    });
    ws.on("error", (e) => {
      this.opts.log(`[remote] uplink error: ${(e as Error).message}`);
      try {
        ws.close();
      } catch {
        /* triggers the close handler's retry */
      }
    });
  }
}

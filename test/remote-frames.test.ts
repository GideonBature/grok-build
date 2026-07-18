import { describe, it, expect } from "vitest";
import {
  REMOTE_PROTO_VERSION,
  helloFrame,
  hostFrame,
  snapshotFrame,
  parseRelayFrame,
  buildUplinkUrl,
  httpBaseFromRelayUrl,
  nextBackoffMs,
  INITIAL_BACKOFF_MS,
  MAX_BACKOFF_MS,
} from "../src/remote-frames";

describe("uplink frame builders", () => {
  it("hello carries the protocol version and optional device name", () => {
    expect(helloFrame("dev-box")).toEqual({ t: "hello", proto: REMOTE_PROTO_VERSION, device: { name: "dev-box" } });
    expect(helloFrame()).toEqual({ t: "hello", proto: REMOTE_PROTO_VERSION });
  });

  it("host/snapshot wrap protocol messages verbatim", () => {
    const msg = { type: "messageChunk", text: "hi" } as const;
    expect(hostFrame(msg)).toEqual({ t: "host", msg });
    expect(snapshotFrame("c1", [msg])).toEqual({ t: "snapshot", clientId: "c1", msgs: [msg] });
  });
});

describe("parseRelayFrame", () => {
  it("round-trips the three relay frames", () => {
    expect(parseRelayFrame(JSON.stringify({ t: "client-ready", clientId: "c1" }))).toEqual({ t: "client-ready", clientId: "c1" });
    expect(parseRelayFrame(JSON.stringify({ t: "msg", clientId: "c1", msg: { type: "send", text: "x" } }))).toEqual({
      t: "msg",
      clientId: "c1",
      msg: { type: "send", text: "x" },
    });
    expect(parseRelayFrame(JSON.stringify({ t: "clients", count: 2 }))).toEqual({ t: "clients", count: 2 });
  });

  it("drops malformed input instead of throwing", () => {
    expect(parseRelayFrame("not json")).toBeNull();
    expect(parseRelayFrame("42")).toBeNull();
    expect(parseRelayFrame(JSON.stringify({ t: "nope" }))).toBeNull();
    expect(parseRelayFrame(JSON.stringify({ t: "client-ready" }))).toBeNull(); // no clientId
    expect(parseRelayFrame(JSON.stringify({ t: "msg", clientId: "c1" }))).toBeNull(); // no msg
    expect(parseRelayFrame(JSON.stringify({ t: "msg", clientId: "c1", msg: { text: "x" } }))).toBeNull(); // msg w/o type
    expect(parseRelayFrame(JSON.stringify({ t: "clients", count: "2" }))).toBeNull();
  });
});

describe("url helpers", () => {
  it("buildUplinkUrl appends /uplink with the encoded token", () => {
    expect(buildUplinkUrl("ws://localhost:8787", "a+b/c")).toBe("ws://localhost:8787/uplink?token=a%2Bb%2Fc");
    expect(buildUplinkUrl("wss://relay.example/", "t")).toBe("wss://relay.example/uplink?token=t");
  });

  it("httpBaseFromRelayUrl swaps ws->http / wss->https and trims the trailing slash", () => {
    expect(httpBaseFromRelayUrl("ws://localhost:8787")).toBe("http://localhost:8787");
    expect(httpBaseFromRelayUrl("wss://relay.example/")).toBe("https://relay.example");
    expect(httpBaseFromRelayUrl("WSS://relay.example")).toBe("https://relay.example");
  });
});

describe("nextBackoffMs", () => {
  it("doubles from the initial value and caps", () => {
    expect(nextBackoffMs(INITIAL_BACKOFF_MS)).toBe(INITIAL_BACKOFF_MS * 2);
    expect(nextBackoffMs(MAX_BACKOFF_MS)).toBe(MAX_BACKOFF_MS);
    expect(nextBackoffMs(0)).toBe(INITIAL_BACKOFF_MS * 2); // floor below initial
  });
});

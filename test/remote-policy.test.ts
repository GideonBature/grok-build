import { describe, it, expect } from "vitest";
import {
  INBOUND_DISPOSITION,
  OUTBOUND_DISPOSITION,
  allowFromRemote,
  inlineMediaForRemote,
  mediaMimeFromPath,
  transformHostMsgForRemote,
  MAX_REMOTE_MEDIA_BYTES,
  type MediaInlineDeps,
} from "../src/remote-policy";
import { HOST_MESSAGE_TYPES, WEBVIEW_MESSAGE_TYPES, type HostMsg } from "../src/protocol";

const sorted = (a: readonly string[]) => [...a].sort();

describe("remote-policy classification tables", () => {
  // tsc already forces this via Record<Union["type"], …>; the runtime assert
  // guards the compiled-JS path the same way protocol.test.ts does.
  it("classifies every WebviewMsg type (no drift behind the protocol)", () => {
    expect(sorted(Object.keys(INBOUND_DISPOSITION))).toEqual(sorted(WEBVIEW_MESSAGE_TYPES));
  });

  it("classifies every HostMsg type", () => {
    expect(sorted(Object.keys(OUTBOUND_DISPOSITION))).toEqual(sorted(HOST_MESSAGE_TYPES));
  });

  it("keeps the load-bearing classifications from the design doc", () => {
    expect(INBOUND_DISPOSITION.ready).toBe("control");
    expect(INBOUND_DISPOSITION.send).toBe("propose");
    expect(INBOUND_DISPOSITION.steerSend).toBe("propose");
    expect(INBOUND_DISPOSITION.permissionAnswer).toBe("full");
    expect(INBOUND_DISPOSITION.exitPlanAnswer).toBe("full");
    expect(INBOUND_DISPOSITION.logout).toBe("full");
    expect(INBOUND_DISPOSITION.clearAllSessions).toBe("full");
    expect(INBOUND_DISPOSITION.listSessions).toBe("view");
    // native pickers/editors/mic act on the LOCAL VS Code — never remote-drivable
    expect(INBOUND_DISPOSITION.openFile).toBe("host-local");
    expect(INBOUND_DISPOSITION.pickFile).toBe("host-local");
    expect(INBOUND_DISPOSITION.voiceStart).toBe("host-local");
    expect(INBOUND_DISPOSITION.moveView).toBe("host-local");
    // config writers mutate the HOST user's settings — blocked until a
    // per-connection view pref exists
    expect(INBOUND_DISPOSITION.setShowThinking).toBe("host-local");
    // voice is host-mic/ffmpeg-driven; media needs the base64 transform
    expect(OUTBOUND_DISPOSITION.voiceState).toBe("host-local");
    expect(OUTBOUND_DISPOSITION.voiceConfigured).toBe("host-local");
    expect(OUTBOUND_DISPOSITION.media).toBe("media");
    expect(OUTBOUND_DISPOSITION.messageChunk).toBe("mirror");
    expect(OUTBOUND_DISPOSITION.permissionRequest).toBe("mirror");
  });
});

describe("allowFromRemote tier gating", () => {
  it("view ops pass at every tier", () => {
    for (const tier of ["read-only", "propose", "full"] as const) {
      expect(allowFromRemote("listSessions", tier)).toBe(true);
      expect(allowFromRemote("resumeSession", tier)).toBe(true);
    }
  });

  it("propose ops need propose or full", () => {
    expect(allowFromRemote("send", "read-only")).toBe(false);
    expect(allowFromRemote("send", "propose")).toBe(true);
    expect(allowFromRemote("send", "full")).toBe(true);
  });

  it("approvals and destructive ops need full", () => {
    for (const t of ["permissionAnswer", "exitPlanAnswer", "logout", "deleteSession", "clearAllSessions", "updateGrok"] as const) {
      expect(allowFromRemote(t, "propose")).toBe(false);
      expect(allowFromRemote(t, "full")).toBe(true);
    }
  });

  it("host-local and control are never routed, even at full", () => {
    for (const t of ["openFile", "pickFile", "voiceStart", "moveView", "dropFile", "exportExpr", "ready"] as const) {
      expect(allowFromRemote(t, "full")).toBe(false);
    }
  });
});

const deps = (bytes: Uint8Array | null): MediaInlineDeps => ({
  readFile: () => bytes,
  toBase64: (b) => Buffer.from(b).toString("base64"),
});

const mediaMsg = (over: Partial<Extract<HostMsg, { type: "media" }>> = {}): Extract<HostMsg, { type: "media" }> => ({
  type: "media",
  media: "image",
  ...over,
});

describe("inlineMediaForRemote", () => {
  it("passes an already-inlined data: src through unchanged", () => {
    const msg = mediaMsg({ src: "data:image/png;base64,AAAA" });
    expect(inlineMediaForRemote(msg, deps(null))).toBe(msg);
  });

  it("passes a remote-url-only message through (the browser can load it)", () => {
    const msg = mediaMsg({ url: "https://example.com/x.png" });
    expect(inlineMediaForRemote(msg, deps(null))).toBe(msg);
  });

  it("inlines a webview-uri src from the file path, inferring mime", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const out = inlineMediaForRemote(
      mediaMsg({ src: "https://file%2B.vscode-resource.example/x.png", path: "C:\\media\\shot.png" }),
      deps(bytes),
    );
    expect(out?.src).toBe(`data:image/png;base64,${Buffer.from(bytes).toString("base64")}`);
    expect(out?.mimeType).toBe("image/png");
    expect(out?.path).toBe("C:\\media\\shot.png"); // copy-path action survives
  });

  it("prefers the message's own mimeType over the extension guess", () => {
    const out = inlineMediaForRemote(
      mediaMsg({ src: "x", path: "/a/pic.bin", mimeType: "image/jpeg" }),
      deps(new Uint8Array([9])),
    );
    expect(out?.src?.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("never transfers video to a remote — by media kind, mime, or extension", () => {
    const bytes = deps(new Uint8Array([1]));
    expect(inlineMediaForRemote(mediaMsg({ media: "video", src: "x", path: "/a/clip.mp4" }), bytes)).toBeNull();
    // even an already-inlined or url-only video is dropped
    expect(inlineMediaForRemote(mediaMsg({ media: "video", src: "data:video/mp4;base64,AAAA" }), bytes)).toBeNull();
    expect(inlineMediaForRemote(mediaMsg({ media: "video", url: "https://example.com/x.mp4" }), bytes)).toBeNull();
    // mis-tagged media field still caught by the mime belt
    expect(inlineMediaForRemote(mediaMsg({ src: "x", path: "/a/clip.mp4" }), bytes)).toBeNull();
    expect(inlineMediaForRemote(mediaMsg({ src: "x", path: "/a/clip.bin", mimeType: "video/webm" }), bytes)).toBeNull();
  });

  it("drops (null) when the file is unreadable, oversized, or pathless", () => {
    expect(inlineMediaForRemote(mediaMsg({ src: "x", path: "/gone.png" }), deps(null))).toBeNull();
    const big = { ...deps(new Uint8Array(10)), maxBytes: 5 };
    expect(inlineMediaForRemote(mediaMsg({ src: "x", path: "/big.png" }), big)).toBeNull();
    expect(inlineMediaForRemote(mediaMsg({ src: "vscode-webview://x" }), deps(new Uint8Array(1)))).toBeNull();
  });

  it("default size cap is the documented constant", () => {
    expect(MAX_REMOTE_MEDIA_BYTES).toBe(25 * 1024 * 1024);
  });
});

describe("transformHostMsgForRemote", () => {
  it("mirror types pass through by reference", () => {
    const msg: HostMsg = { type: "messageChunk", text: "hi" };
    expect(transformHostMsgForRemote(msg, deps(null))).toBe(msg);
  });

  it("host-local (voice) types are suppressed", () => {
    expect(transformHostMsgForRemote({ type: "voiceState", status: "idle" }, deps(null))).toBeNull();
    expect(transformHostMsgForRemote({ type: "voiceConfigured", value: true }, deps(null))).toBeNull();
  });

  it("media is inlined via the injected reader", () => {
    const out = transformHostMsgForRemote(mediaMsg({ src: "x", path: "/img.webp" }), deps(new Uint8Array([7])));
    expect((out as { src?: string })?.src?.startsWith("data:image/webp;base64,")).toBe(true);
  });
});

describe("mediaMimeFromPath", () => {
  it("maps known extensions and falls back to octet-stream", () => {
    expect(mediaMimeFromPath("/a/b.PNG")).toBe("image/png");
    expect(mediaMimeFromPath("clip.mp4")).toBe("video/mp4");
    expect(mediaMimeFromPath("noext")).toBe("application/octet-stream");
  });
});

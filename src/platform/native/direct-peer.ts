import { PeerConnection, cleanup, type DataChannel } from "node-datachannel";
import type { DirectPeerFactory, IceServer, PeerCandidate } from "../direct-peer";

/** libdatachannel takes TURN credentials in the URI, unlike the browser configuration. */
export function nativeIceServers(servers: IceServer[]): string[] {
  return servers.flatMap((server) => {
    const credentialType = (server as IceServer & { credentialType?: unknown }).credentialType;
    if (
      (credentialType !== undefined && credentialType !== "password") ||
      (server.username !== undefined && typeof server.username !== "string") ||
      (server.credential !== undefined && typeof server.credential !== "string")
    )
      throw new Error("Native WebRTC ICE credentials must be plain username/password strings.");
    return (Array.isArray(server.urls) ? server.urls : [server.urls]).map((url) => {
      const turn = /^(turns?):(?:\/\/)?(.*)$/i.exec(url);
      if (!turn) return url;
      if (server.username === undefined || server.credential === undefined)
        throw new Error("Native WebRTC TURN requires username and password strings.");
      if (turn[2]!.includes("@"))
        throw new Error("Native WebRTC TURN credentials must be separate from the URL.");
      return `${turn[1]!.toLowerCase()}:${encodeURIComponent(server.username)}:${encodeURIComponent(server.credential)}@${turn[2]}`;
    });
  });
}

/** Call once at process shutdown, after application/session teardown has closed every peer. */
export function cleanupNativeDirectPeers(): void {
  cleanup();
}

export const nativeDirectPeer: DirectPeerFactory = ({ initiator, iceServers }, callbacks) => {
  const peer = new PeerConnection("poketone", {
    iceServers: nativeIceServers(iceServers),
    disableAutoNegotiation: true,
  });
  let events: typeof callbacks | undefined = callbacks;
  let channel: DataChannel | undefined;
  let closed = false;
  let opened = false;
  let disconnected = false;
  let remoteReady = false;
  const candidates: PeerCandidate[] = [];
  let negotiation = Promise.resolve();

  const notifyDisconnected = () => {
    if (disconnected) return;
    disconnected = true;
    events?.disconnected();
  };
  const bind = (next: DataChannel) => {
    if (closed) {
      next.close();
      return;
    }
    channel = next;
    const notifyOpen = () => {
      if (opened) return;
      opened = true;
      events?.opened();
    };
    next.onOpen(notifyOpen);
    next.onClosed(notifyDisconnected);
    next.onError((message) => events?.error(new Error(`Direct peer data channel: ${message}`)));
    next.onMessage((message) => {
      if (typeof message === "string") events?.message(message);
      else events?.error(new Error("Direct peer received a non-text message."));
    });
    if (next.isOpen()) notifyOpen();
  };
  const addCandidate = (candidate: PeerCandidate) => {
    // An empty candidate is the browser's end-of-candidates marker; libdatachannel needs no call.
    if (candidate.candidate) peer.addRemoteCandidate(candidate.candidate, candidate.sdpMid ?? "");
  };
  peer.onLocalDescription((sdp, type) => {
    if (type === "offer" || type === "answer") events?.signal({ description: { type, sdp } });
    else events?.error(new Error(`Unexpected native WebRTC description type: ${type}`));
  });
  peer.onLocalCandidate((candidate, sdpMid) =>
    events?.signal({ candidate: { candidate, sdpMid } }),
  );
  peer.onDataChannel(bind);
  peer.onStateChange((state) => {
    // "disconnected" is often transient; the channel close still reports a real loss.
    if (state === "failed" || state === "closed") notifyDisconnected();
  });

  if (initiator) {
    bind(peer.createDataChannel("poketone", { unordered: false }));
    negotiation = negotiation.then(() => {
      if (!closed) peer.setLocalDescription("offer");
    });
    void negotiation.catch((cause: unknown) => {
      events?.error(new Error("Direct peer offer failed.", { cause }));
    });
  }

  return {
    get open() {
      return !closed && channel !== undefined && channel.isOpen();
    },
    get bufferedAmount() {
      return closed ? 0 : (channel?.bufferedAmount() ?? 0);
    },
    accept(signal) {
      negotiation = negotiation.then(() => {
        if (closed) return;
        if ("description" in signal) {
          peer.setRemoteDescription(signal.description.sdp, signal.description.type);
          remoteReady = true;
          for (const candidate of candidates.splice(0)) addCandidate(candidate);
          if (signal.description.type === "offer") peer.setLocalDescription("answer");
        } else if (remoteReady) addCandidate(signal.candidate);
        else candidates.push(signal.candidate);
      });
      return negotiation;
    },
    send(text) {
      if (closed || !channel?.isOpen()) throw new Error("Direct peer is not open.");
      // false means queued by SCTP, not rejected; never retry or duplicate this message.
      channel.sendMessage(text);
    },
    close() {
      if (closed) return;
      closed = true;
      // Native callbacks cannot be removed; release the session and guard queued notifications.
      events = undefined;
      candidates.length = 0;
      channel?.close();
      peer.close();
    },
  };
};

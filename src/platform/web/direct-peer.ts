import type { DirectPeerFactory, PeerCandidate } from "../direct-peer";

export const webDirectPeer: DirectPeerFactory = ({ initiator, iceServers }, callbacks) => {
  const peer = new RTCPeerConnection({ iceServers });
  let events: typeof callbacks | undefined = callbacks;
  let channel: RTCDataChannel | undefined;
  let closed = false;
  let opened = false;
  let disconnected = false;
  const candidates: PeerCandidate[] = [];
  let negotiation = Promise.resolve();

  const notifyDisconnected = () => {
    if (disconnected) return;
    disconnected = true;
    events?.disconnected();
  };
  const bind = (next: RTCDataChannel) => {
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
    next.onopen = notifyOpen;
    next.onmessage = ({ data }) => {
      if (typeof data === "string") events?.message(data);
      else events?.error(new Error("Direct peer received a non-text message."));
    };
    next.onclose = notifyDisconnected;
    next.onerror = () => events?.error(new Error("Direct peer data channel failed."));
    if (next.readyState === "open") notifyOpen();
  };
  peer.onicecandidate = ({ candidate }) => {
    if (candidate) events?.signal({ candidate: candidate.toJSON() as PeerCandidate });
  };
  peer.ondatachannel = ({ channel }) => bind(channel);
  peer.onconnectionstatechange = () => {
    // "disconnected" is often a transient ICE state that recovers by itself; the channel close still reports.
    if (["failed", "closed"].includes(peer.connectionState)) notifyDisconnected();
  };

  if (initiator) {
    bind(peer.createDataChannel("poketone", { ordered: true }));
    negotiation = negotiation.then(async () => {
      if (closed) return;
      const offer = await peer.createOffer();
      if (closed) return;
      await peer.setLocalDescription(offer);
      if (!closed)
        events?.signal({ description: { type: "offer", sdp: peer.localDescription!.sdp } });
    });
    void negotiation.catch((cause: unknown) => {
      events?.error(new Error("Direct peer offer failed.", { cause }));
    });
  }

  return {
    get open() {
      return !closed && channel?.readyState === "open";
    },
    get bufferedAmount() {
      return closed ? 0 : (channel?.bufferedAmount ?? 0);
    },
    accept(signal) {
      negotiation = negotiation.then(async () => {
        if (closed) return;
        if ("description" in signal) {
          await peer.setRemoteDescription(signal.description);
          if (closed) return;
          for (const candidate of candidates.splice(0)) {
            await peer.addIceCandidate(candidate);
            if (closed) return;
          }
          if (signal.description.type === "offer") {
            const answer = await peer.createAnswer();
            if (closed) return;
            await peer.setLocalDescription(answer);
            if (!closed)
              events?.signal({ description: { type: "answer", sdp: peer.localDescription!.sdp } });
          }
        } else if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate);
        else candidates.push(signal.candidate);
      });
      return negotiation;
    },
    send(text) {
      if (closed || channel?.readyState !== "open") throw new Error("Direct peer is not open.");
      channel.send(text);
    },
    close() {
      if (closed) return;
      closed = true;
      events = undefined;
      candidates.length = 0;
      if (channel) {
        channel.onopen = channel.onmessage = channel.onclose = channel.onerror = null;
        channel.close();
      }
      peer.onicecandidate = peer.ondatachannel = peer.onconnectionstatechange = null;
      peer.close();
    },
  };
};

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface PeerCandidate {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

/** Validated by the network boundary; transport mode messages stay in the session. */
export type PeerSignal =
  | { description: { type: "offer" | "answer"; sdp: string } }
  | { candidate: PeerCandidate };

export interface DirectPeer {
  readonly open: boolean;
  readonly bufferedAmount: number;
  /** Serialized with initial negotiation. Failures reject; discard the failed peer. */
  accept(signal: PeerSignal): Promise<void>;
  send(text: string): void;
  close(): void;
}

export interface DirectPeerEvents {
  signal(signal: PeerSignal): void;
  opened(): void;
  message(text: string): void;
  disconnected(): void;
  error(error: Error): void;
}

export type DirectPeerFactory = (
  options: { initiator: boolean; iceServers: IceServer[] },
  events: DirectPeerEvents,
) => DirectPeer;

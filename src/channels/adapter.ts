export type ChannelOutbound = {
  phone: string;
  text: string;
  spaceId?: string;
  senderId?: string;
};

export interface ChannelAdapter {
  readonly name: "simulator" | "photon";
  send(message: ChannelOutbound): Promise<void>;
}

/** The web phone is the inbox. Replies are already on the thread. */
export const simulatorAdapter: ChannelAdapter = {
  name: "simulator",
  async send() {},
};

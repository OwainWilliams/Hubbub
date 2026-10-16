/**
 * One instance per room code. Holds no stored data: it exists only while sockets are connected,
 * so a room "vanishes" when the last person leaves. Phase 1 fills in peer discovery and relaying
 * WebRTC offers, answers and ICE candidates between peers.
 */
export class Room implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    _env: unknown,
  ) {
    void this.state;
  }

  async fetch(_request: Request): Promise<Response> {
    return new Response('Room signalling arrives in Phase 1', { status: 501 });
  }
}

import readline from 'node:readline';
import { CollabRoomClient } from './room.js';
import { collabHash } from './text.js';

type BridgeRequest = {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
};

function send(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

export async function startCollabBridge(openRoom: (target: string) => Promise<CollabRoomClient>): Promise<void> {
  let room: CollabRoomClient | null = null;
  let cleanupObserver: (() => void) | null = null;
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });

  function attachObserver(nextRoom: CollabRoomClient): void {
    cleanupObserver?.();
    const ytext = nextRoom.doc.getText('content');
    const observer = () => {
      const content = ytext.toString();
      send({ event: 'document_change', content, hash: collabHash(content) });
    };
    ytext.observe(observer);
    cleanupObserver = () => ytext.unobserve(observer);
  }

  function closeRoom(): void {
    cleanupObserver?.();
    cleanupObserver = null;
    room?.close();
    room = null;
  }

  for await (const line of rl) {
    if (!line.trim()) continue;
    let req: BridgeRequest;
    try {
      req = JSON.parse(line) as BridgeRequest;
    } catch (err) {
      send({ event: 'error', code: 'bad_json', message: String(err) });
      continue;
    }

    try {
      if (req.method === 'open') {
        const target = String(req.params?.target ?? '');
        closeRoom();
        room = await openRoom(target);
        attachObserver(room);
        const current = room.read();
        send({ id: req.id, result: { content: current.content, hash: current.collabHash, read_only: current.readOnly } });
        send({ event: 'opened', content: current.content, hash: current.collabHash });
      } else if (req.method === 'local_change') {
        if (!room) throw new Error('room is not open');
        const content = String(req.params?.content ?? '');
        const baseHash = req.params?.base_hash ? String(req.params.base_hash) : undefined;
        const result = room.write(content, { baseHash, force: req.params?.force === true });
        send({ id: req.id, result: { hash: result.collabHash } });
      } else if (req.method === 'publish') {
        if (!room) throw new Error('room is not open');
        send({ id: req.id, result: await room.publish() });
      } else if (req.method === 'status') {
        send({ id: req.id, result: room ? room.read() : { connected: false } });
      } else if (req.method === 'close') {
        closeRoom();
        send({ id: req.id, result: { ok: true } });
      } else {
        throw new Error(`unknown method: ${req.method}`);
      }
    } catch (err) {
      send({ id: req.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  closeRoom();
}

import { createHash } from 'node:crypto';
import * as Y from 'yjs';

export function collabHash(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

export class CollabConflictError extends Error {
  constructor(
    public readonly currentHash: string,
    public readonly baseHash: string
  ) {
    super(
      `collaborative document changed since base_collab_hash (current: ${currentHash}, base: ${baseHash})`
    );
    this.name = 'CollabConflictError';
  }
}

export function getYText(doc: Y.Doc): Y.Text {
  return doc.getText('content');
}

export function readText(doc: Y.Doc): string {
  return getYText(doc).toString();
}

export function replaceText(
  doc: Y.Doc,
  nextContent: string,
  opts: { baseHash?: string; force?: boolean; origin?: unknown } = {}
): { previousHash: string; hash: string } {
  const ytext = getYText(doc);
  const previous = ytext.toString();
  const previousHash = collabHash(previous);
  if (!opts.force && opts.baseHash && previousHash !== opts.baseHash) {
    throw new CollabConflictError(previousHash, opts.baseHash);
  }

  doc.transact(() => {
    ytext.delete(0, ytext.length);
    if (nextContent) ytext.insert(0, nextContent);
  }, opts.origin ?? 'docz-cli');

  return { previousHash, hash: collabHash(nextContent) };
}

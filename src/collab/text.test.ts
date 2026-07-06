import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { buildCollabDocumentName, normalizeCollabFilePath } from './roomName.js';
import {
  CollabBaseHashRequiredError,
  CollabConflictError,
  collabHash,
  readText,
  replaceText,
} from './text.js';

describe('collab text helpers', () => {
  it('calculates stable sha256 hashes', () => {
    expect(collabHash('hello')).toBe(
      'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });

  it('replaces Y.Text content when base hash matches', () => {
    const doc = new Y.Doc();
    const first = replaceText(doc, 'first', { force: true });
    const second = replaceText(doc, 'second', { baseHash: first.hash });

    expect(readText(doc)).toBe('second');
    expect(second.previousHash).toBe(first.hash);
    expect(second.hash).toBe(collabHash('second'));
  });

  it('rejects stale base hashes without mutating content', () => {
    const doc = new Y.Doc();
    replaceText(doc, 'current', { force: true });

    expect(() =>
      replaceText(doc, 'next', { baseHash: collabHash('old') })
    ).toThrow(CollabConflictError);
    expect(readText(doc)).toBe('current');
  });

  it('requires a base hash unless force is explicit', () => {
    const doc = new Y.Doc();
    replaceText(doc, 'current', { force: true });

    expect(() => replaceText(doc, 'next')).toThrow(CollabBaseHashRequiredError);
    expect(readText(doc)).toBe('current');
  });
});

describe('collab room name helpers', () => {
  it('normalizes paths like the web editor does', () => {
    expect(normalizeCollabFilePath('/docs//方案.md')).toBe('docs/方案.md');
    expect(normalizeCollabFilePath('docs%2F方案.md')).toBe('docs/方案.md');
    expect(buildCollabDocumentName('space-1', '/docs/方案.md')).toBe(
      'space-1:docs/方案.md'
    );
  });

  it('rejects parent directory traversal', () => {
    expect(() => normalizeCollabFilePath('../secret.md')).toThrow(
      'invalid collab file path'
    );
  });
});

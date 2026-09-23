function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

export function normalizeCollabFilePath(path: string): string {
  const decoded = decodePath(path.trim()).replace(/\\/g, '/');
  const parts: string[] = [];

  for (const part of decoded.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') throw new Error('invalid collab file path');
    parts.push(part);
  }

  return parts.join('/');
}

export function buildCollabDocumentName(
  spaceId: string,
  filePath: string,
  fileId?: string
): string {
  const sid = spaceId.trim();
  if (fileId !== undefined) {
    if (!sid || sid.includes(':') || !/^[a-zA-Z0-9_-]+$/.test(fileId))
      throw new Error('invalid collab file identity');
    return `v2:${sid}:${fileId}`;
  }
  const normalizedPath = normalizeCollabFilePath(filePath);
  if (!sid || !normalizedPath)
    throw new Error('space id and file path are required');
  return `${sid}:${normalizedPath}`;
}

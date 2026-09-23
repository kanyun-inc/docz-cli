export interface CollabTarget {
  spaceId: string;
  path: string;
}

export interface CollabOpenOptions extends CollabTarget {
  fileId?: string;
  identityVersion?: number;
  readOnly?: boolean;
  baseUrl: string;
  token: string;
  client: string;
  clientVersion: string;
  timeoutMs?: number;
}

export interface CollabReadResult extends CollabTarget {
  content: string;
  collabHash: string;
  connected: boolean;
  readOnly: boolean;
}

export interface CollabWriteResult extends CollabTarget {
  previousHash: string;
  collabHash: string;
}

export interface CollabPublishResult extends CollabTarget {
  ref: string;
  contentRef: string;
  externalBackup: string;
}

export class CollabUnknownError extends Error {
  constructor(
    message: string,
    public readonly code = 'result_unknown'
  ) {
    super(message);
    this.name = 'CollabUnknownError';
  }
}

export class CollabError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'CollabError';
  }
}

export class CollabPublishError extends Error {
  constructor(
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'CollabPublishError';
  }
}

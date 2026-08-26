/**
 * DocSync API Client
 *
 * DocSync 底层是 Git 仓库，每个 Space = 一个 Git repo。
 * 认证：Authorization: Bearer {token}（支持 JWT 和永久 API Token）。
 */

import type {
  SheetOperation,
  SheetOutcome,
  SheetSession,
} from './sheet/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Space {
  id: string;
  name: string;
  slug?: string;
  owner_id: string;
  is_private: boolean;
  created_at: string;
  member_count: number;
}

export interface TreeEntry {
  name: string;
  type: 'blob' | 'tree';
  size: number;
}

export interface RecursiveTreeEntry {
  path: string;
  type: 'blob' | 'tree';
  size: number;
}

export interface LogEntry {
  hash: string;
  author: string;
  message: string;
  date: string;
  num_files: number;
}

interface LogResponse {
  commits: LogEntry[];
}

export interface TrashEntry {
  path: string;
  deleted_by: string;
  deleted_at: string;
  commit: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
}

export interface ShareLink {
  id: string;
  token: string;
  space_id: string;
  file_path: string;
  created_by: string;
  created_by_name?: string;
  created_by_email?: string;
  expires_at: string | null;
  created_at: string;
  user_ids?: string[];
  group_ids?: string[];
}

export interface ShareFileInfo {
  file_path: string;
  file_name: string;
  space_id: string;
  space_name: string;
  space_slug?: string;
  created_by_name: string;
  expires_at: string | null;
  has_space_access: boolean;
  role: string;
  is_public: boolean;
  is_dir: boolean;
  document_exists: boolean;
  owner_name?: string;
  owner_email?: string;
}

export interface LinkDiagnostic {
  link_valid: boolean;
  space_exists: boolean;
  has_space_access: boolean;
  document_applicable: boolean;
  document_exists: boolean;
  id?: string;
  space_id?: string;
  slug?: string;
  path?: string;
  is_dir?: boolean;
  is_alias?: boolean;
  owner_name?: string;
  owner_email?: string;
}

export interface ShareLinkInspection {
  link_status: 'valid' | 'invalid' | 'expired';
  access_status: 'accessible' | 'login_required' | 'forbidden' | 'unknown';
  info?: ShareFileInfo;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isShareFileInfo(value: unknown): value is ShareFileInfo {
  if (!isRecord(value)) return false;
  return (
    typeof value.file_path === 'string' &&
    typeof value.file_name === 'string' &&
    typeof value.space_id === 'string' &&
    typeof value.space_name === 'string' &&
    typeof value.created_by_name === 'string' &&
    (value.expires_at === null || typeof value.expires_at === 'string') &&
    typeof value.has_space_access === 'boolean' &&
    typeof value.role === 'string' &&
    typeof value.is_public === 'boolean' &&
    typeof value.is_dir === 'boolean' &&
    typeof value.document_exists === 'boolean'
  );
}

function isLinkDiagnostic(value: unknown): value is LinkDiagnostic {
  if (!isRecord(value)) return false;
  return (
    typeof value.link_valid === 'boolean' &&
    typeof value.space_exists === 'boolean' &&
    typeof value.has_space_access === 'boolean' &&
    typeof value.document_applicable === 'boolean' &&
    typeof value.document_exists === 'boolean' &&
    (value.path === undefined || typeof value.path === 'string') &&
    (value.is_dir === undefined || typeof value.is_dir === 'boolean')
  );
}

export interface DiffResponse {
  from: string;
  to: string;
  path: string;
  diff: string;
  old_body: string;
  new_body: string;
}

export interface DiffFileEntry {
  path: string;
  status: string;
}

export interface DiffSummary {
  from: string;
  to: string;
  files: DiffFileEntry[];
}

export interface FileRef {
  id: string;
  space_id: string;
  path: string;
}

export interface CatResult {
  content: string;
  ref: string;
}

export interface UploadImageResult {
  url: string;
  object_key: string;
  content_type: string;
  size: number;
}

export interface SaveResult {
  path: string;
  ref: string;
}

export interface SaveConflict {
  error: 'conflict';
  current_ref: string;
  path: string;
}

export interface Comment {
  id: number;
  space_id: string;
  file_path: string;
  comment_type: string;
  target_type: string;
  target_selector: string;
  target_content: string;
  content: string;
  user_id: string;
  user_name: string;
  user_email: string;
  is_closed: boolean;
  created_at: string;
  updated_at: string;
  replies: CommentReply[];
}

export interface CommentReply {
  id: number;
  comment_id: number;
  content: string;
  user_id: string;
  user_name: string;
  user_email: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ConflictError extends Error {
  constructor(public readonly detail: SaveConflict) {
    super(
      'Conflict: file has been modified by others. Please re-read the latest content and re-apply your changes.'
    );
    this.name = 'ConflictError';
  }
}

export interface MoveErrorDetail {
  error: string;
  message: string;
  outcome: 'failed' | 'unknown';
  old_path?: string;
  new_path?: string;
  parent_path?: string;
}

export class MoveError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: MoveErrorDetail
  ) {
    super(detail.message);
    this.name = 'MoveError';
  }
}

function isMoveErrorDetail(value: unknown): value is MoveErrorDetail {
  if (!value || typeof value !== 'object') return false;
  const detail = value as Record<string, unknown>;
  return (
    typeof detail.error === 'string' &&
    typeof detail.message === 'string' &&
    (detail.outcome === 'failed' || detail.outcome === 'unknown')
  );
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class DocSyncClient {
  constructor(
    private baseUrl: string,
    private token: string
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...init?.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${res.status} ${res.statusText}: ${body}`.trim());
    }

    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) return res.json() as Promise<T>;
    return res.text() as unknown as T;
  }

  private async requestText(path: string, init?: RequestInit): Promise<string> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...init?.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${res.status} ${res.statusText}: ${body}`.trim());
    }

    return res.text();
  }

  // --- Auth ---
  async me(): Promise<User> {
    return this.request('/api/auth/me');
  }

  // --- Spaces ---
  async listSpaces(): Promise<Space[]> {
    return this.request('/api/spaces');
  }

  async resolveSpace(nameOrId: string): Promise<Space> {
    const spaces = await this.listSpaces();
    const input = nameOrId.toLowerCase();

    // 1-3: exact id / exact name / case-insensitive name
    const exact = spaces.find(
      (s) =>
        s.id === nameOrId ||
        s.name === nameOrId ||
        s.name.toLowerCase() === input
    );
    if (exact) return exact;

    // 4: slug exact match
    const bySlug = spaces.find((s) => s.slug === nameOrId);
    if (bySlug) return bySlug;

    // 5: name suffix match (e.g. "研发" matches "G160-研发")
    const suffixMatches = spaces.filter(
      (s) =>
        s.name.length > nameOrId.length && s.name.toLowerCase().endsWith(input)
    );
    if (suffixMatches.length === 1) return suffixMatches[0];
    if (suffixMatches.length > 1) {
      const candidates = suffixMatches.map((s) => s.name).join(', ');
      throw new Error(
        `Space "${nameOrId}" is ambiguous, matches: ${candidates}. Use the full name or UUID.`
      );
    }

    const available = spaces
      .map((s) => (s.slug ? `${s.name} (${s.slug})` : s.name))
      .join(', ');
    throw new Error(`Space "${nameOrId}" not found. Available: ${available}`);
  }

  // --- Tree ---
  async ls(spaceId: string, path = ''): Promise<TreeEntry[]> {
    return this.request(
      `/api/spaces/${spaceId}/tree?path=${encodeURIComponent(path)}`
    );
  }

  async treeFull(spaceId: string, path = ''): Promise<RecursiveTreeEntry[]> {
    const entries = await this.request<RecursiveTreeEntry[]>(
      `/api/spaces/${spaceId}/tree/full`
    );
    const targetPath = path.replace(/^\/+|\/+$/g, '');
    if (!targetPath) return entries;

    const childPrefix = `${targetPath}/`;
    return entries.filter(
      (entry) =>
        (entry.path === targetPath && entry.type === 'blob') ||
        entry.path.startsWith(childPrefix)
    );
  }

  // --- Blob ---
  async cat(spaceId: string, filepath: string): Promise<string> {
    return this.requestText(
      `/api/spaces/${spaceId}/blob/${encodeURIComponent(filepath)}`
    );
  }

  async catWithRef(spaceId: string, filepath: string): Promise<CatResult> {
    const res = await fetch(
      `${this.baseUrl}/api/spaces/${spaceId}/blob/${encodeURIComponent(filepath)}`,
      { headers: { Authorization: `Bearer ${this.token}` } }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${res.status} ${res.statusText}: ${body}`.trim());
    }
    const content = await res.text();
    const ref = res.headers.get('X-Git-Ref') ?? '';
    return { content, ref };
  }

  // --- Write ---
  async upload(
    spaceId: string,
    dir: string,
    filename: string,
    content: string | Buffer
  ): Promise<{ path: string }> {
    const blob =
      typeof content === 'string'
        ? new Blob([content], { type: 'application/octet-stream' })
        : new Blob([content], { type: 'application/octet-stream' });
    const form = new FormData();
    form.append('file', blob, filename);
    form.append('path', dir);
    return this.request(`/api/spaces/${spaceId}/files/upload`, {
      method: 'POST',
      body: form,
    });
  }

  /**
   * Upload an image to the server's OSS asset storage.
   * Returns a permanent public URL that can be embedded in Markdown.
   * Server limits: png/jpg/webp only, max 5MB.
   */
  async uploadImage(
    content: Buffer,
    filename: string
  ): Promise<UploadImageResult> {
    const blob = new Blob([content], { type: 'application/octet-stream' });
    const form = new FormData();
    form.append('file', blob, filename);
    return this.request('/api/assets/images', {
      method: 'POST',
      body: form,
    });
  }

  async save(
    spaceId: string,
    path: string,
    content: string,
    opts?: { baseRef?: string; message?: string }
  ): Promise<SaveResult> {
    const body: Record<string, string> = { path, content };
    if (opts?.baseRef) body.base_ref = opts.baseRef;
    if (opts?.message) body.message = opts.message;

    const res = await fetch(
      `${this.baseUrl}/api/spaces/${spaceId}/files/save`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    if (res.status === 409) {
      const data = (await res.json()) as SaveConflict;
      throw new ConflictError(data);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${res.status} ${res.statusText}: ${text}`.trim());
    }

    return res.json() as Promise<SaveResult>;
  }

  async mkdir(spaceId: string, path: string): Promise<void> {
    await this.request(`/api/spaces/${spaceId}/files/mkdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
  }

  async rm(spaceId: string, path: string): Promise<void> {
    await this.request(`/api/spaces/${spaceId}/files/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
  }

  async mv(spaceId: string, from: string, to: string): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/spaces/${spaceId}/files/rename`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ old_path: from, new_path: to }),
      });
    } catch {
      throw new MoveError(0, {
        error: 'move_status_unknown',
        message: 'Move request ended without a response',
        outcome: 'unknown',
        old_path: from,
        new_path: to,
      });
    }

    if (res.ok) return;

    const text = await res.text().catch(() => '');
    try {
      const detail = JSON.parse(text) as unknown;
      if (isMoveErrorDetail(detail)) {
        throw new MoveError(res.status, detail);
      }
    } catch (err) {
      if (err instanceof MoveError) throw err;
    }

    // Older servers returned plain text. A 5xx response cannot prove whether
    // the mutating Seafile call took effect, so report it as unknown.
    throw new MoveError(res.status, {
      error: res.status >= 500 ? 'move_status_unknown' : 'move_failed',
      message:
        text.trim() ||
        `${res.status} ${res.statusText || 'Move request failed'}`.trim(),
      outcome: res.status >= 500 ? 'unknown' : 'failed',
      old_path: from,
      new_path: to,
    });
  }

  async rollback(
    spaceId: string,
    filePath: string,
    commitHash: string
  ): Promise<void> {
    await this.request(`/api/spaces/${spaceId}/files/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: filePath, commit_hash: commitHash }),
    });
  }

  // --- History ---
  async log(spaceId: string, filepath?: string): Promise<LogEntry[]> {
    const path = filepath
      ? `/api/spaces/${spaceId}/log/${encodeURIComponent(filepath)}`
      : `/api/spaces/${spaceId}/log/`;
    const response = await this.request<LogResponse>(path);
    return response.commits;
  }

  // --- Trash ---
  async trash(spaceId: string): Promise<TrashEntry[]> {
    return this.request(`/api/spaces/${spaceId}/trash`);
  }

  async restore(spaceId: string, path: string, commit: string): Promise<void> {
    await this.request(`/api/spaces/${spaceId}/trash/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, commit }),
    });
  }

  // --- Comments ---
  async listComments(spaceId: string, filePath: string): Promise<Comment[]> {
    return this.request(
      `/api/spaces/${spaceId}/comments?path=${encodeURIComponent(filePath)}`
    );
  }

  async createComment(
    spaceId: string,
    filePath: string,
    content: string,
    opts?: { quote?: string }
  ): Promise<Comment> {
    const body: Record<string, string> = { file_path: filePath, content };
    if (opts?.quote) {
      body.comment_type = 'text';
      body.target_type = 'selection';
      body.target_content = opts.quote;
      body.target_selector = JSON.stringify({
        startOffset: 0,
        endOffset: 0,
        text: opts.quote,
        prefix: '',
        suffix: '',
      });
    }
    return this.request(`/api/spaces/${spaceId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async replyComment(
    spaceId: string,
    commentId: number,
    content: string
  ): Promise<CommentReply> {
    return this.request(
      `/api/spaces/${spaceId}/comments/${commentId}/replies`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      }
    );
  }

  async closeComment(spaceId: string, commentId: number): Promise<Comment> {
    return this.request(`/api/spaces/${spaceId}/comments/${commentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_closed: true }),
    });
  }

  async deleteComment(spaceId: string, commentId: number): Promise<void> {
    await this.request(`/api/spaces/${spaceId}/comments/${commentId}`, {
      method: 'DELETE',
    });
  }

  // --- Share Links ---
  async createShareLink(
    spaceId: string,
    filePath: string,
    opts?: { expiresAt?: string; userIds?: string[]; groupIds?: string[] }
  ): Promise<ShareLink> {
    const body: Record<string, unknown> = { file_path: filePath };
    if (opts?.expiresAt) body.expires_at = opts.expiresAt;
    if (opts?.userIds?.length) body.user_ids = opts.userIds;
    if (opts?.groupIds?.length) body.group_ids = opts.groupIds;
    return this.request(`/api/spaces/${spaceId}/share-links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async listShareLinks(
    spaceId: string,
    filePath?: string
  ): Promise<ShareLink[]> {
    const q = filePath ? `?file_path=${encodeURIComponent(filePath)}` : '';
    return this.request(`/api/spaces/${spaceId}/share-links${q}`);
  }

  async updateShareLink(
    spaceId: string,
    linkId: string,
    opts: { expiresAt?: string; userIds?: string[]; groupIds?: string[] }
  ): Promise<ShareLink> {
    const body: Record<string, unknown> = {};
    if (opts.expiresAt !== undefined) body.expires_at = opts.expiresAt;
    if (opts.userIds) body.user_ids = opts.userIds;
    if (opts.groupIds) body.group_ids = opts.groupIds;
    return this.request(`/api/spaces/${spaceId}/share-links/${linkId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async deleteShareLink(spaceId: string, linkId: string): Promise<void> {
    await this.request(`/api/spaces/${spaceId}/share-links/${linkId}`, {
      method: 'DELETE',
    });
  }

  async getSharedFile(token: string): Promise<string> {
    return this.requestText(`/api/share/${token}`);
  }

  async getSharedFileInfo(token: string): Promise<ShareFileInfo> {
    return this.request(`/api/share/${token}/info`);
  }

  // --- Univer Sheet collaboration ---
  async getSheetSession(
    spaceId: string,
    path: string,
    signal?: AbortSignal
  ): Promise<SheetSession> {
    return this.request(
      `/api/spaces/${spaceId}/sheets/session?path=${encodeURIComponent(path)}`,
      { signal }
    );
  }

  async beginSheetOperation(input: {
    spaceId: string;
    path: string;
    requestId: string;
    clientVersion: string;
    startRevision?: number;
    signal?: AbortSignal;
  }): Promise<SheetOperation> {
    return this.request(`/api/spaces/${input.spaceId}/sheets/operations`, {
      method: 'POST',
      signal: input.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: input.path,
        request_id: input.requestId,
        operation: 'set',
        client_version: input.clientVersion,
        start_revision: input.startRevision,
      }),
    });
  }

  async finalizeSheetOperation(input: {
    spaceId: string;
    operationId: string;
    outcome: SheetOutcome;
    collaborationStatus: string;
    failureCode?: string;
    endRevision?: number;
    revisionVerified?: boolean;
    signal?: AbortSignal;
  }): Promise<SheetOperation> {
    return this.request(
      `/api/spaces/${input.spaceId}/sheets/operations/${encodeURIComponent(input.operationId)}`,
      {
        method: 'PATCH',
        signal: input.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome: input.outcome,
          collaboration_status: input.collaborationStatus,
          failure_code: input.failureCode ?? '',
          end_revision: input.endRevision,
          revision_verified: input.revisionVerified ?? false,
        }),
      }
    );
  }

  async getSheetOperation(
    spaceId: string,
    requestId: string,
    signal?: AbortSignal
  ): Promise<SheetOperation> {
    return this.request(
      `/api/spaces/${spaceId}/sheets/operations/by-request/${encodeURIComponent(requestId)}`,
      { signal }
    );
  }

  async inspectShareLink(token: string): Promise<ShareLinkInspection> {
    const headers: Record<string, string> = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await fetch(
      `${this.baseUrl}/api/share/${encodeURIComponent(token)}/info`,
      { headers }
    );
    if (res.status === 401) {
      return { link_status: 'valid', access_status: 'login_required' };
    }
    if (res.status === 403) {
      return { link_status: 'valid', access_status: 'forbidden' };
    }
    if (res.status === 404) {
      return { link_status: 'invalid', access_status: 'unknown' };
    }
    if (res.status === 410) {
      return { link_status: 'expired', access_status: 'unknown' };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${res.status} ${res.statusText}: ${body}`.trim());
    }
    const info: unknown = await res.json();
    if (!isShareFileInfo(info)) {
      throw new Error('Invalid share diagnostic response');
    }
    return {
      link_status: 'valid',
      access_status: 'accessible',
      info,
    };
  }

  // --- Diff ---
  async diffFile(
    spaceId: string,
    filePath: string,
    to: string,
    from?: string
  ): Promise<DiffResponse> {
    const params = new URLSearchParams({ to });
    if (from) params.set('from', from);
    return this.request(
      `/api/spaces/${spaceId}/diff/${encodeURIComponent(filePath)}?${params}`
    );
  }

  async diffSummary(
    spaceId: string,
    to: string,
    from?: string
  ): Promise<DiffSummary> {
    const params = new URLSearchParams({ to });
    if (from) params.set('from', from);
    return this.request(`/api/spaces/${spaceId}/diff?${params}`);
  }

  // --- File Ref ---
  async getFileRef(
    spaceId: string,
    path: string
  ): Promise<{
    id: string;
    space_id: string;
    slug: string;
    path: string;
    is_dir: boolean;
    url: string;
  }> {
    return this.request(
      `/api/spaces/${spaceId}/file-ref?path=${encodeURIComponent(path)}`
    );
  }

  // --- Resolve short URLs ---
  async resolveBySlug(slug: string): Promise<Space> {
    return this.request(`/api/spaces/by-slug/${encodeURIComponent(slug)}`);
  }

  async resolveFileRef(fileId: string): Promise<FileRef> {
    return this.request(`/api/file-refs/${encodeURIComponent(fileId)}`);
  }

  async diagnoseFileRef(
    fileId: string,
    slug?: string
  ): Promise<LinkDiagnostic> {
    const params = new URLSearchParams();
    if (slug) params.set('slug', slug);
    const suffix = params.size > 0 ? `?${params}` : '';
    return this.requestDiagnostic(
      `/api/file-refs/${encodeURIComponent(fileId)}/diagnostic${suffix}`
    );
  }

  async diagnosePath(input: {
    slug?: string;
    spaceId?: string;
    path?: string;
  }): Promise<LinkDiagnostic> {
    const params = new URLSearchParams();
    if (input.slug) params.set('slug', input.slug);
    if (input.spaceId) params.set('space_id', input.spaceId);
    if (input.path) params.set('path', input.path);
    return this.requestDiagnostic(`/api/link-diagnostics/path?${params}`);
  }

  private async requestDiagnostic(path: string): Promise<LinkDiagnostic> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (res.ok || res.status === 404) {
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        throw new Error(`Invalid diagnostic response (${res.status})`);
      }
      const diagnostic: unknown = await res.json();
      if (!isLinkDiagnostic(diagnostic)) {
        throw new Error('Invalid link diagnostic response');
      }
      return diagnostic;
    }
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}: ${body}`.trim());
  }
}

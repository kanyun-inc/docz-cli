/**
 * DocSync API Client
 *
 * DocSync 底层是 Git 仓库，每个 Space = 一个 Git repo。
 * 认证：Authorization: Bearer {token}（支持 JWT 和永久 API Token）。
 */

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

export interface LogEntry {
  hash: string;
  author: string;
  message: string;
  date: string;
  num_files: number;
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
  space_name: string;
  created_by_name: string;
  expires_at: string | null;
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
    const s = spaces.find(
      (s) =>
        s.id === nameOrId ||
        s.name === nameOrId ||
        s.name.toLowerCase() === nameOrId.toLowerCase()
    );
    if (!s) {
      const available = spaces.map((s) => s.name).join(', ');
      throw new Error(`Space "${nameOrId}" not found. Available: ${available}`);
    }
    return s;
  }

  // --- Tree ---
  async ls(spaceId: string, path = ''): Promise<TreeEntry[]> {
    return this.request(
      `/api/spaces/${spaceId}/tree?path=${encodeURIComponent(path)}`
    );
  }

  async treeFull(spaceId: string): Promise<TreeEntry[]> {
    return this.request(`/api/spaces/${spaceId}/tree/full`);
  }

  // --- Blob ---
  async cat(spaceId: string, filepath: string): Promise<string> {
    return this.request(
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
    await this.request(`/api/spaces/${spaceId}/files/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_path: from, new_path: to }),
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
    return this.request(path);
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
    content: string
  ): Promise<Comment> {
    return this.request(`/api/spaces/${spaceId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: filePath, content }),
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
    return this.request(`/api/share/${token}`);
  }

  async getSharedFileInfo(token: string): Promise<ShareFileInfo> {
    return this.request(`/api/share/${token}/info`);
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
}

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

  // --- Blob ---
  async cat(spaceId: string, filepath: string): Promise<string> {
    return this.request(
      `/api/spaces/${spaceId}/blob/${encodeURIComponent(filepath)}`
    );
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
}

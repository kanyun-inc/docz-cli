/**
 * DocSync MCP Server (stdio transport)
 *
 * Usage:
 *   docz mcp
 *
 * 环境变量：
 *   DOCSYNC_API_TOKEN — 必须
 *   DOCSYNC_BASE_URL  — 可选，默认 https://docz.zhenguanyu.com
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { DocSyncClient } from './client.js';
import { parseExpires } from './commands.js';
import { getBaseUrl, getToken } from './config.js';

function getClient(): DocSyncClient {
  const token = getToken();
  if (!token) {
    throw new Error(
      'DOCSYNC_API_TOKEN not set. Run `docz login --token <token>` or set the env var.'
    );
  }
  return new DocSyncClient(getBaseUrl(), token);
}

async function resolveSpaceId(
  client: DocSyncClient,
  nameOrId: string
): Promise<string> {
  const space = await client.resolveSpace(nameOrId);
  return space.id;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function fail(err: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: `Error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ],
    isError: true,
  };
}

export async function startMcpServer(): Promise<void> {
  const server = new Server(
    { name: 'docz-mcp', version: '0.4.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'docz_list_spaces',
        description: '列出所有可访问的 DocSync Space（个人空间和团队空间）',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'docz_list_files',
        description: '列出 DocSync Space 中指定目录的文件和文件夹',
        inputSchema: {
          type: 'object' as const,
          properties: {
            space: {
              type: 'string',
              description: 'Space 名称或 ID',
            },
            path: {
              type: 'string',
              description: '目录路径，空字符串表示根目录',
              default: '',
            },
          },
          required: ['space'],
        },
      },
      {
        name: 'docz_read_file',
        description: '读取 DocSync 文件内容（Markdown、CSV、HTML 等文本文件）',
        inputSchema: {
          type: 'object' as const,
          properties: {
            space: {
              type: 'string',
              description: 'Space 名称或 ID',
            },
            path: { type: 'string', description: '文件路径' },
          },
          required: ['space', 'path'],
        },
      },
      {
        name: 'docz_upload_file',
        description: '上传/创建文件到 DocSync Space',
        inputSchema: {
          type: 'object' as const,
          properties: {
            space: {
              type: 'string',
              description: 'Space 名称或 ID',
            },
            path: {
              type: 'string',
              description: '目标目录路径（如 reports）',
            },
            filename: {
              type: 'string',
              description: '文件名（如 summary.md）',
            },
            content: { type: 'string', description: '文件内容' },
          },
          required: ['space', 'filename', 'content'],
        },
      },
      {
        name: 'docz_mkdir',
        description: '在 DocSync Space 中创建文件夹',
        inputSchema: {
          type: 'object' as const,
          properties: {
            space: {
              type: 'string',
              description: 'Space 名称或 ID',
            },
            path: {
              type: 'string',
              description: '要创建的文件夹路径',
            },
          },
          required: ['space', 'path'],
        },
      },
      {
        name: 'docz_delete',
        description: '删除文件或文件夹（进入回收站，30 天内可恢复）',
        inputSchema: {
          type: 'object' as const,
          properties: {
            space: {
              type: 'string',
              description: 'Space 名称或 ID',
            },
            path: { type: 'string', description: '要删除的路径' },
          },
          required: ['space', 'path'],
        },
      },
      {
        name: 'docz_file_history',
        description: '查看文件的变更历史（基于 Git 版本控制）',
        inputSchema: {
          type: 'object' as const,
          properties: {
            space: {
              type: 'string',
              description: 'Space 名称或 ID',
            },
            path: { type: 'string', description: '文件路径' },
          },
          required: ['space'],
        },
      },
      {
        name: 'docz_share_create',
        description: '创建文件分享链接',
        inputSchema: {
          type: 'object' as const,
          properties: {
            space: { type: 'string', description: 'Space 名称或 ID' },
            path: { type: 'string', description: '文件路径' },
            expires: { type: 'string', description: '过期时间，如 7d, 24h' },
            userIds: { type: 'array', items: { type: 'string' }, description: '可见用户 ID 列表' },
            groupIds: { type: 'array', items: { type: 'string' }, description: '可见组 ID 列表' },
          },
          required: ['space', 'path'],
        },
      },
      {
        name: 'docz_share_list',
        description: '列出空间的分享链接',
        inputSchema: {
          type: 'object' as const,
          properties: {
            space: { type: 'string', description: 'Space 名称或 ID' },
            filePath: { type: 'string', description: '按文件路径过滤' },
          },
          required: ['space'],
        },
      },
      {
        name: 'docz_share_read',
        description: '通过分享 token 读取文件内容',
        inputSchema: {
          type: 'object' as const,
          properties: {
            token: { type: 'string', description: '分享链接 token' },
          },
          required: ['token'],
        },
      },
      {
        name: 'docz_share_info',
        description: '查看分享链接信息',
        inputSchema: {
          type: 'object' as const,
          properties: {
            token: { type: 'string', description: '分享链接 token' },
          },
          required: ['token'],
        },
      },
      {
        name: 'docz_share_delete',
        description: '删除分享链接',
        inputSchema: {
          type: 'object' as const,
          properties: {
            space: { type: 'string', description: 'Space 名称或 ID' },
            linkId: { type: 'string', description: '分享链接 ID' },
          },
          required: ['space', 'linkId'],
        },
      },
      {
        name: 'docz_diff',
        description: '查看文件或 Space 的变更 diff',
        inputSchema: {
          type: 'object' as const,
          properties: {
            space: { type: 'string', description: 'Space 名称或 ID' },
            path: { type: 'string', description: '文件路径（空则返回变更文件列表）' },
            to: { type: 'string', description: '目标 commit hash' },
            from: { type: 'string', description: '起始 commit hash（默认 to^）' },
          },
          required: ['space', 'to'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    try {
      const client = getClient();

      switch (request.params.name) {
        case 'docz_list_spaces': {
          const spaces = await client.listSpaces();
          const lines = spaces.map(
            (s) =>
              `${s.name} (${s.is_private ? '私有' : '团队'}, ${s.member_count} 人) id=${s.id}`
          );
          return ok(lines.join('\n'));
        }

        case 'docz_list_files': {
          const sid = await resolveSpaceId(client, String(args.space));
          const entries = await client.ls(sid, String(args.path ?? ''));
          if (entries.length === 0) return ok('（空目录）');
          const lines = entries.map((e) => {
            const icon = e.type === 'tree' ? '📁' : '📄';
            const size = e.type === 'blob' ? ` (${formatSize(e.size)})` : '';
            return `${icon} ${e.name}${size}`;
          });
          return ok(lines.join('\n'));
        }

        case 'docz_read_file': {
          const sid = await resolveSpaceId(client, String(args.space));
          const content = await client.cat(sid, String(args.path));
          return ok(content);
        }

        case 'docz_upload_file': {
          const sid = await resolveSpaceId(client, String(args.space));
          const result = await client.upload(
            sid,
            String(args.path ?? ''),
            String(args.filename),
            String(args.content)
          );
          return ok(`已上传: ${result.path}`);
        }

        case 'docz_mkdir': {
          const sid = await resolveSpaceId(client, String(args.space));
          await client.mkdir(sid, String(args.path));
          return ok(`已创建: ${args.path}`);
        }

        case 'docz_delete': {
          const sid = await resolveSpaceId(client, String(args.space));
          await client.rm(sid, String(args.path));
          return ok(`已删除: ${args.path}（30 天内可从回收站恢复）`);
        }

        case 'docz_file_history': {
          const sid = await resolveSpaceId(client, String(args.space));
          const logs = await client.log(
            sid,
            args.path ? String(args.path) : undefined
          );
          if (logs.length === 0) return ok('没有变更历史。');
          const lines = logs.map(
            (l) => `${l.hash}  ${l.date}  ${l.message}`
          );
          return ok(lines.join('\n'));
        }

        case 'docz_share_create': {
          const sharePath = String(args.path ?? '');
          if (!sharePath) return fail('path is required');
          const sid = await resolveSpaceId(client, String(args.space));
          const opts: { expiresAt?: string; userIds?: string[]; groupIds?: string[] } = {};
          if (args.expires) opts.expiresAt = parseExpires(String(args.expires));
          if (args.userIds) opts.userIds = args.userIds as string[];
          if (args.groupIds) opts.groupIds = args.groupIds as string[];
          const link = await client.createShareLink(sid, sharePath, opts);
          return ok(`已创建分享链接:\ntoken: ${link.token}\nurl: ${getBaseUrl()}/share/${link.token}\n过期: ${link.expires_at ?? '永不'}`);
        }

        case 'docz_share_list': {
          const sid = await resolveSpaceId(client, String(args.space));
          const links = await client.listShareLinks(sid, args.filePath ? String(args.filePath) : undefined);
          if (links.length === 0) return ok('没有分享链接。');
          const lines = links.map(
            (l) => `${l.token}  ${l.file_path}  过期: ${l.expires_at ?? '永不'}  创建者: ${l.created_by_name ?? l.created_by_email ?? l.created_by}`
          );
          return ok(lines.join('\n'));
        }

        case 'docz_share_read': {
          const content = await client.getSharedFile(String(args.token));
          return ok(content);
        }

        case 'docz_share_info': {
          const info = await client.getSharedFileInfo(String(args.token));
          return ok(`文件: ${info.file_path}\nSpace: ${info.space_name}\n分享者: ${info.created_by_name}\n过期: ${info.expires_at ?? '永不'}`);
        }

        case 'docz_share_delete': {
          const sid = await resolveSpaceId(client, String(args.space));
          await client.deleteShareLink(sid, String(args.linkId));
          return ok(`已删除分享链接: ${args.linkId}`);
        }

        case 'docz_diff': {
          const sid = await resolveSpaceId(client, String(args.space));
          const path = args.path ? String(args.path) : '';
          const from = args.from ? String(args.from) : undefined;
          if (path) {
            const result = await client.diffFile(sid, path, String(args.to), from);
            return ok(result.diff || '没有变更。');
          }
          const result = await client.diffSummary(sid, String(args.to), from);
          if (result.files.length === 0) return ok('没有变更。');
          const lines = result.files.map((f) => `${f.status}  ${f.path}`);
          return ok(lines.join('\n'));
        }

        default:
          return fail(`Unknown tool: ${request.params.name}`);
      }
    } catch (err) {
      return fail(err);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

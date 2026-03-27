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
    { name: 'docsync', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'docsync_list_spaces',
        description: '列出所有可访问的 DocSync Space（个人空间和团队空间）',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'docsync_list_files',
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
        name: 'docsync_read_file',
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
        name: 'docsync_upload_file',
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
        name: 'docsync_mkdir',
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
        name: 'docsync_delete',
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
        name: 'docsync_file_history',
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
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    try {
      const client = getClient();

      switch (request.params.name) {
        case 'docsync_list_spaces': {
          const spaces = await client.listSpaces();
          const lines = spaces.map(
            (s) =>
              `${s.name} (${s.is_private ? '私有' : '团队'}, ${s.member_count} 人) id=${s.id}`
          );
          return ok(lines.join('\n'));
        }

        case 'docsync_list_files': {
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

        case 'docsync_read_file': {
          const sid = await resolveSpaceId(client, String(args.space));
          const content = await client.cat(sid, String(args.path));
          return ok(content);
        }

        case 'docsync_upload_file': {
          const sid = await resolveSpaceId(client, String(args.space));
          const result = await client.upload(
            sid,
            String(args.path ?? ''),
            String(args.filename),
            String(args.content)
          );
          return ok(`已上传: ${result.path}`);
        }

        case 'docsync_mkdir': {
          const sid = await resolveSpaceId(client, String(args.space));
          await client.mkdir(sid, String(args.path));
          return ok(`已创建: ${args.path}`);
        }

        case 'docsync_delete': {
          const sid = await resolveSpaceId(client, String(args.space));
          await client.rm(sid, String(args.path));
          return ok(`已删除: ${args.path}（30 天内可从回收站恢复）`);
        }

        case 'docsync_file_history': {
          const sid = await resolveSpaceId(client, String(args.space));
          const logs = await client.log(
            sid,
            args.path ? String(args.path) : undefined
          );
          if (logs.length === 0) return ok('没有变更历史。');
          const lines = logs.map(
            (l) => `${l.hash.substring(0, 7)}  ${l.date}  ${l.message}`
          );
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

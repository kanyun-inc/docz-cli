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
import { ConflictError, DocSyncClient, stripMarkdownToText } from './client.js';
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
    { name: 'docz-mcp', version: '0.5.0' },
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
            recursive: {
              type: 'boolean',
              description: '是否递归列出所有子目录',
              default: false,
            },
          },
          required: ['space'],
        },
      },
      {
        name: 'docz_read_file',
        description:
          '读取 DocSync 文件内容（Markdown、CSV、HTML 等文本文件）。返回格式：第一行 [ref: <commit_hash>]，空行后是文件内容。保存时请将 ref 值作为 base_ref 传入 docz_save_file 以检测冲突',
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
        name: 'docz_save_file',
        description:
          '保存/编辑文档内容（支持冲突检测）。建议先用 docz_read_file 获取 ref，再传入 base_ref 以检测并发冲突。如果返回冲突错误，请重新用 docz_read_file 获取最新内容，重新修改后再保存',
        inputSchema: {
          type: 'object' as const,
          properties: {
            space: {
              type: 'string',
              description: 'Space 名称或 ID',
            },
            path: { type: 'string', description: '文件路径' },
            content: { type: 'string', description: '文件内容' },
            base_ref: {
              type: 'string',
              description: '读取时获得的 ref，用于冲突检测（可选）',
            },
            message: {
              type: 'string',
              description: '提交消息（可选）',
            },
          },
          required: ['space', 'path', 'content'],
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
        name: 'docz_rollback',
        description: '将文件回滚到指定的历史版本（通过 commit hash）',
        inputSchema: {
          type: 'object' as const,
          properties: {
            space: {
              type: 'string',
              description: 'Space 名称或 ID',
            },
            path: { type: 'string', description: '文件路径' },
            commit: {
              type: 'string',
              description: '目标 commit hash（通过 docz_file_history 获取）',
            },
          },
          required: ['space', 'path', 'commit'],
        },
      },
      {
        name: 'docz_trash',
        description: '查看回收站中的已删除文件列表',
        inputSchema: {
          type: 'object' as const,
          properties: {
            space: {
              type: 'string',
              description: 'Space 名称或 ID',
            },
          },
          required: ['space'],
        },
      },
      {
        name: 'docz_restore',
        description: '从回收站恢复已删除的文件',
        inputSchema: {
          type: 'object' as const,
          properties: {
            space: {
              type: 'string',
              description: 'Space 名称或 ID',
            },
            path: {
              type: 'string',
              description: '被删除的文件路径',
            },
            commit: {
              type: 'string',
              description: '删除时的 commit hash（通过 docz_trash 获取）',
            },
          },
          required: ['space', 'path', 'commit'],
        },
      },
      {
        name: 'docz_list_comments',
        description: '列出文件的评论和回复',
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
        name: 'docz_add_comment',
        description:
          '在文件上添加评论。支持 @email 格式提及其他用户。可通过 quote 引用文件中的原文（划线评论），引用内容会在 Web UI 高亮显示',
        inputSchema: {
          type: 'object' as const,
          properties: {
            space: {
              type: 'string',
              description: 'Space 名称或 ID',
            },
            path: { type: 'string', description: '文件路径' },
            content: {
              type: 'string',
              description: '评论内容',
            },
            quote: {
              type: 'string',
              description:
                '引用的原文内容（划线评论）。从文件中复制要评论的文字片段',
            },
            quote_nth: {
              type: 'number',
              description:
                '匹配第几次出现的引用文字（默认 1，即第一次出现）',
            },
          },
          required: ['space', 'path', 'content'],
        },
      },
      {
        name: 'docz_reply_comment',
        description: '回复指定评论',
        inputSchema: {
          type: 'object' as const,
          properties: {
            space: {
              type: 'string',
              description: 'Space 名称或 ID',
            },
            comment_id: {
              type: 'number',
              description: '评论 ID',
            },
            content: {
              type: 'string',
              description: '回复内容',
            },
          },
          required: ['space', 'comment_id', 'content'],
        },
      },
      {
        name: 'docz_close_comment',
        description: '关闭评论（标记为已解决）',
        inputSchema: {
          type: 'object' as const,
          properties: {
            space: {
              type: 'string',
              description: 'Space 名称或 ID',
            },
            comment_id: {
              type: 'number',
              description: '评论 ID',
            },
          },
          required: ['space', 'comment_id'],
        },
      },
      {
        name: 'docz_share_create',
        description: '创建文件分享链接',
        inputSchema: {
          type: 'object' as const,
          properties: {
            space: {
              type: 'string',
              description: 'Space 名称或 ID',
            },
            path: { type: 'string', description: '文件路径' },
            expires: {
              type: 'string',
              description: '过期时间，如 7d, 24h',
            },
            userIds: {
              type: 'array',
              items: { type: 'string' },
              description: '可见用户 ID 列表',
            },
            groupIds: {
              type: 'array',
              items: { type: 'string' },
              description: '可见组 ID 列表',
            },
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
            space: {
              type: 'string',
              description: 'Space 名称或 ID',
            },
            filePath: {
              type: 'string',
              description: '按文件路径过滤',
            },
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
            token: {
              type: 'string',
              description: '分享链接 token',
            },
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
            token: {
              type: 'string',
              description: '分享链接 token',
            },
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
            space: {
              type: 'string',
              description: 'Space 名称或 ID',
            },
            linkId: {
              type: 'string',
              description: '分享链接 ID',
            },
          },
          required: ['space', 'linkId'],
        },
      },
      {
        name: 'docz_shortlink',
        description: '获取文件的短链接 URL，可直接在浏览器打开',
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
        name: 'docz_diff',
        description: '查看文件或 Space 的变更 diff',
        inputSchema: {
          type: 'object' as const,
          properties: {
            space: {
              type: 'string',
              description: 'Space 名称或 ID',
            },
            path: {
              type: 'string',
              description: '文件路径（空则返回变更文件列表）',
            },
            to: {
              type: 'string',
              description: '目标 commit hash',
            },
            from: {
              type: 'string',
              description: '起始 commit hash（默认 to^）',
            },
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
          const entries = args.recursive
            ? await client.treeFull(sid)
            : await client.ls(sid, String(args.path ?? ''));
          if (entries.length === 0) return ok('（空目录）');
          const lines = entries.map((e) => {
            const size = e.type === 'blob' ? ` (${formatSize(e.size)})` : '';
            return `${e.type === 'tree' ? '📁' : '📄'} ${e.name}${size}`;
          });
          return ok(lines.join('\n'));
        }

        case 'docz_read_file': {
          const sid = await resolveSpaceId(client, String(args.space));
          const result = await client.catWithRef(sid, String(args.path));
          const header = result.ref ? `[ref: ${result.ref}]\n\n` : '';
          return ok(header + result.content);
        }

        case 'docz_save_file': {
          const sid = await resolveSpaceId(client, String(args.space));
          const savePath = String(args.path);
          const saveContent = String(args.content);
          const saveMessage = args.message ? String(args.message) : undefined;
          const baseRef = args.base_ref ? String(args.base_ref) : undefined;

          if (Buffer.byteLength(saveContent, 'utf-8') > 2 * 1024 * 1024) {
            return fail('内容超过 2MB 限制，请使用 docz_upload_file 上传');
          }

          try {
            const result = await client.save(sid, savePath, saveContent, {
              baseRef,
              message: saveMessage,
            });
            return ok(`已保存: ${result.path} (ref: ${result.ref})`);
          } catch (err) {
            if (err instanceof ConflictError) {
              return fail(
                `冲突：文件已被他人修改（当前 ref: ${err.detail.current_ref}）。请先用 docz_read_file 获取最新内容，重新修改后再保存。`
              );
            }
            throw err;
          }
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
          const lines = logs.map((l) => `${l.hash}  ${l.date}  ${l.message}`);
          return ok(lines.join('\n'));
        }

        case 'docz_rollback': {
          const sid = await resolveSpaceId(client, String(args.space));
          await client.rollback(sid, String(args.path), String(args.commit));
          return ok(
            `已回滚: ${args.path} → ${String(args.commit).substring(0, 7)}`
          );
        }

        case 'docz_trash': {
          const sid = await resolveSpaceId(client, String(args.space));
          const items = await client.trash(sid);
          if (items.length === 0) return ok('回收站为空。');
          const lines = items.map(
            (t) =>
              `${t.path}  删除于 ${t.deleted_at}  commit: ${t.commit.substring(0, 7)}`
          );
          return ok(lines.join('\n'));
        }

        case 'docz_restore': {
          const sid = await resolveSpaceId(client, String(args.space));
          await client.restore(sid, String(args.path), String(args.commit));
          return ok(`已恢复: ${args.path}`);
        }

        case 'docz_list_comments': {
          const sid = await resolveSpaceId(client, String(args.space));
          const comments = await client.listComments(sid, String(args.path));
          if (comments.length === 0) return ok('没有评论。');
          const lines = comments.map((c) => {
            const status = c.is_closed ? ' [已关闭]' : '';
            const quote = c.target_content
              ? `\n  > ${c.target_content}`
              : '';
            let text = `#${c.id} ${c.user_name}${status}:${quote}\n  ${c.content}`;
            for (const r of c.replies) {
              text += `\n  ↳ ${r.user_name}: ${r.content}`;
            }
            return text;
          });
          return ok(lines.join('\n\n'));
        }

        case 'docz_add_comment': {
          const sid = await resolveSpaceId(client, String(args.space));
          const commentPath = String(args.path);
          const quote = args.quote ? String(args.quote) : undefined;
          const quoteNth = args.quote_nth != null ? Number(args.quote_nth) : undefined;
          let targetSelector: string | undefined;
          if (quote) {
            const fileContent = await client.cat(sid, commentPath);
            const isMarkdown = /\.(?:md|markdown|mdx)$/i.test(commentPath);
            const searchContent = isMarkdown ? stripMarkdownToText(fileContent) : fileContent;
            targetSelector = client.buildTargetSelector(searchContent, quote, quoteNth);
          }
          const c = await client.createComment(
            sid,
            commentPath,
            String(args.content),
            { quote, targetSelector }
          );
          return ok(`评论 #${c.id} 已创建`);
        }

        case 'docz_reply_comment': {
          const sid = await resolveSpaceId(client, String(args.space));
          const r = await client.replyComment(
            sid,
            Number(args.comment_id),
            String(args.content)
          );
          return ok(`回复 #${r.id} 已创建`);
        }

        case 'docz_close_comment': {
          const sid = await resolveSpaceId(client, String(args.space));
          await client.closeComment(sid, Number(args.comment_id));
          return ok(`评论 #${args.comment_id} 已关闭`);
        }

        case 'docz_share_create': {
          const sharePath = String(args.path ?? '');
          if (!sharePath) return fail('path is required');
          const sid = await resolveSpaceId(client, String(args.space));
          const opts: {
            expiresAt?: string;
            userIds?: string[];
            groupIds?: string[];
          } = {};
          if (args.expires) opts.expiresAt = parseExpires(String(args.expires));
          if (args.userIds) opts.userIds = args.userIds as string[];
          if (args.groupIds) opts.groupIds = args.groupIds as string[];
          const link = await client.createShareLink(sid, sharePath, opts);
          return ok(
            `已创建分享链接:\ntoken: ${link.token}\nurl: ${getBaseUrl()}/share/${link.token}\n过期: ${link.expires_at ?? '永不'}`
          );
        }

        case 'docz_share_list': {
          const sid = await resolveSpaceId(client, String(args.space));
          const links = await client.listShareLinks(
            sid,
            args.filePath ? String(args.filePath) : undefined
          );
          if (links.length === 0) return ok('没有分享链接。');
          const lines = links.map(
            (l) =>
              `${l.token}  ${l.file_path}  过期: ${l.expires_at ?? '永不'}  创建者: ${l.created_by_name ?? l.created_by_email ?? l.created_by}`
          );
          return ok(lines.join('\n'));
        }

        case 'docz_share_read': {
          const content = await client.getSharedFile(String(args.token));
          return ok(content);
        }

        case 'docz_share_info': {
          const info = await client.getSharedFileInfo(String(args.token));
          return ok(
            `文件: ${info.file_path}\nSpace: ${info.space_name}\n分享者: ${info.created_by_name}\n过期: ${info.expires_at ?? '永不'}`
          );
        }

        case 'docz_share_delete': {
          const sid = await resolveSpaceId(client, String(args.space));
          await client.deleteShareLink(sid, String(args.linkId));
          return ok(`已删除分享链接: ${args.linkId}`);
        }

        case 'docz_shortlink': {
          const sid = await resolveSpaceId(client, String(args.space));
          const ref = await client.getFileRef(sid, String(args.path));
          return ok(ref.url);
        }

        case 'docz_diff': {
          const sid = await resolveSpaceId(client, String(args.space));
          const path = args.path ? String(args.path) : '';
          const from = args.from ? String(args.from) : undefined;
          if (path) {
            const result = await client.diffFile(
              sid,
              path,
              String(args.to),
              from
            );
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

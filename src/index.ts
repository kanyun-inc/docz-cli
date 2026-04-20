import { Command } from 'commander';
import { registerCommands } from './commands.js';

declare const __VERSION__: string;

const program = new Command();

program
  .name('docz')
  .description('DocSync CLI — read and write company documents')
  .version(__VERSION__);

registerCommands(program);

program
  .command('mcp')
  .description('Start MCP stdio server for AI agent integration')
  .action(async () => {
    const { startMcpServer } = await import('./mcp.js');
    await startMcpServer();
  });

program.parse();

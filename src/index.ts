import { Command, CommanderError } from 'commander';
import { registerCommands } from './commands.js';
import {
  hasMissingSheetOptionValue,
  isSheetJSONInvocation,
  sheetArgumentFailure,
} from './sheet/cli.js';

declare const __VERSION__: string;

const argv = process.argv.slice(2);
const sheetJSONInvocation = isSheetJSONInvocation(argv);

function printSheetArgumentFailure(): void {
  console.log(JSON.stringify(sheetArgumentFailure()));
  process.exitCode = 1;
}

function overrideCommandErrors(command: Command): void {
  command.configureOutput({ writeErr: () => undefined });
  command.exitOverride();
  for (const child of command.commands) overrideCommandErrors(child);
}

if (sheetJSONInvocation && hasMissingSheetOptionValue(argv)) {
  printSheetArgumentFailure();
} else {
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

  if (sheetJSONInvocation) {
    overrideCommandErrors(program);
  }

  try {
    await program.parseAsync();
  } catch (error) {
    if (
      sheetJSONInvocation &&
      error instanceof CommanderError &&
      error.code !== 'commander.helpDisplayed' &&
      error.code !== 'commander.version'
    ) {
      printSheetArgumentFailure();
    } else if (!(error instanceof CommanderError)) {
      throw error;
    }
  }
}

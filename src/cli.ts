import { Command, CommanderError } from 'commander';
import { registerCommands } from './commands.js';
import {
  hasMissingSheetOptionValue,
  isSheetJSONInvocation,
  sheetArgumentFailure,
} from './sheet/cli.js';

function printSheetArgumentFailure(): void {
  console.log(JSON.stringify(sheetArgumentFailure()));
  process.exitCode = 1;
}

function overrideCommandErrors(
  command: Command,
  suppressErrors: boolean
): void {
  if (suppressErrors) {
    command.configureOutput({ writeErr: () => undefined });
  }
  command.exitOverride();
  for (const child of command.commands) {
    overrideCommandErrors(child, suppressErrors);
  }
}

/** Run the complete CLI command tree against explicit user arguments. */
export async function runCLI(argv: string[], version: string): Promise<void> {
  const sheetJSONInvocation = isSheetJSONInvocation(argv);
  if (sheetJSONInvocation && hasMissingSheetOptionValue(argv)) {
    printSheetArgumentFailure();
    return;
  }

  const program = new Command();
  program
    .name('docz')
    .description('DocSync CLI — read and write company documents')
    .version(version);

  registerCommands(program);

  program
    .command('mcp')
    .description('Start MCP stdio server for AI agent integration')
    .action(async () => {
      const { startMcpServer } = await import('./mcp.js');
      await startMcpServer();
    });

  // Override exits for the complete tree so tests and the async entrypoint can
  // observe completion. Error text is suppressed only for Sheet JSON mode.
  overrideCommandErrors(program, sheetJSONInvocation);

  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    if (
      error.code === 'commander.helpDisplayed' ||
      error.code === 'commander.version'
    ) {
      return;
    }
    if (sheetJSONInvocation) {
      printSheetArgumentFailure();
      return;
    }
    // Commander has already written its normal human-readable error. Preserve
    // its exit status without terminating before async cleanup can complete.
    process.exitCode = error.exitCode;
  }
}

import { Command } from 'commander';
import { registerCommands } from './commands.js';

const program = new Command();

program
  .name('docz')
  .description('DocSync CLI — read and write company documents')
  .version('0.1.0');

registerCommands(program);

program.parse();

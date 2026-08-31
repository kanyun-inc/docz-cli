import { runCLI } from './cli.js';

declare const __VERSION__: string;

await runCLI(process.argv.slice(2), __VERSION__);

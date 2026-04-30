/**
 * 配置管理
 *
 * 优先级：环境变量 > ~/.docz/config.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CONFIG_DIR = join(homedir(), '.docz');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

interface Config {
  base_url?: string;
  token?: string;
}

function readConfig(): Config {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeConfig(config: Config): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`);
}

export function getBaseUrl(): string {
  return (
    process.env.DOCSYNC_BASE_URL ??
    readConfig().base_url ??
    'https://docz.zhenguanyu.com'
  );
}

export function getToken(): string | undefined {
  return process.env.DOCSYNC_API_TOKEN ?? readConfig().token;
}

export function saveConfig(baseUrl: string, token: string): void {
  writeConfig({ base_url: baseUrl, token });
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Load the workspace-root `.env` (written by `bash-scripts/set_global_env.sh`) into
 * `process.env`. Shell-provided values win — `.env` only fills gaps, so
 * `CLI_CEB_DEV=true pnpm --filter extension dev` style overrides keep working.
 *
 * The reference implementation used @dotenvx/dotenvx with a fragile 5-level relative path from
 * its own dist/; here we search upward from cwd for the directory that holds
 * `pnpm-workspace.yaml`, which is stable no matter which package the build runs in.
 */
const findWorkspaceRoot = (): string | null => {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
};

export const loadEnvFile = (): Record<string, string> => {
  const root = findWorkspaceRoot();
  if (!root) return {};
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return {};

  const parsed: Record<string, string> = {};
  for (const rawLine of readFileSync(envPath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    parsed[key] = value;
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return parsed;
};

export const baseEnv = loadEnvFile();

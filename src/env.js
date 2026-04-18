import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_ENV_FILES = ['.env', '.env.local'];

export function loadEnvFiles({
  cwd = process.cwd(),
  files = DEFAULT_ENV_FILES,
  override = false
} = {}) {
  for (const file of files) {
    const absolutePath = path.resolve(cwd, file);
    if (!fs.existsSync(absolutePath)) {
      continue;
    }

    const contents = fs.readFileSync(absolutePath, 'utf8');
    applyEnvContents(contents, { override });
  }
}

export function applyEnvContents(contents, { override = false } = {}) {
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!key) {
      continue;
    }

    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    value = value.replace(/\\n/g, '\n');

    if (!override && Object.hasOwn(process.env, key)) {
      continue;
    }

    process.env[key] = value;
  }
}

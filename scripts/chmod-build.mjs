import { chmodSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** Replaces shx's only use without its vulnerable shelljs dependency tree. */
if (process.platform !== 'win32') {
  const directory = fileURLToPath(new URL('../build/', import.meta.url));
  for (const filename of readdirSync(directory)) {
    if (filename.endsWith('.js')) chmodSync(join(directory, filename), 0o755);
  }
}

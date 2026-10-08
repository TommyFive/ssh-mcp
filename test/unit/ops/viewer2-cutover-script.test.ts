import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression for the interrupted macOS cutover: the source file had literally
 * stored "[REDACTED:entropy:52]" as its BACKUP directory. Our tests must
 * reject redaction placeholders before a script is copied into production.
 */
describe('macOS cutover script source integrity', () => {
  const script = readFileSync(resolve(process.cwd(), 'scripts/viewer2-cutover-mac-mini.sh'), 'utf8');

  it('never ships output-redaction markers as filesystem paths', () => {
    expect(script).not.toMatch(/\[REDACTED:[^\]]+\]/);
    expect(script).not.toContain('[REDACTED');
  });

  it('assembles a real, known backup path from safe components', () => {
    expect(script).toContain('BACKUP_ROOT="$HOME/.local/share/ssh-mcp-backups"');
    expect(script).toContain('BACKUP="$BACKUP_ROOT/viewer2-20261008T050638Z"');
    expect(script).toContain('if [ ! -d "$BACKUP" ]; then');
    expect(script).toContain('STATE="$BACKUP/viewer2-active-rollback-path"');
  });

  it('preserves its independent-terminal gate and reversible cutover', () => {
    expect(script).toContain('if [ ! -t 0 ]; then');
    expect(script).toContain('INDEPENDENT-ACTIVATE');
    expect(script).toContain('RESTORE-ORIGINAL');
    expect(script).toContain('trap rescue EXIT');
    expect(script).toContain('mv "$ACTIVE" "$PREVIOUS"');
    expect(script).toContain('mv "$NEXT" "$ACTIVE"');
    expect(script).toContain('mv "$PREVIOUS" "$ACTIVE"');
  });
});

import { isViewer2ReadOnly, type Viewer2Pack } from './viewer2.js';

export interface Viewer2BatchItem {
  index: number;
  /** Canonical command string, only populated for an authorized read. */
  command: string | null;
  authorized: boolean;
  reason: 'viewer2-readonly' | 'not-proven-readonly';
}

/**
 * Planning only. No SSH connection, exec, privilege escalation, nor audit.
 * A future MCP tool MUST submit each allowed command independently to the
 * central runAudited() pipeline. Never concatenate commands with semicolons.
 */
export function planViewer2Batch(
  commands: readonly (readonly string[])[],
  packs: readonly Viewer2Pack[],
): readonly Viewer2BatchItem[] {
  if (!Array.isArray(commands) || commands.length < 1 || commands.length > 16) {
    throw new RangeError('1..16 commands required');
  }
  return commands.map((argv, index) => {
    if (!Array.isArray(argv) || argv.length < 1 || argv.length > 24
      || argv.some(arg => typeof arg !== 'string' || !arg.length || arg.length > 1024
        || /\s/.test(arg))) {
      return { index, command: null, authorized: false, reason: 'not-proven-readonly' };
    }
    const command = argv.join(' ');
    const authorized = isViewer2ReadOnly(command, packs);
    return {
      index,
      command: authorized ? command : null,
      authorized,
      reason: authorized ? 'viewer2-readonly' : 'not-proven-readonly',
    };
  });
}

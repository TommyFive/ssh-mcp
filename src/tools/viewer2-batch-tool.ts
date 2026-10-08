import { z } from 'zod';
import type { ToolDeps, Pipeline } from './pipeline.js';
import { textResult } from './results.js';
import { TOOL_DESCRIPTIONS as D } from './descriptions.js';

/**
 * One audited SSH execution per command. No shell glue, pipes, redirection,
 * elevation, session reuse, or fail-open policy. This tool intentionally
 * uses the CURRENT production classifier; Viewer2 experimental matching does
 * not silently gain authorization.
 */
export function registerReadCommandsBatch(
  { server }: ToolDeps,
  { runAudited, execAndReport, auditFailure, makeCtx }: Pipeline,
) {
  server.tool(
    'read-commands-batch',
    D['read-commands-batch'],
    {
      commands: z.array(
        z.array(z.string().min(1).max(256)).min(1).max(24),
      ).min(1).max(16).describe('Each entry is one command as literal argv words. No shell syntax.'),
      profile: z.string().optional().describe('Existing SSH viewer profile'),
    },
    { readOnlyHint: true },
    async ({ commands, profile }, extra) => {
      const output: string[] = [];
      let isError = false;
      for (const [index, argv] of commands.entries()) {
        // A conservative wire representation: each word must need no quoting.
        // In particular, shell meta chars, whitespace, globs and expansions
        // cannot be smuggled across the argv -> shell-string boundary.
        const valid = argv.every(word => /^[A-Za-z0-9_.:@%/+,-]+$/.test(word));
        if (!valid) {
          await auditFailure(
            makeCtx(extra, profile), profile ?? '(default)',
            { command: argv.join(' ').slice(0, 5000) }, 'read-only',
            new Error('Batch argv contains unsupported shell syntax'),
          );
          isError = true;
          output.push('[' + (index + 1) + '] Refused: requires shell syntax or quoting');
          continue;
        }
        const command = argv.join(' ');
        const result = await runAudited(
          command,
          { toolName: 'read-commands-batch', failureClass: 'read-only',
            enforceClass: 'read-only', profile, extra },
          execAndReport(),
        );
        if (result.isError) isError = true;
        const lines = result.content
          .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
          .map(block => block.text);
        // Cap the aggregate MCP response: each remote command already has its
        // own output quota, but 16 responses combined could exceed that quota.
        const remaining = Math.max(0, 262144 - output.join('\n\n').length);
        const payload = lines.join('\n');
        output.push('[' + (index + 1) + '] ' + command + '\n'
          + payload.slice(0, Math.min(remaining, 32768))
          + (payload.length > Math.min(remaining, 32768) ? '\n[output truncated]' : ''));
      }
      return { ...textResult(output.join('\n\n')), isError };
    },
  );
}

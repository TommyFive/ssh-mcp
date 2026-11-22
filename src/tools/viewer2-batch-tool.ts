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
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
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
        // The central pipeline throws on policy and input rejection. A batch
        // must not accidentally abort after the first denied entry; nor should
        // any handler bypass the pipeline or its individual audit record.
        try {
          const result = await runAudited(
            command,
            { toolName: 'read-commands-batch', failureClass: 'read-only',
              enforceClass: 'read-only', profile, extra },
            execAndReport(),
          );
          if (result.isError) isError = true;
          const lines = result.content
            .filter((entry): entry is Extract<typeof entry, { type: 'text' }> => entry.type === 'text')
            .map(entry => entry.text);
          const remaining = Math.max(0, 262144 - output.join('\n\n').length);
          const payload = lines.join('\n');
          const limit = Math.min(remaining, 32768);
          output.push('[' + (index + 1) + '] ' + command + '\n'
            + payload.slice(0, limit)
            + (payload.length > limit ? '\n[output truncated]' : ''));
        } catch (error) {
          isError = true;
          // runAudited already audited the failed item; do not audit twice.
          const reason = error instanceof Error ? error.message : String(error);
          output.push('[' + (index + 1) + '] Refused: ' + reason.slice(0, 500));
        }
      }
      return { ...textResult(output.join('\n\n')), isError };
    },
  );
}

import type { V2Response } from '../generated/types.gen.ts';
import { displayNotifications } from './notifications.ts';
import { displayError } from './errors.ts';
import { tryCustomFormatter } from './formatters.ts';

export interface DisplayOptions {
  json?: boolean;
}

/**
 * Display a V2 API response to the user.
 *
 * Default mode:
 * 1. Show notifications first (human-readable)
 * 2. If error, show error + help hint
 * 3. Try custom formatter on structuredContent (concise text)
 * 4. If result is a string, print it (server-rendered text)
 * 5. Fallback: pretty-print structuredContent or result as JSON
 *
 * --json mode:
 * Output the full response envelope as a single JSON object on stdout.
 * Notifications and errors are included in the JSON, not printed separately.
 */
export function displayResponse(command: string, response: V2Response, opts?: DisplayOptions): void {
  // --json: output full response as a single JSON object
  if (opts?.json) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  // 1. Notifications
  displayNotifications(response.notifications as any);

  // 2. Error
  if (response.error) {
    displayError(command, response.error);
    return;
  }

  const structured = response.structuredContent as Record<string, unknown> | undefined;

  // If this is a pending-action envelope (pending: true), the action has already
  // resolved and the action_result notification above showed the actual outcome.
  // Nothing more to print.
  if (structured?.pending === true) {
    return;
  }

  // 3. Try custom formatter on structuredContent
  if (tryCustomFormatter(command, structured)) {
    return;
  }

  // 4. Server-rendered text
  if (typeof response.result === 'string') {
    console.log(response.result);
    return;
  }

  // 5. Fallback: pretty-print whatever we have
  const output = structured || response.result;
  if (output !== undefined && output !== null) {
    console.log(JSON.stringify(output, null, 2));
  }
}

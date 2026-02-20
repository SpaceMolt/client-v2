import type { V2Response } from '../generated/types.gen.ts';
import { displayNotifications } from './notifications.ts';
import { displayError } from './errors.ts';
import { tryCustomFormatter } from './formatters.ts';

/**
 * Display a V2 API response to the user.
 *
 * Priority:
 * 1. Always show notifications first
 * 2. If error, show error + help hint
 * 3. Try custom formatter on structuredContent (ANSI-enhanced output)
 * 4. If result is a string, print it (server-rendered text)
 * 5. Fallback: pretty-print structuredContent or result as JSON
 */
export function displayResponse(command: string, response: V2Response): void {
  // 1. Notifications
  displayNotifications(response.notifications as any);

  // 2. Error
  if (response.error) {
    displayError(command, response.error);
    return;
  }

  // 3. Try custom formatter on structuredContent
  const structured = response.structuredContent as Record<string, unknown> | undefined;
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

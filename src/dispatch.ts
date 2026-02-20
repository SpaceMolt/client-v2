import { COMMAND_REGISTRY, SHORT_NAMES, TOOL_GROUPS, type CommandMeta } from './commands.ts';
import { apiCall, apiGet } from './api.ts';
import type { V2Response } from './generated/types.gen.ts';

export interface ResolvedCommand {
  toolGroup: string;
  action: string;
  meta: CommandMeta;
}

/**
 * Resolve a CLI command string to a tool group + action.
 *
 * Lookup order:
 * 1. Qualified name: "spacemolt_market/view_market" or "market/view_market"
 * 2. Short name: "travel" (only if unambiguous across tool groups)
 * 3. Returns null if not found
 */
export function resolveCommand(input: string): ResolvedCommand | null {
  // Try qualified name first (e.g., "spacemolt_market/create_sell_order" or "market/create_sell_order")
  if (input.includes('/')) {
    // Direct match
    const direct = COMMAND_REGISTRY.get(input);
    if (direct) return { toolGroup: direct.toolGroup, action: direct.action, meta: direct };

    // Try with spacemolt_ prefix
    const parts = input.split('/');
    if (parts.length === 2) {
      const prefixed = `spacemolt_${parts[0]}/${parts[1]}`;
      const match = COMMAND_REGISTRY.get(prefixed);
      if (match) return { toolGroup: match.toolGroup, action: match.action, meta: match };
    }
  }

  // Try short name (unambiguous actions)
  const shortKey = SHORT_NAMES.get(input);
  if (shortKey) {
    const meta = COMMAND_REGISTRY.get(shortKey)!;
    return { toolGroup: meta.toolGroup, action: meta.action, meta };
  }

  // Try as qualified with dot separator (e.g., "market.view_market")
  if (input.includes('.')) {
    const parts = input.split('.');
    if (parts.length === 2) {
      const key = `spacemolt_${parts[0]}/${parts[1]}`;
      const meta = COMMAND_REGISTRY.get(key);
      if (meta) return { toolGroup: meta.toolGroup, action: meta.action, meta };

      // Also try without spacemolt_ prefix
      const key2 = `${parts[0]}/${parts[1]}`;
      const meta2 = COMMAND_REGISTRY.get(key2);
      if (meta2) return { toolGroup: meta2.toolGroup, action: meta2.action, meta: meta2 };
    }
  }

  return null;
}

/**
 * Execute a resolved command against the API.
 */
export async function executeCommand(
  toolGroup: string,
  action: string,
  payload: Record<string, unknown>,
): Promise<V2Response> {
  return apiCall(`/${toolGroup}/${action}`, Object.keys(payload).length > 0 ? payload : undefined);
}

/**
 * Fetch help text for a tool group.
 */
export async function fetchHelp(toolGroup: string): Promise<V2Response> {
  return apiGet(`/${toolGroup}/help`);
}

/**
 * Get suggestions for ambiguous commands.
 */
export function getAmbiguousSuggestions(action: string): string[] {
  const matches: string[] = [];
  for (const [key, meta] of COMMAND_REGISTRY) {
    if (meta.action === action) {
      matches.push(key);
    }
  }
  return matches;
}

/**
 * List all available commands grouped by tool group.
 */
export function listCommands(): Map<string, CommandMeta[]> {
  const grouped = new Map<string, CommandMeta[]>();
  for (const [, meta] of COMMAND_REGISTRY) {
    const group = grouped.get(meta.toolGroup) || [];
    group.push(meta);
    grouped.set(meta.toolGroup, group);
  }
  return grouped;
}

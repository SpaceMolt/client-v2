#!/usr/bin/env bun
/**
 * SpaceMolt CLI Client v2
 *
 * A typed CLI client for the SpaceMolt v2 REST API.
 * Command registry and types are auto-generated from the OpenAPI spec.
 */

import { VERSION, API_BASE, DEBUG, enableDebug } from './config.ts';
import { resolveCommand, executeCommand, fetchHelp, getAmbiguousSuggestions, listCommands } from './dispatch.ts';
import { parseArgs, ArgError } from './args.ts';
import { displayResponse } from './output/index.ts';
import { c } from './output/colors.ts';
import { checkForUpdates } from './update-checker.ts';
import { COMMAND_REGISTRY, TOOL_GROUPS, SPEC_VERSION } from './commands.ts';
import { getAccounts, switchAccount, hasValidSession, reAuthenticate, getValidSession, createPassthroughAdapter } from './session.ts';
import { initApiClient } from './api.ts';

/**
 * Commands that have been removed or consolidated. Checked before resolution
 * so users get a clear migration message instead of "unknown command".
 */
const _STORAGE_HINT = 'Use the storage commands with target="faction:<faction_id>"';
const DEPRECATED_COMMANDS: Record<string, string> = {
  send_gift: `"send_gift" is deprecated. Use "deposit_items" with a player name as the target:\n  spacemolt deposit_items <player_name> <item_id> <quantity> message=<msg>`,
  gift:      `"gift" is deprecated. Use "deposit_items" with a player name as the target:\n  spacemolt deposit_items <player_name> <item_id> <quantity> message=<msg>`,
  // Faction storage consolidated into spacemolt_storage with target="faction:<faction_id>"
  'faction/deposit_items':            `"faction/deposit_items" is deprecated. ${_STORAGE_HINT}:\n  spacemolt deposit_items faction:<faction_id> <item_id> <quantity>`,
  'spacemolt_faction/deposit_items':  `"faction/deposit_items" is deprecated. ${_STORAGE_HINT}:\n  spacemolt deposit_items faction:<faction_id> <item_id> <quantity>`,
  'faction/withdraw_items':           `"faction/withdraw_items" is deprecated. ${_STORAGE_HINT}:\n  spacemolt withdraw_items faction:<faction_id> <item_id> <quantity>`,
  'spacemolt_faction/withdraw_items': `"faction/withdraw_items" is deprecated. ${_STORAGE_HINT}:\n  spacemolt withdraw_items faction:<faction_id> <item_id> <quantity>`,
  'faction/view_storage':             `"faction/view_storage" is deprecated. ${_STORAGE_HINT}:\n  spacemolt view_storage faction:<faction_id>`,
  'spacemolt_faction/view_storage':   `"faction/view_storage" is deprecated. ${_STORAGE_HINT}:\n  spacemolt view_storage faction:<faction_id>`,
  // search_changelog removed — use get_version with text/id params
  search_changelog: `"search_changelog" has been removed. Use "get_version" instead:\n  spacemolt get_version text=<query>     # search release notes\n  spacemolt get_version id=<version>     # look up a specific version\n  spacemolt get_version count=20 page=2  # paginate`,
  // Credits now live in wallet — deposit/withdraw commands removed
  deposit_credits:  `"deposit_credits" has been removed. Credits now live in your wallet and are available everywhere.\n  There is no need to deposit or withdraw credits.`,
  withdraw_credits: `"withdraw_credits" has been removed. Credits now live in your wallet and are available everywhere.\n  There is no need to deposit or withdraw credits.`,
  // inspect_cargo removed — scan is the replacement for inspecting another player's ship
  inspect_cargo: `"inspect_cargo" has been removed. Use "scan" to inspect another player's ship and cargo:\n  spacemolt scan <player_id>`,
  // set_ally split into propose/accept/remove
  'faction/set_ally':           `"faction/set_ally" has been replaced. Use:\n  spacemolt faction/propose_ally <faction_id>\n  spacemolt faction/accept_ally <faction_id>\n  spacemolt faction/remove_ally <faction_id>`,
  'spacemolt_faction/set_ally': `"faction/set_ally" has been replaced. Use:\n  spacemolt faction/propose_ally <faction_id>\n  spacemolt faction/accept_ally <faction_id>\n  spacemolt faction/remove_ally <faction_id>`,
};

interface GlobalFlags {
  help: boolean;
  json: boolean;
  debug: boolean;
  version: boolean;
  session: string | null;
}

const GLOBAL_FLAGS = new Set(['--help', '-h', '--json', '--debug', '--version', '-v', '--session']);

function extractFlags(argv: string[]): { flags: GlobalFlags; args: string[] } {
  const flags: GlobalFlags = { help: false, json: false, debug: false, version: false, session: null };
  const args: string[] = [];
  let stopFlags = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (stopFlags) {
      args.push(arg);
    } else if (arg === '--') {
      stopFlags = true;
    } else if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else if (arg === '--json') {
      flags.json = true;
    } else if (arg === '--debug') {
      flags.debug = true;
    } else if (arg === '--version' || arg === '-v') {
      flags.version = true;
    } else if (arg === '--session') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) {
        console.error(`${c.red}--session requires a session token value${c.reset}`);
        process.exit(1);
      }
      flags.session = next;
      i++; // consume the token value
    } else if (!GLOBAL_FLAGS.has(arg)) {
      args.push(arg);
    }
  }

  return { flags, args };
}

async function main(): Promise<void> {
  // Non-blocking update check
  checkForUpdates();

  const rawArgv = process.argv.slice(2);
  const { flags, args: argv } = extractFlags(rawArgv);

  // Activate debug mode from flag (merges with DEBUG=true env var)
  if (flags.debug) {
    enableDebug();
  }

  // Use a passthrough session adapter when --session is provided (no file I/O)
  if (flags.session) {
    initApiClient(createPassthroughAdapter(flags.session));
  }

  // Version flag (works from any position)
  if (flags.version) {
    console.log(`SpaceMolt CLI v${VERSION} (game API v${SPEC_VERSION})`);
    process.exit(0);
  }

  // No command: show help
  if (argv.length === 0) {
    printHelp();
    process.exit(0);
  }

  const rawCommand = argv[0];

  // Special: "help" with optional topic
  if (rawCommand === 'help') {
    await handleHelp(argv.slice(1));
    process.exit(0);
  }

  // --help with a command: treat as "help <command>"
  if (flags.help) {
    await handleHelp([rawCommand]);
    process.exit(0);
  }

  // Client-side: "accounts" — list stored accounts
  if (rawCommand === 'accounts') {
    handleAccounts();
    process.exit(0);
  }

  // Client-side: "switch <username>" — switch active account
  if (rawCommand === 'switch') {
    await handleSwitch(argv[1]);
    process.exit(0);
  }

  // Check for deprecated commands before resolution
  const deprecationMsg = DEPRECATED_COMMANDS[rawCommand];
  if (deprecationMsg) {
    console.error(`${c.yellow}${deprecationMsg}${c.reset}`);
    process.exit(1);
  }

  // Resolve the command
  const resolved = resolveCommand(rawCommand);

  if (!resolved) {
    // Check if it's an ambiguous command
    const suggestions = getAmbiguousSuggestions(rawCommand);
    if (suggestions.length > 0) {
      console.error(`${c.yellow}Ambiguous command "${rawCommand}". Did you mean one of:${c.reset}`);
      for (const s of suggestions) {
        console.error(`  ${c.bright}${s}${c.reset}`);
      }
      console.error(`\nUse the qualified form: spacemolt ${suggestions[0]}`);
    } else {
      console.error(`${c.red}Unknown command:${c.reset} ${rawCommand}`);
      console.error(`Run "spacemolt help" for a list of commands, or "spacemolt help <tool_group>" for details.`);
    }
    process.exit(1);
  }

  // Parse arguments
  let payload: Record<string, unknown>;
  try {
    ({ payload } = parseArgs(argv, resolved.meta));
  } catch (err) {
    if (err instanceof ArgError) {
      console.error(`${c.red}${err.message}${c.reset}`);
      console.error(`Run "spacemolt help ${rawCommand}" for parameter details.`);
      process.exit(1);
    }
    throw err;
  }

  if (DEBUG) {
    console.error(`[dispatch] ${resolved.toolGroup}/${resolved.action} payload=${JSON.stringify(payload)}`);
  }

  // Execute
  try {
    const response = await executeCommand(resolved.toolGroup, resolved.action, payload, resolved.meta.isDirect);
    displayResponse(`${resolved.toolGroup}/${resolved.action}`, response, { json: flags.json });

    // Exit with error code if the response was an error
    if (response.error) {
      process.exit(1);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isNetworkError = msg.startsWith('Connection failed') || msg.startsWith('Failed to create session');
    const isFileError = msg.startsWith('Session file write failed');
    const label = isNetworkError ? 'Connection error' : isFileError ? 'Session file error' : 'Error';
    console.error(`${label}: ${msg}`);
    if (DEBUG && err instanceof Error) {
      console.error(err.stack);
    }
    if (isNetworkError) {
      console.error(`\nTroubleshooting:`);
      console.error(`  - Is the server running? (${API_BASE})`);
      console.error(`  - Check your internet connection`);
      console.error(`  - Use --debug for more details`);
    }
    process.exit(1);
  }
}

async function handleHelp(args: string[]): Promise<void> {
  if (args.length === 0) {
    printHelp();
    return;
  }

  const topic = args[0];

  // Check if it's a tool group name
  const toolGroup = TOOL_GROUPS.find(tg => tg === topic || tg === `spacemolt_${topic}`);
  if (toolGroup) {
    try {
      const response = await fetchHelp(toolGroup);
      if (typeof response.result === 'string') {
        console.log(response.result);
      } else {
        console.log(JSON.stringify(response, null, 2));
      }
    } catch (err) {
      console.error(`Failed to fetch help for ${toolGroup}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  // Check if it's a specific command
  const resolved = resolveCommand(topic);
  if (resolved) {
    console.log(`${c.bright}${resolved.toolGroup}/${resolved.action}${c.reset}`);
    console.log(`  ${resolved.meta.summary}`);
    if (resolved.meta.params.length > 0) {
      console.log(`\n${c.bright}Parameters:${c.reset}`);
      for (const p of resolved.meta.params) {
        const req = p.required ? ` ${c.red}(required)${c.reset}` : '';
        const pos = p.positionalIndex >= 0 ? ` ${c.dim}[positional #${p.positionalIndex + 1}]${c.reset}` : '';
        const enumStr = p.enumValues ? ` ${c.dim}[${p.enumValues.join('|')}]${c.reset}` : '';
        console.log(`  ${c.cyan}${p.name}${c.reset} (${p.type})${req}${pos}${enumStr}`);
        if (p.description) console.log(`    ${c.dim}${p.description}${c.reset}`);
      }
    }
    return;
  }

  console.error(`Unknown help topic: "${topic}". Try "spacemolt help" for a list.`);
}

function handleAccounts(): void {
  const accounts = getAccounts();

  if (accounts.length === 0) {
    console.log(`${c.dim}No stored accounts.${c.reset}`);
    console.log(`Run: spacemolt login <username> <password>`);
    return;
  }

  console.log(`${c.bright}Stored accounts:${c.reset}`);
  for (const acct of accounts) {
    const marker = acct.isActive ? `${c.green}*${c.reset} ` : '  ';
    const status = acct.hasValidSession
      ? `${c.dim}(session valid)${c.reset}`
      : `${c.yellow}(session expired)${c.reset}`;
    const pid = acct.playerId ? ` ${c.dim}[${acct.playerId.slice(0, 8)}...]${c.reset}` : '';
    console.log(`${marker}${c.bright}${acct.username}${c.reset}${pid} ${status}`);
  }
}

async function handleSwitch(username?: string): Promise<void> {
  if (!username) {
    console.error(`${c.red}Usage:${c.reset} spacemolt switch <username>`);
    console.error(`Run "spacemolt accounts" to see stored accounts.`);
    process.exit(1);
  }

  const found = switchAccount(username);
  if (!found) {
    console.error(`${c.red}Unknown account:${c.reset} ${username}`);
    console.error(`Run "spacemolt accounts" to see stored accounts.`);
    process.exit(1);
  }

  // If session is expired, try to re-authenticate
  if (!hasValidSession(username)) {
    console.log(`${c.yellow}Session expired for ${username}, re-authenticating...${c.reset}`);
    try {
      const session = await getValidSession();
      const result = await reAuthenticate(session);
      if (result) {
        console.log(`${c.green}Switched to ${username}${c.reset} ${c.dim}(re-authenticated)${c.reset}`);
        return;
      }
    } catch {
      // Fall through to manual login message
    }
    console.error(`${c.red}Re-authentication failed.${c.reset} Run: spacemolt login ${username} <password>`);
    process.exit(1);
  }

  console.log(`${c.green}Switched to ${username}${c.reset}`);
}

function printHelp(): void {
  console.log(`${c.bright}SpaceMolt CLI v${VERSION}${c.reset} ${c.dim}(game API v${SPEC_VERSION})${c.reset}`);
  console.log(`${c.dim}API: ${API_BASE}${c.reset}\n`);
  console.log(`${c.bright}Usage:${c.reset} spacemolt <command> [args...]\n`);
  console.log(`${c.bright}Examples:${c.reset}`);
  console.log(`  spacemolt register MyAgent solarian YOUR_REGISTRATION_CODE`);
  console.log(`  spacemolt login MyAgent password123`);
  console.log(`  spacemolt get_status`);
  console.log(`  spacemolt travel sol_asteroid_belt`);
  console.log(`  spacemolt mine`);
  console.log(`  spacemolt sell id=ore_iron quantity=10`);
  console.log(`  spacemolt market/view_market item_id=ore_iron`);
  console.log(`  spacemolt catalog type=ships`);
  console.log(`  spacemolt catalog type=items category=ore`);
  console.log();

  // Group commands by tool group
  const grouped = listCommands();
  for (const [group, cmds] of grouped) {
    const shortGroup = group.replace('spacemolt_', '').replace('spacemolt', 'core');
    const cmdNames = cmds.map(cmd => {
      return cmd.isAmbiguous ? `${group}/${cmd.action}` : cmd.action;
    });
    console.log(`${c.bright}${shortGroup}:${c.reset} ${c.dim}${cmdNames.join(', ')}${c.reset}`);
  }

  console.log(`\n${c.bright}Account management:${c.reset}`);
  console.log(`  spacemolt accounts              List stored accounts`);
  console.log(`  spacemolt switch <username>     Switch active account`);

  console.log(`\n${c.bright}Flags:${c.reset}`);
  console.log(`  --help, -h                      Show help (or help for a specific command)`);
  console.log(`  --json                          Output raw JSON instead of formatted text`);
  console.log(`  --debug                         Show debug info (API requests, dispatch)`);
  console.log(`  --session <token>               Use an explicit session token (skips session file I/O)`);
  console.log(`  --version, -v                   Show version`);
  console.log(`  --                              Stop flag processing (for literal args)`);

  console.log(`\n${c.bright}Help:${c.reset}`);
  console.log(`  spacemolt help                  Show this help`);
  console.log(`  spacemolt help <tool_group>     Show server help for a tool group`);
  console.log(`  spacemolt help <command>        Show parameter details for a command`);
  console.log();
  console.log(`${c.dim}Ambiguous commands require qualified names (e.g., "market/sell" vs "salvage/sell").${c.reset}`);
  console.log(`${c.dim}Set SPACEMOLT_URL to override the API endpoint.${c.reset}`);
}

main();

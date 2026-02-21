#!/usr/bin/env bun
/**
 * SpaceMolt CLI Client v2
 *
 * A typed CLI client for the SpaceMolt v2 REST API.
 * Command registry and types are auto-generated from the OpenAPI spec.
 */

import { VERSION, API_BASE, DEBUG } from './config.ts';
import { resolveCommand, executeCommand, fetchHelp, getAmbiguousSuggestions, listCommands } from './dispatch.ts';
import { parseArgs } from './args.ts';
import { displayResponse } from './output/index.ts';
import { c } from './output/colors.ts';
import { checkForUpdates } from './update-checker.ts';
import { COMMAND_REGISTRY, TOOL_GROUPS } from './commands.ts';
import { getAccounts, switchAccount, hasValidSession, reAuthenticate, getValidSession, loadSession } from './session.ts';

async function main(): Promise<void> {
  // Non-blocking update check
  checkForUpdates();

  const argv = process.argv.slice(2);

  // No args or help flag
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printHelp();
    process.exit(0);
  }

  // Version flag
  if (argv[0] === '--version' || argv[0] === '-v') {
    console.log(`SpaceMolt CLI v${VERSION}`);
    process.exit(0);
  }

  const rawCommand = argv[0];

  // Special: "help" with optional topic
  if (rawCommand === 'help') {
    await handleHelp(argv.slice(1));
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
  const { payload } = parseArgs(argv, resolved.meta);

  if (DEBUG) {
    console.error(`[dispatch] ${resolved.toolGroup}/${resolved.action} payload=${JSON.stringify(payload)}`);
  }

  // Smart login: skip API call if we already have a valid session for this user
  if (resolved.action === 'login' && resolved.toolGroup === 'spacemolt_auth') {
    const username = payload.username as string | undefined;
    if (username && hasValidSession(username)) {
      switchAccount(username);
      console.log(`${c.green}Switched to ${username}${c.reset} ${c.dim}(session still valid)${c.reset}`);
      process.exit(0);
    }
  }

  // Execute
  try {
    const response = await executeCommand(resolved.toolGroup, resolved.action, payload, resolved.meta.isDirect);
    displayResponse(`${resolved.toolGroup}/${resolved.action}`, response);

    // Exit with error code if the response was an error
    if (response.error) {
      process.exit(1);
    }
  } catch (err) {
    console.error(`${c.red}Connection error:${c.reset} ${err instanceof Error ? err.message : String(err)}`);
    if (DEBUG && err instanceof Error) {
      console.error(err.stack);
    }
    console.error(`\n${c.dim}Troubleshooting:`);
    console.error(`  - Is the server running? (${API_BASE})`);
    console.error(`  - Check your internet connection`);
    console.error(`  - Set DEBUG=true for more details${c.reset}`);
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
  console.log(`${c.bright}SpaceMolt CLI v${VERSION}${c.reset}`);
  console.log(`${c.dim}API: ${API_BASE}${c.reset}\n`);
  console.log(`${c.bright}Usage:${c.reset} spacemolt <command> [args...]\n`);
  console.log(`${c.bright}Examples:${c.reset}`);
  console.log(`  spacemolt register MyAgent solarian`);
  console.log(`  spacemolt login MyAgent password123`);
  console.log(`  spacemolt get_status`);
  console.log(`  spacemolt travel sol_asteroid_belt`);
  console.log(`  spacemolt mine`);
  console.log(`  spacemolt sell id=ore_iron quantity=10`);
  console.log(`  spacemolt market/view_market item_id=ore_iron`);
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

  console.log(`\n${c.bright}Help:${c.reset}`);
  console.log(`  spacemolt help                  Show this help`);
  console.log(`  spacemolt help <tool_group>     Show server help for a tool group`);
  console.log(`  spacemolt help <command>        Show parameter details for a command`);
  console.log(`  spacemolt --version             Show version`);
  console.log();
  console.log(`${c.dim}Ambiguous commands require qualified names (e.g., "market/sell" vs "salvage/sell").${c.reset}`);
  console.log(`${c.dim}Set DEBUG=true for verbose output. Set SPACEMOLT_URL to override the API endpoint.${c.reset}`);
}

main();

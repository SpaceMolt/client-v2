import { c } from './colors.ts';

const ERROR_HELP: Record<string, string> = {
  'not_authenticated': 'Run "spacemolt login <username> <password>" first.',
  'invalid_credentials': 'Check your username and password. Passwords are case-sensitive.',
  'session_expired': 'Your session expired. Run the command again to auto-create a new session.',
  'rate_limited': 'Query rate limited. Wait a moment and retry.',
  'docked': 'You are docked. Run "undock" first.',
  'not_docked': 'You must be docked at a station.',
  'already_traveling': 'You are already traveling. Wait for arrival or check with "get_status".',
  'already_jumping': 'You are already jumping between systems. Wait for arrival.',
  'invalid_poi': 'POI not found. Run "get_system" to see valid POIs.',
  'wrong_system': 'That POI is in a different system. Use "jump" to change systems first.',
  'not_connected': 'Systems are not connected. Run "get_system" to see connections.',
  'no_fuel': 'Insufficient fuel. Dock at a station and run "refuel".',
  'no_credits': 'Insufficient credits. Mine and sell resources to earn credits.',
  'no_cargo_space': 'Cargo hold is full. Sell or jettison items to make space.',
  'invalid_target': 'Target not found. Run "get_nearby" to see players at your POI.',
  'target_cloaked': 'Target is cloaked. Use "scan" with high scan power to reveal them.',
  'no_cloak': 'No cloaking device installed on your ship.',
  'username_taken': 'That username is already taken. Try a different username.',
  'invalid_username': 'Username must be 3-20 alphanumeric characters.',
  'empire_restricted': 'Invalid empire. Valid empires: solarian, voidborn, crimson, nebula, outerrim.',
  'no_mining_laser': 'No mining laser installed. Buy one from a station market.',
  'not_asteroid': 'You can only mine at asteroid belts. Travel to one first.',
};

export function displayError(command: string, error: { code?: string; message?: string }): void {
  const code = error.code || 'unknown';
  const message = error.message || 'An unknown error occurred.';

  console.error(`${c.red}Error${c.reset} [${code}]: ${message}`);

  const help = ERROR_HELP[code];
  if (help) {
    console.error(`${c.dim}Hint: ${help}${c.reset}`);
  }
}

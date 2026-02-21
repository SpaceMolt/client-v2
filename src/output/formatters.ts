import { c } from './colors.ts';

type Formatter = (data: Record<string, unknown>) => boolean;

/**
 * Custom formatters for specific response types.
 * These enhance the server-rendered `result` text with ANSI colors
 * when `structuredContent` is available.
 *
 * Each formatter returns true if it handled the output, false to pass through.
 */
const formatters: Record<string, Formatter> = {
  register: (data) => {
    if (!data.password) return false;
    console.log(`${c.green}${c.bright}Registration successful!${c.reset}`);
    console.log(`${c.bright}Username:${c.reset} ${data.username}`);
    console.log(`${c.bright}Password:${c.reset} ${c.red}${c.bright}${data.password}${c.reset}`);
    console.log(`${c.yellow}SAVE THIS PASSWORD - it cannot be recovered!${c.reset}`);
    if (data.empire) console.log(`${c.bright}Empire:${c.reset} ${data.empire}`);
    if (data.player_id) console.log(`${c.bright}Player ID:${c.reset} ${data.player_id}`);
    return true;
  },

  get_status: (data) => {
    if (!data.player && !data.ship) return false;
    const p = data.player as Record<string, unknown> | undefined;
    const s = data.ship as Record<string, unknown> | undefined;
    const loc = data.location as Record<string, unknown> | undefined;

    if (p) {
      console.log(`${c.bright}--- Player ---${c.reset}`);
      console.log(`  ${c.bright}${p.username}${c.reset} (${p.empire}) | Credits: ${c.yellow}${p.credits}${c.reset}`);
      if (p.faction_id) console.log(`  Faction: ${p.clan_tag ? `[${p.clan_tag}] ` : ''}${p.faction_id} (${p.faction_rank || 'member'})`);
    }

    if (s) {
      console.log(`${c.bright}--- Ship ---${c.reset}`);
      console.log(`  ${s.name || s.class_name} (${s.class_id})`);
      console.log(`  Hull: ${colorHealth(s.hull as number, s.max_hull as number)} | Shield: ${colorHealth(s.shield as number, s.max_shield as number)}`);
      console.log(`  Fuel: ${s.fuel}/${s.max_fuel} | Cargo: ${s.cargo_used}/${s.cargo_capacity}`);
    }

    if (loc) {
      console.log(`${c.bright}--- Location ---${c.reset}`);
      console.log(`  System: ${loc.system_name || loc.system_id} | POI: ${loc.poi_name || loc.poi_id}`);
      if (loc.docked_at) console.log(`  ${c.green}Docked${c.reset} at ${loc.docked_at}`);
    }

    return true;
  },

  get_system: (data) => {
    if (!data.pois && !data.connections) return false;
    const system = data as Record<string, unknown>;
    console.log(`${c.bright}System: ${system.name || system.id}${c.reset}`);
    if (system.empire) console.log(`  Empire: ${system.empire}`);

    const pois = system.pois as Array<Record<string, unknown>> | undefined;
    if (pois?.length) {
      console.log(`${c.bright}  POIs:${c.reset}`);
      for (const poi of pois) {
        const bases = poi.bases as Array<Record<string, unknown>> | undefined;
        const baseStr = bases?.length ? ` ${c.cyan}[${bases.map(b => b.name || b.id).join(', ')}]${c.reset}` : '';
        console.log(`    ${poi.id} - ${poi.name} (${poi.type})${baseStr}`);
      }
    }

    const connections = system.connections as Array<Record<string, unknown>> | undefined;
    if (connections?.length) {
      console.log(`${c.bright}  Connections:${c.reset}`);
      for (const conn of connections) {
        console.log(`    -> ${conn.name || conn.id}`);
      }
    }

    return true;
  },
};

function colorHealth(current: number | undefined, max: number | undefined): string {
  if (current === undefined || max === undefined) return '?/?';
  const ratio = max > 0 ? current / max : 0;
  const color = ratio > 0.6 ? c.green : ratio > 0.3 ? c.yellow : c.red;
  return `${color}${current}${c.reset}/${max}`;
}

/**
 * Try to format structuredContent with a custom formatter.
 * Returns true if handled, false if not.
 */
export function tryCustomFormatter(command: string, data?: Record<string, unknown>): boolean {
  if (!data) return false;

  // Try exact command match
  const action = command.includes('/') ? command.split('/').pop()! : command;
  const formatter = formatters[action];
  if (formatter) {
    return formatter(data);
  }

  return false;
}

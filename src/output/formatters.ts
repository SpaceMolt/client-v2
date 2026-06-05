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

      // Active combat status effects (fields are omitted by the server when inactive)
      const effects: string[] = [];
      if ((s.burn_ticks_remaining as number) > 0) {
        effects.push(`Burning: ${s.burn_damage_per_tick} dmg/tick, ${s.burn_ticks_remaining} ticks left`);
      }
      if ((s.armor_melt_ticks_remaining as number) > 0) {
        effects.push(`Armor melt: ${Math.round((s.armor_melt_pct as number) * 100)}%, ${s.armor_melt_ticks_remaining} ticks left`);
      }
      if (effects.length) console.log(`  ${c.red}${c.bright}⚠ ${effects.join(' | ')}${c.reset}`);
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

  catalog: (data) => {
    const type = data.type as string | undefined;
    const items = data.items as Array<Record<string, unknown>> | undefined;
    if (!type || !items) return false;

    const page = data.page as number || 1;
    const totalPages = data.total_pages as number || 1;
    const total = data.total as number || items.length;

    const header = `${c.bright}Catalog: ${type}${c.reset} ${c.dim}(${total} total, page ${page}/${totalPages})${c.reset}\n`;

    switch (type) {
      case 'ships':
        console.log(header);
        for (const ship of items) {
          const tier = ship.tier !== undefined ? ` T${ship.tier}` : '';
          const cat = ship.category ? ` ${c.dim}[${ship.category}]${c.reset}` : '';
          console.log(`  ${c.bright}${ship.name}${c.reset}${tier}${cat} — ${c.yellow}${(ship.price as number ?? 0).toLocaleString()} cr${c.reset}`);
          console.log(`    ${c.dim}Hull: ${ship.base_hull} | Shield: ${ship.base_shield} | Cargo: ${ship.cargo_capacity} | Weapons: ${ship.weapon_slots} | Speed: ${ship.base_speed}${c.reset}`);
        }
        break;

      case 'items':
        console.log(header);
        for (const item of items) {
          const cat = item.category || item.type || '';
          const size = item.size !== undefined ? ` (size ${item.size})` : '';
          console.log(`  ${c.bright}${item.name || item.id}${c.reset} ${c.dim}[${cat}]${c.reset}${size} — ${c.yellow}${(item.base_value as number ?? 0).toLocaleString()} cr${c.reset}`);
          if (item.description) console.log(`    ${c.dim}${item.description}${c.reset}`);
        }
        break;

      case 'skills':
        console.log(header);
        for (const skill of items) {
          const cat = skill.category ? ` ${c.dim}[${skill.category}]${c.reset}` : '';
          const maxLvl = skill.max_level !== undefined ? ` (max ${skill.max_level})` : '';
          console.log(`  ${c.bright}${skill.name}${c.reset}${cat}${maxLvl}`);
          if (skill.description) console.log(`    ${c.dim}${skill.description}${c.reset}`);
        }
        break;

      case 'recipes':
        console.log(header);
        for (const recipe of items) {
          const cat = recipe.category ? ` ${c.dim}[${recipe.category}]${c.reset}` : '';
          const time = recipe.crafting_time !== undefined ? ` ${c.dim}(${recipe.crafting_time} ticks)${c.reset}` : '';
          const inputs = recipe.inputs as Array<Record<string, unknown>> | undefined;
          const outputs = recipe.outputs as Array<Record<string, unknown>> | undefined;
          console.log(`  ${c.bright}${recipe.name}${c.reset}${cat}${time}`);
          if (inputs?.length) {
            const inputStr = inputs.map(i => `${i.quantity}x ${i.item_id}`).join(', ');
            const outputStr = outputs?.length ? outputs.map(o => `${o.quantity}x ${o.item_id}`).join(', ') : '?';
            console.log(`    ${c.dim}${inputStr} → ${outputStr}${c.reset}`);
          }
        }
        break;

      default:
        // Unknown catalog type — show header + generic list of item names/ids
        console.log(header);
        for (const item of items) {
          console.log(`  ${c.bright}${item.name || item.id || JSON.stringify(item)}${c.reset}`);
        }
        break;
    }

    if (totalPages > 1) {
      console.log(`\n${c.dim}Use page=N to see more results${c.reset}`);
    }

    return true;
  },

  list: (data) => {
    // spacemolt_drone/list — handle the drones bay+bandwidth view; fall through
    // to server text for spacemolt_citizenship/list etc. (server has a richer table).
    if (Array.isArray(data.drones)) return formatDroneList(data);
    return false;
  },

  status: (data) => {
    // spacemolt_fleet/status — handle in-fleet shape with members; let the
    // server's "Not in a fleet." text render the not-in-fleet case.
    const members = data.members as unknown[] | undefined;
    if (!Array.isArray(members) || members.length === 0) return false;
    return formatFleetStatus(data);
  },

  get_guide: (data) => {
    const guides = data.guides as Array<Record<string, unknown>> | undefined;
    // Listing mode: show available guides
    if (Array.isArray(guides) && guides.length > 0 && !data.content) {
      console.log(`${c.bright}Available guides:${c.reset}`);
      for (const g of guides) {
        console.log(`  ${c.cyan}${g.id}${c.reset} — ${g.title || ''}`);
        if (g.description) console.log(`    ${c.dim}${g.description}${c.reset}`);
      }
      if (data.hint) console.log(`\n${c.dim}${data.hint}${c.reset}`);
      return true;
    }
    // Single-guide content mode: let the server-rendered result string handle it
    return false;
  },
};

function formatDroneList(data: Record<string, unknown>): boolean {
  const drones = data.drones as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(drones)) return false;
  const bandUsed = data.bandwidth_used as number | undefined;
  const bandTotal = data.bandwidth_total as number | undefined;
  const bayUsed = data.bay_count as number | undefined;
  const bayCap = data.bay_capacity as number | undefined;
  const deployed = data.deployed_count as number | undefined;

  console.log(`${c.bright}Drones${c.reset}`);
  if (bandTotal !== undefined) console.log(`  Bandwidth: ${bandUsed ?? 0}/${bandTotal}`);
  if (bayCap !== undefined) console.log(`  Bay: ${bayUsed ?? 0}/${bayCap}${deployed ? ` (${deployed} deployed)` : ''}`);

  if (drones.length === 0) {
    console.log(`  ${c.dim}(none)${c.reset}`);
    return true;
  }

  for (const d of drones) {
    const hull = colorHealth(d.hull as number, d.max_hull as number);
    const status = d.status ? ` ${c.dim}[${d.status}]${c.reset}` : '';
    const loc = d.poi_id ? ` at ${d.poi_id}` : '';
    const travel = d.travel_to ? ` ${c.yellow}→ ${d.travel_to} (${d.travel_ticks}t)${c.reset}` : '';
    const cargoPct = d.cargo_pct as number | undefined;
    const cargo = cargoPct !== undefined ? ` cargo ${cargoPct}%` : '';
    const script = d.has_script ? ` ${c.cyan}[script]${c.reset}` : '';
    console.log(`  ${c.bright}${d.id}${c.reset}${status} Hull ${hull}${cargo}${loc}${travel}${script}`);
  }
  return true;
}

function formatFleetStatus(data: Record<string, unknown>): boolean {
  const members = data.members as Array<Record<string, unknown>>;
  const max = data.max_size as number | undefined;
  console.log(`${c.bright}Fleet ${data.fleet_id}${c.reset} ${c.dim}(${members.length}${max ? `/${max}` : ''} members)${c.reset}`);
  if (data.leader) console.log(`  Leader: ${c.bright}${data.leader}${c.reset}${data.is_leader ? ` ${c.green}(you)${c.reset}` : ''}`);
  if (data.system_id) console.log(`  At: ${data.poi_id || data.system_id}`);

  console.log(`${c.bright}  Members:${c.reset}`);
  for (const m of members) {
    const tag = m.clan_tag ? `[${m.clan_tag}] ` : '';
    const ship = m.ship_class ? ` — ${m.ship_class}` : '';
    const here = m.same_poi ? '' : ` ${c.dim}(elsewhere)${c.reset}`;
    console.log(`    ${tag}${c.bright}${m.username || m.player_id}${c.reset}${ship}${here}`);
  }
  return true;
}

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
  const action = command.includes('/') ? command.split('/').pop() ?? command : command;
  const formatter = formatters[action];
  if (formatter) {
    try {
      return formatter(data);
    } catch {
      // Formatter crashed on malformed data — fall through to default display
      return false;
    }
  }

  return false;
}

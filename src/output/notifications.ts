import { c } from './colors.ts';

type NotificationData = Record<string, any>;
type NotificationHandler = (data: NotificationData, time: string) => void;

const handlers: Record<string, NotificationHandler> = {
  chat_message: (d, t) => {
    console.log(`${c.dim}[${t}]${c.reset} ${c.cyan}[CHAT:${d.channel || 'local'}]${c.reset} ${c.bright}${d.sender || 'Unknown'}${c.reset}: ${d.content || ''}`);
  },

  combat_update: (d, t) => {
    const destroyed = d.destroyed ? ' - DESTROYED!' : '';
    console.log(`${c.dim}[${t}]${c.reset} ${c.red}[COMBAT]${c.reset} ${d.attacker || 'unknown'} hit ${d.target || 'unknown'} for ${d.damage || 0} ${d.damage_type || 'unknown'} damage (shield: ${d.shield_hit || 0}, hull: ${d.hull_hit || 0})${destroyed}`);
  },

  player_died: (d, t) => {
    const cause = d.cause || 'combat';
    if (cause === 'self_destruct') {
      console.log(`${c.dim}[${t}]${c.reset} ${c.red}${c.bright}[DEATH]${c.reset} Self-destructed!`);
    } else if (cause === 'police') {
      console.log(`${c.dim}[${t}]${c.reset} ${c.red}${c.bright}[DEATH]${c.reset} Destroyed by system police!`);
    } else {
      console.log(`${c.dim}[${t}]${c.reset} ${c.red}${c.bright}[DEATH]${c.reset} Destroyed by ${d.killer_name || 'unknown'}!`);
    }
    if (d.combat_log) {
      const log = d.combat_log as Record<string, any>;
      if (log.message) console.log(`  ${log.message}`);
      if (log.attacker_ship) console.log(`  Attacker ship: ${log.attacker_ship}`);
      if (log.weapons_used && Object.keys(log.weapons_used).length > 0) {
        const weapons = Object.entries(log.weapons_used).map(([w, n]) => `${w} (x${n})`).join(', ');
        console.log(`  Weapons: ${weapons}`);
      }
      if (log.total_damage > 0) {
        console.log(`  Damage taken: ${log.total_damage} total (${log.shield_damage || 0} shield, ${log.hull_damage || 0} hull) over ${log.combat_rounds || 0} round${log.combat_rounds !== 1 ? 's' : ''}`);
      }
      if (log.death_location) console.log(`  Location: ${log.death_location} in ${log.death_system || 'unknown'}`);
    }
    if (d.ship_lost) console.log(`  Ship lost: ${d.ship_lost}`);
    if ((d.clone_cost as number) > 0) console.log(`  Clone cost: ${d.clone_cost} credits`);
    if ((d.insurance_payout as number) > 0) console.log(`  Insurance payout: ${d.insurance_payout} credits`);
    console.log(`  Respawned at: ${d.respawn_base || 'home'} with ship fully repaired`);
  },

  mining_yield: (d, t) => {
    const remainingMsg = d.remaining !== undefined ? ` (${d.remaining} remaining at POI)` : '';
    console.log(`${c.dim}[${t}]${c.reset} ${c.green}[MINED]${c.reset} +${d.quantity || 0}x ${d.resource_id || 'ore'}${remainingMsg}`);
  },

  crafting_update: (d, t) => {
    const jobs = (d.jobs as Array<Record<string, any>>) || [];
    for (const j of jobs) {
      if (j.completed) {
        const items = ((j.deposited as Array<Record<string, any>>) || [])
          .map(i => `${i.quantity}x ${i.item_name || i.item_id}`).join(', ');
        const dest = j.storage ? ` → ${j.storage} storage` : '';
        console.log(`${c.dim}[${t}]${c.reset} ${c.green}[CRAFTING]${c.reset} ${j.recipe || 'job'} complete at ${j.venue || 'facility'}: ${items || 'done'}${dest}`);
      } else {
        console.log(`${c.dim}[${t}]${c.reset} ${c.cyan}[CRAFTING]${c.reset} ${j.recipe || 'job'} at ${j.venue || 'facility'}: ${j.runs_done || 0} run(s) done, ${j.runs_remaining || 0} remaining`);
      }
    }
  },

  trade_offer_received: (d, t) => {
    console.log(`${c.dim}[${t}]${c.reset} ${c.yellow}[TRADE]${c.reset} Offer from ${d.from_name || 'Someone'} (ID: ${d.trade_id || ''})`);
    if ((d.offer_credits as number) > 0) console.log(`  Offering: ${d.offer_credits} credits`);
    if ((d.request_credits as number) > 0) console.log(`  Requesting: ${d.request_credits} credits`);
    console.log(`  Use: trade_accept id=${d.trade_id} or trade_decline id=${d.trade_id}`);
  },

  scan_result: (d, t) => {
    const target = d.username || d.target_id || 'unknown';
    if (d.success) {
      const revealed = (d.revealed_info as string[]) || [];
      console.log(`${c.dim}[${t}]${c.reset} ${c.cyan}[SCAN]${c.reset} Scan of ${target} revealed: ${revealed.join(', ')}`);
      if (d.ship_class) console.log(`  Ship: ${d.ship_class}`);
      if (d.hull !== undefined) console.log(`  Hull: ${d.hull}`);
      if (d.shield !== undefined) console.log(`  Shield: ${d.shield}`);
    } else {
      console.log(`${c.dim}[${t}]${c.reset} ${c.cyan}[SCAN]${c.reset} Scan of ${target} failed - insufficient scan power`);
    }
  },

  scan_detected: (d, t) => {
    const revealed = (d.revealed_info as string[]) || [];
    console.log(`${c.dim}[${t}]${c.reset} ${c.yellow}[SCANNED]${c.reset} You were scanned by ${d.scanner_username || 'Unknown'} (${d.scanner_ship_class || 'unknown'})`);
    console.log(`  They learned: ${revealed.join(', ')}`);
  },

  police_warning: (d, t) => {
    console.log(`${c.dim}[${t}]${c.reset} ${c.red}${c.bright}[POLICE]${c.reset} ${d.message || 'Warning from system police'}`);
    console.log(`  Security level: ${d.police_level || 0}, Response in: ${d.response_ticks || 0} tick(s)`);
  },

  police_spawn: (d, t) => {
    console.log(`${c.dim}[${t}]${c.reset} ${c.red}${c.bright}[POLICE]${c.reset} ${d.num_drones || 0} police drone(s) arrived!`);
  },

  police_combat: (d, t) => {
    const destroyed = d.destroyed ? ' - YOU WERE DESTROYED!' : '';
    console.log(`${c.dim}[${t}]${c.reset} ${c.red}[POLICE]${c.reset} Police drone dealt ${d.damage || 0} damage${destroyed}`);
  },

  skill_level_up: (d, t) => {
    console.log(`${c.dim}[${t}]${c.reset} ${c.green}${c.bright}[LEVEL UP]${c.reset} ${d.skill_id || 'unknown'} is now level ${d.new_level || 0}! (+${d.xp_gained || 0} XP)`);
  },

  drone_update: (d, t) => {
    console.log(`${c.dim}[${t}]${c.reset} ${c.blue}[DRONE]${c.reset} Your ${d.drone_type || 'drone'} drone dealt ${d.damage || 0} damage to ${d.target_id || 'target'}`);
  },

  drone_destroyed: (d, t) => {
    console.log(`${c.dim}[${t}]${c.reset} ${c.red}[DRONE]${c.reset} Your ${d.drone_type || 'drone'} drone was destroyed! (ID: ${d.drone_id || ''})`);
  },

  pilotless_ship: (d, t) => {
    console.log(`${c.dim}[${t}]${c.reset} ${c.yellow}[PILOTLESS]${c.reset} ${d.player_username || 'unknown'}'s ${d.ship_class || 'ship'} is now pilotless!`);
    console.log(`  Vulnerable for ${d.ticks_remaining || 0} ticks - can be attacked without resistance`);
  },

  reconnected: (d, t) => {
    console.log(`${c.dim}[${t}]${c.reset} ${c.green}[RECONNECTED]${c.reset} ${d.message || 'Session reconnected'}`);
    if (d.was_pilotless) console.log(`  Ship was pilotless - recovered with ${d.ticks_remaining || 0} ticks to spare`);
  },

  faction_invite: (d, t) => {
    console.log(`${c.dim}[${t}]${c.reset} ${c.magenta}[FACTION]${c.reset} You've been invited to join ${d.faction_name || 'a faction'}`);
    console.log(`  Use: faction/join id=${d.faction_id || ''} or faction/decline_invite id=${d.faction_id || ''}`);
  },

  faction_war_declared: (d, t) => {
    console.log(`${c.dim}[${t}]${c.reset} ${c.red}${c.bright}[WAR]${c.reset} ${d.attacker_name || 'a faction'} has declared war on your faction!`);
    console.log(`  Reason: ${d.reason || 'no reason given'}`);
  },

  faction_peace_proposed: (d, t) => {
    console.log(`${c.dim}[${t}]${c.reset} ${c.green}[PEACE]${c.reset} ${d.proposer_name || 'a faction'} has proposed peace!`);
    console.log(`  Terms: ${d.terms || 'unconditional'}`);
    console.log(`  Use: faction/accept_peace id=${d.faction_id || ''}`);
  },

  base_raid_update: (d, t) => {
    console.log(`${c.dim}[${t}]${c.reset} ${c.red}[RAID]${c.reset} ${d.base_name || 'base'}: ${d.current_health || 0}/${d.max_health || 0} HP (-${d.damage_per_tick || 0}/tick)`);
  },

  base_destroyed: (d, t) => {
    console.log(`${c.dim}[${t}]${c.reset} ${c.red}${c.bright}[BASE DESTROYED]${c.reset} ${d.base_name || 'base'} has been destroyed!`);
    if (d.wreck_id) console.log(`  Wreck ID for looting: ${d.wreck_id}`);
  },

  friend_request: (d, t) => {
    console.log(`${c.dim}[${t}]${c.reset} ${c.cyan}[FRIEND]${c.reset} ${d.from_name || 'Someone'} sent you a friend request`);
  },

  system: (d, t) => {
    if (d.type === 'gameplay_tip') {
      console.log(`${c.dim}[${t}]${c.reset} ${c.yellow}[TIP]${c.reset} ${d.message || 'Tip'}`);
    } else {
      console.log(`${c.dim}[${t}]${c.reset} ${c.magenta}[SYSTEM]${c.reset} ${d.message || JSON.stringify(d)}`);
    }
  },

  action_result: (d, t) => {
    console.log(`${c.dim}[${t}]${c.reset} ${c.green}[ACTION]${c.reset} ${c.bright}${d.command}${c.reset} completed (tick ${d.tick || '?'})`);
    if (d.result && typeof d.result === 'object') {
      const result = d.result as Record<string, unknown>;
      if (result.message) {
        console.log(`  ${result.message}`);
      } else {
        for (const [key, value] of Object.entries(result)) {
          console.log(`  ${key}: ${JSON.stringify(value)}`);
        }
      }
    }
  },

  action_error: (d, t) => {
    console.log(`${c.dim}[${t}]${c.reset} ${c.red}[ACTION FAILED]${c.reset} ${c.bright}${d.command}${c.reset} failed (tick ${d.tick || '?'}): ${d.message || d.code || 'unknown error'}`);
  },

  poi_arrival: (d, t) => {
    const tag = d.clan_tag ? `[${d.clan_tag}] ` : '';
    console.log(`${c.dim}[${t}]${c.reset} ${c.green}[ARRIVAL]${c.reset} ${tag}${d.username || 'Someone'} has arrived at ${d.poi_name || 'this POI'}`);
  },

  poi_departure: (d, t) => {
    const tag = d.clan_tag ? `[${d.clan_tag}] ` : '';
    console.log(`${c.dim}[${t}]${c.reset} ${c.yellow}[DEPARTURE]${c.reset} ${tag}${d.username || 'Someone'} has departed from ${d.poi_name || 'this POI'}`);
  },
};

interface Notification {
  type?: string;
  msg_type?: string;
  timestamp?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export function displayNotifications(notifications?: Notification[]): void {
  if (!notifications?.length) return;

  for (const n of notifications) {
    const data = (n.data || {}) as NotificationData;
    const time = n.timestamp ? new Date(n.timestamp).toLocaleTimeString() : '??:??';
    const type = n.msg_type || n.type || 'unknown';
    const handler = handlers[type];

    if (handler) {
      try {
        handler(data, time);
      } catch {
        // Handler crashed on malformed data — show raw fallback
        console.log(`${c.dim}[${time}]${c.reset} ${c.magenta}[${type.toUpperCase()}]${c.reset} ${JSON.stringify(data)}`);
      }
    } else {
      const message = data.message;
      if (message) {
        console.log(`${c.dim}[${time}]${c.reset} ${c.magenta}[${type.toUpperCase()}]${c.reset} ${message}`);
      } else {
        console.log(`${c.dim}[${time}]${c.reset} ${c.magenta}[${type.toUpperCase()}]${c.reset}`);
        for (const [key, value] of Object.entries(data)) {
          console.log(`  ${key}: ${JSON.stringify(value)}`);
        }
      }
    }
  }
}

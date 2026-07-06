import { describe, test, expect } from 'bun:test';
import type {
  ServerEvent,
  RawServerFrame,
  WelcomePayload,
  LoggedInPayload,
  RegisteredPayload,
  ErrorPayload,
} from '../src/socket-types.ts';
import type {
  NotificationChatMessage,
  NotificationBattleUpdate,
  NotificationCraftingUpdate,
  NotificationMarketUpdate,
  NotificationMiningYield,
  NotificationObservationUpdate,
  NotificationPilotlessShip,
  NotificationPlayerDied,
  NotificationReconnected,
  NotificationScanDetected,
  NotificationSkillLevelUp,
  NotificationTradeOfferReceived,
} from '../src/generated';

// --- compile-time exact-equality helpers (no deps; mirrors tsd's IsExact) ---
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type PayloadOf<K extends string> = Extract<ServerEvent, { type: K }>['payload'];

// §7 game-event mapping: each payload is EXACTLY the generated Notification* type.
// A drift in the generated types turns these into `bun run typecheck:socket` errors.
type _battle = Expect<Equal<PayloadOf<'battle_update'>, NotificationBattleUpdate>>;
type _died = Expect<Equal<PayloadOf<'player_died'>, NotificationPlayerDied>>;
type _scanDetected = Expect<Equal<PayloadOf<'scan_detected'>, NotificationScanDetected>>;
type _pilotless = Expect<Equal<PayloadOf<'pilotless_ship'>, NotificationPilotlessShip>>;
type _reconnected = Expect<Equal<PayloadOf<'reconnected'>, NotificationReconnected>>;
type _mining = Expect<Equal<PayloadOf<'mining_yield'>, NotificationMiningYield>>;
type _chat = Expect<Equal<PayloadOf<'chat_message'>, NotificationChatMessage>>;
type _trade = Expect<Equal<PayloadOf<'trade_offer_received'>, NotificationTradeOfferReceived>>;
type _skill = Expect<Equal<PayloadOf<'skill_level_up'>, NotificationSkillLevelUp>>;
type _market = Expect<Equal<PayloadOf<'market_update'>, NotificationMarketUpdate>>;
type _observation = Expect<Equal<PayloadOf<'observation_update'>, NotificationObservationUpdate>>;
type _crafting = Expect<Equal<PayloadOf<'crafting_update'>, NotificationCraftingUpdate>>;

// control frames resolve to the hand-written payload shapes.
type _welcome = Expect<Equal<PayloadOf<'welcome'>, WelcomePayload>>;
type _loggedIn = Expect<Equal<PayloadOf<'logged_in'>, LoggedInPayload>>;
type _registered = Expect<Equal<PayloadOf<'registered'>, RegisteredPayload>>;
type _error = Expect<Equal<PayloadOf<'error'>, ErrorPayload>>;
type _actionError = Expect<Equal<PayloadOf<'action_error'>, ErrorPayload>>;

// forward-compat: unknown frame types are typed via RawServerFrame (the runtime still
// delivers them); they are intentionally NOT part of the closed ServerEvent union.
type _forwardCompat = Expect<
  { type: 'totally_new_frame_type'; payload?: unknown } extends RawServerFrame ? true : false
>;
type _closedUnion = Expect<
  { type: 'totally_new_frame_type'; payload?: unknown } extends ServerEvent ? false : true
>;

// Reference the alias types so tsc treats them as used (they are the real test).
export type _SocketTypeAssertions = [
  _battle, _died, _scanDetected, _pilotless, _reconnected, _mining,
  _chat, _trade, _skill, _market, _observation, _crafting,
  _welcome, _loggedIn, _registered, _error, _actionError, _forwardCompat, _closedUnion,
];

describe('socket-types', () => {
  test('§7 payload mapping is enforced at compile time (run: bun run typecheck:socket)', () => {
    // The real assertions are the Expect<Equal<...>> aliases above. They fail
    // `bun run typecheck:socket` if a generated Notification* type drifts from §7.
    // This runtime case just keeps the file a valid `bun test` target.
    expect(true).toBe(true);
  });
});

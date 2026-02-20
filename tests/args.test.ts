import { describe, test, expect } from 'bun:test';
import { parseArgs, coerceValue } from '../src/args.ts';
import type { CommandMeta } from '../src/commands.ts';

const spacemoltMeta: CommandMeta = {
  toolGroup: 'spacemolt',
  action: 'travel',
  operationId: 'spacemolt_travel',
  summary: 'travel',
  params: [
    { name: 'id', type: 'string', description: '', required: false, positionalIndex: 0 },
    { name: 'quantity', type: 'integer', description: '', required: false, positionalIndex: 1 },
    { name: 'text', type: 'string', description: '', required: false, positionalIndex: 2 },
  ],
  isAmbiguous: false,
};

const marketMeta: CommandMeta = {
  toolGroup: 'spacemolt_market',
  action: 'create_sell_order',
  operationId: 'spacemolt_market_create_sell_order',
  summary: 'create_sell_order',
  params: [
    { name: 'item_id', type: 'string', description: '', required: false, positionalIndex: 0 },
    { name: 'quantity', type: 'integer', description: '', required: false, positionalIndex: 1 },
    { name: 'price', type: 'integer', description: '', required: false, positionalIndex: 2 },
    { name: 'order_id', type: 'string', description: '', required: false, positionalIndex: -1 },
  ],
  isAmbiguous: true,
};

const chatMeta: CommandMeta = {
  toolGroup: 'spacemolt_social',
  action: 'chat',
  operationId: 'spacemolt_social_chat',
  summary: 'chat',
  params: [
    { name: 'target', type: 'string', description: '', required: false, positionalIndex: 0 },
    { name: 'content', type: 'string', description: '', required: false, positionalIndex: 1 },
    { name: 'title', type: 'string', description: '', required: false, positionalIndex: 2 },
  ],
  isAmbiguous: false,
};

describe('parseArgs', () => {
  test('positional args map to params by index', () => {
    const result = parseArgs(['travel', 'sol_belt'], spacemoltMeta);
    expect(result.command).toBe('travel');
    expect(result.payload).toEqual({ id: 'sol_belt' });
  });

  test('multiple positional args', () => {
    const result = parseArgs(['create_sell_order', 'ore_iron', '10', '50'], marketMeta);
    expect(result.payload).toEqual({ item_id: 'ore_iron', quantity: 10, price: 50 });
  });

  test('key=value args', () => {
    const result = parseArgs(['travel', 'id=sol_belt'], spacemoltMeta);
    expect(result.payload).toEqual({ id: 'sol_belt' });
  });

  test('mixed positional and key=value', () => {
    const result = parseArgs(['create_sell_order', 'ore_iron', 'quantity=10', 'price=50'], marketMeta);
    expect(result.payload).toEqual({ item_id: 'ore_iron', quantity: 10, price: 50 });
  });

  test('integer type coercion from positional', () => {
    const result = parseArgs(['travel', 'sol_belt', '5'], spacemoltMeta);
    expect(result.payload).toEqual({ id: 'sol_belt', quantity: 5 });
  });

  test('integer type coercion from key=value', () => {
    const result = parseArgs(['travel', 'quantity=10'], spacemoltMeta);
    expect(result.payload).toEqual({ quantity: 10 });
  });

  test('rest arg: last positional consumes remaining args', () => {
    const result = parseArgs(['chat', 'local', 'hello', 'world', 'how', 'are', 'you'], chatMeta);
    expect(result.payload).toEqual({ target: 'local', content: 'hello world how are you' });
  });

  test('no args returns empty payload', () => {
    const result = parseArgs(['travel'], spacemoltMeta);
    expect(result.payload).toEqual({});
  });

  test('null meta returns empty payload', () => {
    const result = parseArgs(['unknown', 'arg1', 'arg2'], null);
    expect(result.payload).toEqual({});
  });
});

describe('coerceValue', () => {
  test('integer conversion', () => {
    expect(coerceValue('42', 'integer')).toBe(42);
  });

  test('NaN integer stays as string', () => {
    expect(coerceValue('not_a_number', 'integer')).toBe('not_a_number');
  });

  test('boolean true', () => {
    expect(coerceValue('true', 'boolean')).toBe(true);
  });

  test('boolean false', () => {
    expect(coerceValue('false', 'boolean')).toBe(false);
  });

  test('non-boolean string stays as string', () => {
    expect(coerceValue('yes', 'boolean')).toBe('yes');
  });

  test('string type passes through', () => {
    expect(coerceValue('hello', 'string')).toBe('hello');
  });
});

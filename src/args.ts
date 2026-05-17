import type { ParamDef, CommandMeta } from './commands.ts';

export interface ParsedArgs {
  command: string;
  payload: Record<string, unknown>;
}

/**
 * Parse CLI arguments into a command name and typed payload.
 *
 * Supports:
 *   spacemolt travel sol_belt          (positional)
 *   spacemolt travel id=sol_belt       (key=value)
 *   spacemolt chat local hello world   (rest arg — last positional consumes remaining)
 *   spacemolt market/view_market       (qualified command for ambiguous names)
 */
export function parseArgs(argv: string[], meta: CommandMeta | null): ParsedArgs {
  const command = argv[0] || '';
  const rest = argv.slice(1);

  if (!meta || rest.length === 0) {
    // Check for required params even with no args provided
    if (meta) {
      const missing = meta.params.filter(p => p.required).map(p => p.name);
      if (missing.length > 0) {
        throw new ArgError(`Missing required parameter${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);
      }
    }
    return { command, payload: {} };
  }

  const payload: Record<string, unknown> = {};
  const positionalParams = meta.params
    .filter(p => p.positionalIndex >= 0)
    .sort((a, b) => a.positionalIndex - b.positionalIndex);

  // Separate key=value args from positional args
  const positionalArgs: string[] = [];
  for (const arg of rest) {
    const eqIdx = arg.indexOf('=');
    if (eqIdx > 0) {
      const key = arg.slice(0, eqIdx);
      const value = arg.slice(eqIdx + 1);
      const paramDef = meta.params.find(p => p.name === key);
      payload[key] = coerceValue(value, paramDef?.type || 'string');
    } else {
      positionalArgs.push(arg);
    }
  }

  // Map positional args to params.
  // When there are more positional args than remaining params,
  // the second-to-last string param consumes extras (rest arg behavior for chat, forum, etc.)
  const remainingParams = positionalParams.filter(p => !(p.name in payload));
  let paramIdx = 0;

  for (let i = 0; i < positionalArgs.length; i++) {
    if (paramIdx >= remainingParams.length) {
      // Extra positional — use 'id' as fallback (matches v1 behavior)
      if (!('id' in payload)) {
        payload['id'] = positionalArgs[i];
      }
      continue;
    }

    const param = remainingParams[paramIdx];
    const argsLeft = positionalArgs.length - i;
    const paramsLeft = remainingParams.length - paramIdx;

    // Rest arg: if we have more args than params and this isn't the first param,
    // this string param consumes ALL remaining args.
    // e.g., "chat local hello world" → target="local", content="hello world"
    // If someone needs later params (like title), they use key=value syntax.
    if (argsLeft > paramsLeft && param.type === 'string' && paramIdx > 0) {
      payload[param.name] = positionalArgs.slice(i).join(' ');
      break; // consumed everything
    } else {
      payload[param.name] = coerceValue(positionalArgs[i], param.type);
      paramIdx++;
    }
  }

  // Validate required params are present
  const missing = meta.params.filter(p => p.required && !(p.name in payload)).map(p => p.name);
  if (missing.length > 0) {
    throw new ArgError(`Missing required parameter${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);
  }

  return { command, payload };
}

/** Error thrown for argument validation failures (missing required params, bad types) */
export class ArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArgError';
  }
}

export function coerceValue(value: string, type: string): unknown {
  switch (type) {
    case 'integer': {
      const n = parseInt(value, 10);
      if (isNaN(n)) {
        throw new ArgError(`Invalid integer value: "${value}"`);
      }
      return n;
    }
    case 'number': {
      const n = parseFloat(value);
      if (isNaN(n)) {
        throw new ArgError(`Invalid number value: "${value}"`);
      }
      return n;
    }
    case 'boolean':
      if (value === 'true') return true;
      if (value === 'false') return false;
      throw new ArgError(`Invalid boolean value: "${value}" (use "true" or "false")`);
    default:
      return value;
  }
}

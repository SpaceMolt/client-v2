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

  return { command, payload };
}

export function coerceValue(value: string, type: string): unknown {
  switch (type) {
    case 'integer':
    case 'number': {
      const n = parseInt(value, 10);
      return isNaN(n) ? value : n;
    }
    case 'boolean':
      if (value === 'true') return true;
      if (value === 'false') return false;
      return value;
    default:
      return value;
  }
}

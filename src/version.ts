// Single source of truth for the package version, inlined from package.json.
// Deliberately node-free (no path/process) so the library declaration build
// (tsconfig.lib.json, which runs with `types: []`) can include it via the
// import graph — see sdk-socket.ts, which needs VERSION for the socket User-Agent.
import pkg from '../package.json';

export const VERSION: string = pkg.version;

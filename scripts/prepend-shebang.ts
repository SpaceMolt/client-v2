#!/usr/bin/env bun
/**
 * Ensures dist/cli.js begins with #!/usr/bin/env bun.
 * bun build --target bun preserves the shebang from the entry point, but
 * this script is a safety net in case the output is missing it.
 */

import { resolve } from "path";

const SHEBANG = "#!/usr/bin/env bun\n";
const cliPath = resolve(import.meta.dir, "../dist/cli.js");

const content = await Bun.file(cliPath).text();

if (!content.startsWith("#!/")) {
  await Bun.write(cliPath, SHEBANG + content);
  console.log("prepend-shebang: added shebang to dist/cli.js");
} else {
  console.log("prepend-shebang: shebang already present in dist/cli.js");
}

import { runDoctor } from "./lib/io.mjs";
import { runLifecycle as main } from "./lib/lifecycle.mjs";

// Explicit lifecycle records (docs/development/audit-emission.md). The model does not write the audit.
runDoctor(main, import.meta.url);

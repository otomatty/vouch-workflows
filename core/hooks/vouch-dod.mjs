import { runDod as main } from "./lib/dod.mjs";
import { runDoctor } from "./lib/io.mjs";

// Manual command for the Build DoD (docs/development/git-guard.md). It does not consume a harness event.
runDoctor(main, import.meta.url);

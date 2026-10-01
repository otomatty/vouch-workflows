import { runDoctor } from "./lib/io.mjs";
import { runMigrate as main } from "./lib/migrate.mjs";

// Manual command archiving and converting a v2 record (docs/development/migrate.md).
runDoctor(main, import.meta.url);

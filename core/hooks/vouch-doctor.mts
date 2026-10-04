import { inspectInstallation as main } from "./lib/doctor.mjs";
import { runDoctor } from "./lib/io.mjs";

// Manual command required by DIST-5. It does not consume a harness event.
runDoctor(main, import.meta.url);

import { runDoctor } from "./lib/io.mjs";
import { runReport as main } from "./lib/report.mjs";

// Manual read-only command aggregating measured audit values (docs/development/resume.md).
runDoctor(main, import.meta.url);

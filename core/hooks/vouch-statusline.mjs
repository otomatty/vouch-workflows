import { runStatusline } from "./lib/io.mjs";
import { showStatusline as main } from "./lib/resume.mjs";

// Read-only statusline for the explicitly configured Intent (docs/development/resume.md).
runStatusline(main, import.meta.url);

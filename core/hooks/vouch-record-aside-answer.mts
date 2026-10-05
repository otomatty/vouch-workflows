import { recordAsideAnswer as main } from "./lib/aside.mjs";
import { run } from "./lib/io.mjs";

// Stop: the asking turn's answer is appended to its aside.asked; never blocks.
run(main);

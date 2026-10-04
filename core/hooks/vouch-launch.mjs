import { runLauncher } from "./lib/io.mjs";
import { launch } from "./lib/launch.mjs";

runLauncher(import.meta.url, launch);

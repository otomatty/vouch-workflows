import { runDoctor } from "./lib/io.mjs";
import { runQuestion as main } from "./lib/question.mjs";

// Manual command recording a question's ask or applied default (docs/development/resume.md).
runDoctor(main, import.meta.url);

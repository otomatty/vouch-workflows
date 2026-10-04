import { run } from "node:test";
import { spec } from "node:test/reporters";

// CLI glob discovery sorts file arguments. The public API preserves our supplied order.
const options = /** @type {import('node:test').RunOptions} */ (
  JSON.parse(process.argv[2] ?? "{}")
);
run({ ...options, isolation: "process" })
  .on("test:summary", ({ success }) => {
    if (!success) process.exitCode = 1;
  })
  .compose(spec)
  .pipe(process.stdout);

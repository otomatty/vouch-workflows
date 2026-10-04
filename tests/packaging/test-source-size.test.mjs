import { resolve } from "node:path";
import { testPhases } from "../../scripts/lib/test-phases.mjs";
import * as source from "../../scripts/lib/test-source-size.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";

test("ordinary source estimates include shared helper bodies once, handle cycles and retain every file", (t) => {
  const root = resolve("fixture/test-source-size");
  const helpers = resolve(root, "helpers");
  const wrapper = resolve(root, "scenario/wrapper.test.mjs");
  const plain = resolve(root, "scenario/plain.test.mjs");
  const shared = resolve(helpers, "shared.mjs");
  const nested = resolve(helpers, "nested.mjs");
  const texts = new Map([
    [wrapper, "import { run } from '../helpers/shared.mjs'; run();"],
    [plain, `// ordinary file ${"x".repeat(100)}`],
    [
      shared,
      `import './nested.mjs'; import './nested.mjs';\n// ${"heavy".repeat(100)}`,
    ],
    [nested, "import './shared.mjs'; // 循環\n"],
  ]);
  const reads = new Map();
  const sizes = source.testSourceSizes([wrapper, plain], helpers, (path) => {
    reads.set(path, (reads.get(path) ?? 0) + 1);
    return texts.get(path) ?? t.assert.fail(`unexpected read: ${path}`);
  });
  t.assert.equal(
    sizes.get(wrapper),
    [wrapper, shared, nested].reduce(
      (sum, path) => sum + Buffer.byteLength(texts.get(path) ?? ""),
      0,
    ),
  );
  t.assert.equal(sizes.get(plain), Buffer.byteLength(texts.get(plain) ?? ""));
  t.assert.deepEqual([...reads.values()], [1, 1, 1, 1]);
  t.assert.deepEqual(testPhases("integration", [plain, wrapper], 4, sizes), [
    { files: [wrapper, plain], concurrency: 4, budget: false },
  ]);
});

test("source estimates never evaluate imports or traverse packages, products, JSON or escaped helper paths", (t) => {
  const root = resolve("fixture/test-source-size");
  const helpers = resolve(root, "helpers");
  const file = resolve(root, "scenario/entry.test.mjs");
  const text = `
import 'node:fs';
import 'package.mjs';
import '../core/product.mjs';
import '../helpers/../outside.mjs';
import '../helpers/data.json' with { type: 'json' };
throw new Error('source must never execute');
`;
  let reads = 0;
  const sizes = source.testSourceSizes([file], helpers, (path) => {
    reads++;
    t.assert.equal(path, file);
    return text;
  });
  t.assert.equal(reads, 1);
  t.assert.equal(sizes.get(file), Buffer.byteLength(text));
});

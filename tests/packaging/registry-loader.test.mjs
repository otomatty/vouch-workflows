import { spawnSync } from "node:child_process";
import { hookTest as test } from "../helpers/hook-test.mjs";

const base = `
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {memoryFiles} = await import('./tests/helpers/runtime.mjs');
const loaded = () => Object.keys(require.cache).some(path => path.replaceAll(String.fromCharCode(92), '/').includes('/node_modules/ajv/'));
const before = loaded();
`;

test("filesystem helper imports do not load the schema compiler", (t) => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `${base}
process.stdout.write(JSON.stringify({before, after: loaded(), text: await memoryFiles({kept:'original'}).readText('kept')}));
`,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 4000 },
  );
  t.assert.equal(result.status, 0, result.stderr);
  t.assert.deepEqual(JSON.parse(result.stdout), {
    before: false,
    after: false,
    text: "original",
  });
});

test("requesting validation loads the strict compiler once and checks each input", (t) => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `${base}
const {validator} = await import('./tests/helpers/registry.mjs');
const validate = validator('doctor-report');
const valid = {v:1,ok:true,checks:[{id:'DOCTOR-NODE',ok:true,detail:'supported'}]};
process.stdout.write(JSON.stringify({before, after:loaded(), same:validator('doctor-report')===validate, verdicts:[validate(valid), validate({...valid,ok:'invalid'}), validate(valid)]}));
`,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 4000 },
  );
  t.assert.equal(result.status, 0, result.stderr);
  t.assert.deepEqual(JSON.parse(result.stdout), {
    before: false,
    after: true,
    same: true,
    verdicts: [true, false, true],
  });
});

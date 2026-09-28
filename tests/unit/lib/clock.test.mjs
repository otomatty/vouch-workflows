import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import {
  elapsedMilliseconds,
  newId,
  now,
  sha256Hex,
} from "../../../core/hooks/lib/clock.mjs";

test("clock reports UTC using the supplied test clock", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1790467200000 });
  t.plan(1);
  t.assert.equal(now(), "2026-09-27T00:00:00.000Z");
});
test("event identity is stable and separates sessions and ambiguous components", (t) => {
  t.plan(4);
  t.assert.equal(newId("session", "input"), newId("session", "input"));
  t.assert.notEqual(newId("session", "input"), newId("other", "input"));
  t.assert.notEqual(newId("a:b", "c"), newId("a", "b:c"));
  t.assert.match(newId("session", "input"), /^evt_[a-f0-9]{64}$/);
});

test("event identity is the SHA-256 of the JSON pair", (t) => {
  t.plan(1);
  t.assert.equal(
    newId("session", "input"),
    `evt_${createHash("sha256").update('["session","input"]').digest("hex")}`,
  );
});

test("sha256Hex matches the FIPS 180-4 examples", (t) => {
  const examples = [
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    ],
  ];
  t.plan(examples.length);
  for (const [text, digest] of examples)
    t.assert.equal(sha256Hex(Buffer.from(String(text), "utf8")), digest);
});

test("sha256Hex equals node:crypto across block boundaries and large inputs", (t) => {
  const sizes = [
    ...Array.from({ length: 301 }, (_, size) => size),
    511,
    512,
    513,
    1000,
    4095,
    4096,
    65535,
    65536,
    100000,
    1024 * 1024,
  ];
  t.plan(sizes.length);
  for (const size of sizes) {
    const bytes = randomBytes(size);
    t.assert.equal(
      sha256Hex(bytes),
      createHash("sha256").update(bytes).digest("hex"),
      `${size} bytes`,
    );
  }
});

test("elapsed UTC milliseconds validate calendar dates and time ordering", (t) => {
  const valid = [
    ["2024-02-29T23:59:59.9Z", "2024-03-01T00:00:00Z", 100],
    ["2026-09-27T00:00:00.01Z", "2026-09-27T00:00:00.011Z", 1],
    ["0000-01-01T00:00:00Z", "0000-01-01T00:00:00.000Z", 0],
    ["2026-09-27T00:00:00Z", "2026-09-27T00:00:01.050Z", 1050],
  ];
  const invalid = [
    "",
    "garbage",
    "2026-02-29T00:00:00Z",
    "2026-02-30T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-00-01T00:00:00Z",
    "2026-01-00T00:00:00Z",
    "2026-01-32T00:00:00Z",
    "2026-09-27T24:00:00Z",
    "2026-09-27T00:60:00Z",
    "2026-09-27T00:00:60Z",
    "2026-09-27T00:00:00.0001Z",
    "2026-09-27T00:00:00",
    "2026-09-27T00:00:00+00:00",
    "2026-09-27T00:00:00Z\n",
  ];
  t.plan(valid.length + invalid.length * 2 + 3);
  t.assert.equal(elapsedMilliseconds("1970-01-01T00:00:00Z", "invalid"), null);
  t.assert.equal(elapsedMilliseconds("1969-12-31T23:59:59Z", "invalid"), null);
  for (const [start, end, expected] of valid)
    t.assert.equal(elapsedMilliseconds(String(start), String(end)), expected);
  for (const stamp of invalid) {
    t.assert.equal(
      elapsedMilliseconds(stamp, "2026-09-27T00:00:00Z"),
      null,
      stamp,
    );
    t.assert.equal(
      elapsedMilliseconds("2026-09-27T00:00:00Z", stamp),
      null,
      stamp,
    );
  }
  t.assert.equal(
    elapsedMilliseconds("2026-09-27T00:00:00.001Z", "2026-09-27T00:00:00Z"),
    null,
  );
});

import { test } from "node:test";
import {
  dated,
  digest,
  read,
  section,
  updated,
} from "../../../core/hooks/lib/knowledge.mjs";
import { date, document, knowledgeProject } from "../../helpers/knowledge.mjs";

test("shared knowledge format rejects ambiguous dates, sections and boundary paths", async (t) => {
  const { ctx } = knowledgeProject();
  t.assert.equal(dated(date, ctx), true);
  t.assert.equal(dated("2026-02-30", ctx), false);
  t.assert.equal(updated(document), date);
  t.assert.equal(updated("No frontmatter"), null);
  t.assert.equal(
    updated(
      document.replace(
        `updated: ${date}`,
        `updated: ${date}\nupdated: ${date}`,
      ),
    ),
    null,
  );
  t.assert.equal(
    section("<!-- sec:main -->\ncontent\n<!-- sec:other -->\nrest", "sec:main"),
    "content",
  );
  t.assert.equal(
    section("<!-- sec:main -->\nfirst\n<!-- sec:main -->\nsecond", "sec:main"),
    "",
  );
  t.assert.match(digest(document), /^[a-f0-9]{64}$/);
  await t.assert.rejects(read("../escape", ctx), /boundary/);
  await t.assert.rejects(read("absent", ctx), /missing/);
});

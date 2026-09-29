---
language: en
checkpoints: topic
---

# Project rules

<!-- sec:configuration -->
## Configuration

Choose language and checkpoints from workflow.json. Fill in project-specific entries when adopting this file. An unconfigured entry does not mean that validation passed or approval was granted.

<!-- sec:dod -->
## Definition of done

| Target | Command and working directory | Pass condition | Evidence location |
| --- | --- | --- | --- |
| Dependency audit at every risk tier | Unconfigured | Unconfigured | Unconfigured |

Add tests, static analysis and application checks tied to acceptance criteria. Explain omitted checks and provide alternative evidence. Do not report an unconfigured command as executed. Basis: decision record §7, §8 and §18 Q3.
Write the command and its working directory (relative to the root; the root when omitted) as separate inline code, and escape `|` in the table as `\|`. During Build, `node {{HARNESS_DIR}}/hooks/vouch-dod.mjs` runs these commands and records their output and results in build-log.md and the audit log. Exit code 0 passes; the model analyzes and fixes failures.

<!-- sec:restrictions -->
## Restrictions and scope [R-PROJECT-4]

Apply the shared AGENTS.md rules. Record the target, rationale and exception owner for any project-specific restriction. Do not invent additional restrictions without a basis. [R-PROJECT-4]

| Target | Restriction | Rationale | Exception owner |
| --- | --- | --- | --- |
| Unconfigured | Unconfigured | Unconfigured | Unconfigured |

<!-- sec:dependencies -->
## Dependency rules

Record dependencies, reasons for additions or updates, and license and vulnerability checks. Distinguish runtime from development dependencies. Put the audit command in the definition of done. Basis: decision record §18 Q3.

<!-- sec:checkpoints -->
## Checkpoints

The default checkpoints mode is topic. Use topic_checkpoints in workflow.json for topics and conditions. Add the Unit checkpoint in high_risk_adds for tier H. Define the scope when selecting unit or section. Record decisions in decisions.md in the person's words; do not supplement the audit log by hand. [R-PROJECT-3]

<!-- sec:corrections -->
## Corrections

| Learning or correction | Supporting reference | Adopted rule and scope | Adoption decision |
| --- | --- | --- | --- |
| Unconfigured | Unconfigured | Unconfigured | Unconfigured |

Distinguish proposals from adopted rules. Do not treat an unadopted proposal as approved. [R-PROJECT-1]

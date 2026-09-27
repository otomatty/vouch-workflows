# Decision record

Q-n / D-n are slots, not claims that a question, answer or decision occurred. Preserve existing IDs and add new records. Hooks write the audit log. This document does not prove that audit events were recorded. [R-PROJECT-3]

<!-- sec:questions -->
## Decision requests

### Q-n: Unfilled

<!-- question:situation -->
Situation and references: What is undecided and how does it work now? If asking again after a change, cite the original Q-n and explain the changed premise.

<!-- question:options -->
Use question_options in intent-authoring.json for the option count. Consider doing nothing; explain why if it is not included.

| Option <!-- option:option --> | Benefits <!-- option:benefits --> | Drawbacks <!-- option:drawbacks --> | Basis <!-- option:basis --> |
| --- | --- | --- | --- |
| A: Unfilled | Unfilled | Unfilled | Unfilled |
| B: Unfilled | Unfilled | Unfilled | Unfilled |

<!-- question:recommendation -->
Recommendation and reason: Undecided. Support it with code path:line@commit or an official URL plus section. Label hypotheses as hypotheses. [R-PROJECT-2]

<!-- question:default -->
Default when unanswered: Undecided. Explain if no workable default exists. Distinguish applying a default from a human answer or approval and carry it to Brief §7. [R-PROJECT-6]

<!-- question:impact -->
Blocking and impact: Affected Units, what stops and what can continue. Carry deferred decision requests to Brief §6.

<!-- question:answer -->
Human answer and source: Unanswered. Preserve the actual words, target revision and source; do not present a model paraphrase as a human statement. Approval authenticity checks are not implemented. [R-PROJECT-1] [R-PROJECT-2]

<!-- sec:decisions -->
## Decisions and rejected alternatives

| ID <!-- decision:id --> | Actor <!-- decision:actor --> | Decision or human words <!-- decision:words --> | Source and basis <!-- decision:source --> | Target and revision <!-- decision:scope --> | Related Q-n <!-- decision:question --> |
| --- | --- | --- | --- | --- | --- |
| D-n | Unfilled; distinguish human and model | Unfilled | Unfilled | Unfilled | Fill in if applicable |

Distinguish human adoption, model proposals or decisions, and rejected alternatives with their reasons. Do not substitute this record for an approval event or approved status. [R-PROJECT-1]

<!-- sec:assumptions -->
## Assumptions, unanswered questions and defaults

| Related Q-n / D-n | Assumption or applied default | Basis and impact | Human response state | Reconsideration condition |
| --- | --- | --- | --- | --- |
| Unfilled | Unfilled | Unfilled | Record whether an answer was actually received | Unfilled |

Applying a default does not answer the question. If a person overturns it, preserve the original record and add the change. [R-PROJECT-6]

<!-- sec:references -->
## References

Fill in actual code path:line@commit, document#section@date, official URL plus section and sources of statements. Do not invent supporting references. [R-PROJECT-2]

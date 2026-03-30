# Representative Prompts

These are representative prompts and task requests used during development and submission prep. They are included to show how AI assistance was directed.

## Build Prompt

- Build a claims processing system for an insurance company with members, policies, claims, line items, adjudication, claim and line-item state machines, explanations, and disputes.

## Modeling And Behavior Prompts

- Model coverage rules using policy-scoped service rules with deductibles, coinsurance, yearly dollar caps, and yearly visit caps.
- Track benefit usage with accumulator entries rather than overwriting totals.
- Keep claim status derived from line-item states.
- Route near-cap partial payment cases to manual review.

## Review Prompts

- Compare the repository against the original take-home assignment and identify the gaps.
- Review whether the UI actually satisfies the documented API endpoints.
- Call out places where docs promise behavior that the code does not yet implement.

## Implementation Prompts

- Update the UI so the missing singleton endpoints are at least visible as JSON in the interface.
- Move the project from a `src/` folder to an `app/` folder.
- Build out the missing submission deliverables: README, self-review, AI artifacts, and refreshed docs.

## Documentation Prompts

- Write submission-ready documentation that matches the implemented process flow.
- Make the self-review honest about strengths, rough edges, and risks.
- Capture what AI got wrong and what was corrected manually.

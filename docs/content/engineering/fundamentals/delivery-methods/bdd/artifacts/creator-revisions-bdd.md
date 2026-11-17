# Creator Revisions — BDD

## Discovery

- **Actors:** proposal-booking customer, creator/provider, feature-gate service, completion worker.
- **Goal:** let the customer request a bounded revision after delivery, while preserving the existing delivery acceptance and payment flow.
- **Rules:** the feature defaults off; the customer must own an eligible proposal booking; a trimmed note is 5–1000 characters; the default allowance is two. A valid `{"type":"revisions","qty":N}` deliverable may set an allowance from 0 to 10.
- **Scope:** revision request, provider resubmission, and protection from stale auto-confirmation. Proposal composition changes and E2E wiring are out of scope.
- **Open questions:** none block this behavior.

## Scenarios

### CR-01 — Feature switch is off

```gherkin
Feature: Creator revisions
  Scenario: A customer cannot request a revision while the feature is disabled
    Given the creator_revisions feature switch is off
    And a proposal delivery is awaiting customer review
    When the customer requests a revision
    Then the request is refused with a clear disabled message
    And the booking and revision count remain unchanged
```

### CR-02 — Customer requests a valid revision

```gherkin
Feature: Creator revisions
  Scenario: An eligible customer sends a revision note
    Given the feature is enabled
    And the customer owns a proposal booking with submitted delivery
    And fewer than the allowed revisions have been used
    When the customer submits a note whose trimmed length is 5 to 1000 characters
    Then the trimmed note is recorded with the booking transition
    And the revision count increases by one
    And the booking returns to delivery_pending with delivery_status revision_requested
    And completion_requested_at is cleared
    And the provider is notified with the revision note
```

### CR-03 — Reject unauthorized, ineligible, or invalid requests

```gherkin
Feature: Creator revisions
  Scenario: A non-customer or invalid request is refused
    Given the feature is enabled
    And a provider or other non-owner calls the revision operation
    When the request is not from the booking customer, is not an eligible submitted proposal, or has an invalid note
    Then the request is refused
    And no revision is consumed
```

### CR-04 — Enforce the revision allowance

```gherkin
Feature: Creator revisions
  Scenario: The default allowance prevents a third revision
    Given a proposal has the default allowance of two revisions
    When the customer requests two revisions, with provider resubmission between them
    And the customer requests a third revision
    Then the third request is refused because no revisions remain
```

### CR-05 — Provider resubmits revised work

```gherkin
Feature: Creator revisions
  Scenario: The existing delivery submission path accepts a revision
    Given a proposal is in delivery_pending with delivery_status revision_requested
    When the provider submits valid delivery links
    Then delivery_status becomes submitted
    And the booking returns to completion_requested
    And completion_requested_at is set for the new review window
```

### CR-06 — Pending revisions are not auto-completed

```gherkin
Feature: Creator revisions
  Scenario: The completion worker ignores a pending revision
    Given a customer has requested a revision
    And the booking is in delivery_pending with completion_requested_at cleared
    When auto_confirm_completions runs
    Then the booking is not completed
```

## Automation readiness

| Scenario | Observable outcome | SQL evidence |
|---|---|---|
| CR-01 | Disabled message; no state change | `creator_revisions.test.mjs`: disabled-switch refusal assertion |
| CR-02 | Trimmed note, count 1, revision state, cleared timestamp, provider notification | SQL assertions for request state, booking event, and notification |
| CR-03 | Non-owner and too-short note are refused | Provider-refusal and short-note assertions |
| CR-04 | Two requests are allowed; third is refused; valid deliverable marker is retained | Default-limit and custom-allowance assertions |
| CR-05 | Provider resubmission returns to completion review | Resubmission assertion |
| CR-06 | Worker returns without completing pending revision | Auto-confirm assertion |

## Trace links

- DDD: [Creator Revisions — DDD](../../ddd/artifacts/creator-revisions-ddd.md)
- Traceability: [Creator Revisions — Traceability](../../bdd-ddd-tdd/artifacts/creator-revisions-traceability.md)

## Phase status

- **BDD:** scenarios defined.
- **DDD:** ownership and consistency boundaries are mapped.
- **TDD/implementation:** implementation and isolated SQL assertions are present; **CI validation is pending**.

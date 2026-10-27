# Testing

Part of the [knowledge graph](../../README.md), implementation layer.
Every file here but this one is a node of kind `testing`, named in kebab-case.

A testing node says what is tested where, the helpers, and the test-only sharp edges.
[`TESTING.md`](../../TESTING.md) says how to run the suites, and the [Google Form corpus](../../../back-end/tests/test_data/README.md) is their realistic data; both are testing nodes where they stand.
`describes` and `verified` are required.

## Nodes

One line per node, sorted by file name.

- [The assignment behaviour suite](assignment-behaviour-suite.md) - `test_assignment_behaviour.py`, the solver's behavioural suite; change placement against it
- [CI and the gate](ci-and-the-gate.md) - the CI jobs and the six required checks, Dependabot's update pull requests, the no-mistakes gate and `nm-test.sh`, stack identity
- [E2E patterns](e2e-patterns.md) - testids, page objects, fixtures, a market opened by URL, `mongoEval`, market dates and plans
- [E2E seeds](e2e-seeds.md) - verified users, markets in an organization, the seed helpers, reaching a stored assignment
- [Floorplan E2E](floorplan-e2e.md) - deterministic, no AI to mock; which canvas steps are real gestures, and the coverage gap
- [The market journey spec](the-market-journey-spec.md) - the one spec that walks the whole journey; the slices; where a new test belongs
- [Walking the flows](walking-the-flows.md) - the stack, accounts and fixtures a walk needs, which specs walk which flows, the test data recipes

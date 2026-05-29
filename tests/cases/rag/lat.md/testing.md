# Testing Strategy

All code must have tests before merging. We aim for 80% line coverage minimum.

## Unit Tests

We use vitest for fast isolated unit tests. Mocks are preferred over real dependencies. Tests run in parallel by default.

## Integration Tests

Integration tests run against a real PostgreSQL database provisioned in CI. Each test gets a fresh schema via migrations.

## Performance Tests

Load testing with k6 scripts that simulate realistic user traffic. We track p50, p95, and p99 latency over time.

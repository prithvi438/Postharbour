# Contributing

Start with [README.md](README.md), then [the architecture guide](docs/ARCHITECTURE.md).
Contributions should keep this project understandable to a beginner-to-intermediate
developer. Prefer explicit code and small modules to clever abstractions.

## Conventions

- Go: use `gofmt`, standard `net/http`, explicit dependencies, and context-aware calls.
- React: TypeScript, functional components, shared primitives, and ordinary CSS tokens.
- Comment every named function/component's purpose and explain non-obvious safety
  decisions. Comments should explain roles and reasons, not narrate each assignment.
- Centralize repeated behavior. Reuse the JSON client, async form, modal, validation,
  authorization, and provider helpers before creating alternatives.
- Keep secrets out of DTOs, logs, browser storage, fixtures, and screenshots.
- Do not bypass `AuthorizeTenant`, including for resource-ID-based lookups.
- Never replace a failed provider call with a fake success in live mode.
- Keep source formatting readable. Use `make fmt` for Go and `npm run format`
  inside `frontend` for React/CSS/configuration.

## Adding a capability

1. Define the user-visible behavior and permissions.
2. Add a new numbered SQL migration if the data model changes.
3. Implement the business rule in `internal/service`.
4. Add a thin API handler and update `docs/API.md`.
5. Extend `mail.Provider` only if the behavior belongs to the mail engine. Update
   both adapters and protocol contract tests.
6. Add TypeScript models and reuse the shared UI components.
7. Test the important failure/authorization boundary, not just a mock implementation.
8. Update README limitations, deployment guidance, and migration notes as needed.

## Pull requests

Describe the problem, resulting behavior, tests, and any migration/operational
impact. Run frontend tests/build and Go tests/vet with PostgreSQL integration
enabled. Include before/after screenshots for visual changes when possible. Use
disposable `.test` data for screenshots, not customer email addresses or credentials.

The repository includes a GitHub Actions workflow; it runs after you push this
project to your own repository. No remote repository or public deployment is
created automatically by this local project.

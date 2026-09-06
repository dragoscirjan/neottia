# Contributing to neottia

Contributions through issues and pull requests are welcome.

## Development setup

```bash
git clone https://github.com/dragoscirjan/neottia.git
cd neottia
mise trust
mise run deps:sync
mise run validate
```

Use `mise tasks` to see all project tasks.

## Development workflow

1. Create a branch from `main`.
2. Add tests for behavior changes.
3. Update documentation for API changes.
4. Run `mise run validate`.
5. Open a pull request.

Useful commands:

```bash
mise run run
mise run build
mise run test
mise run test:coverage
mise run format
mise run lint
mise run docs
```

## Code style

- Use TypeScript types and TSDoc for public APIs.
- Use kebab-case file names, camelCase functions and variables, and PascalCase classes.
- Colocate tests using the `.spec.ts` suffix.
- Follow existing ESLint and Prettier configuration.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/), for example:

```text
feat: add harness adapter
fix: handle empty configuration
```

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).

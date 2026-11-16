# Contributing

Open an issue describing the problem or submit a focused pull request. Use Node.js 22 or newer and run `npm test` and `npm run check` before submitting.

Keep runtime dependencies minimal. Add regression tests for security and protocol changes. Do not log credentials, allow arbitrary upstream URLs, retry mutations automatically, or commit keys. Use synthetic keys and mock network responses in tests.

Explain the behavior change and validation in the PR. Do not make live design mutations as a connectivity test. Contributions are provided under the repository's MIT license.

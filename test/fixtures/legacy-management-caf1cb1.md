# Legacy management fixture

`legacy-management-caf1cb1.tar.gz` is the unchanged tracked `src/`, `scripts/` and `package.json` source snapshot from this repository at commit `caf1cb1`. It contains no runtime profile, credential, task state or user session directory.

Created reproducibly with:

```sh
git archive caf1cb1 src scripts package.json | gzip -n > test/fixtures/legacy-management-caf1cb1.tar.gz
```

SHA-256: `dfe63b25cb80eda84d26b046aacf4c519ab2e98762d8db3b8f0e2a3f036f92f9`

`management-compat.test.mjs` verifies this digest and extracts the snapshot in a private temporary directory. Its old management launcher opens ephemeral loopback ports with synthetic tokens and isolated stores. The test uses the current installed dependencies, but does not modify the old source or require Git history at test time. It closes the old services before deleting their stores. This fixture is test-only and excluded from the native management plugin package.

<!-- dod -->
## DoD 2026-09-29T00:00:00.000Z

- Intent: `260929-plan`
- Commit: `cccccccccccccccccccccccccccccccccccccccc`
- Result: fail

### Unit tests

- Command: `node check.js`
- Directory: `.`
- Result: fail (exit 1, 5 ms)

```text
1 failing
AssertionError
```

### Lint

- Command: `npm run lint | cat`
- Directory: `packages/app`
- Result: pass (exit 0, 5 ms)

````text
clean ```code``` ok
````

### Dependency audit

- Result: unconfigured; not executed

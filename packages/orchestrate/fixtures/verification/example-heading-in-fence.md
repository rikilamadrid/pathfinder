# Reject empty input

## Context

A ticket's verification section looks like this:

```md
## Verification

- an example criterion that is not this ticket's
```

## Verification

- `npm test` passes
- an empty input is rejected with a clear error

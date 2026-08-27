# Contributing

Thanks for improving Krypton.

## Local setup

```bash
npm ci
cp .env.example .env.local
npm run relay
npm run dev -- --hostname 0.0.0.0
```

## Quality gates

Run these before opening a pull request:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Or run the combined command:

```bash
npm run ci
```

## Security-sensitive changes

Changes to `src/crypto/**`, vault storage, message wire formats, wallet signing, or the AI proxy should include tests and clear README updates. Prefer audited libraries over custom protocol code when moving beyond demo/research status.

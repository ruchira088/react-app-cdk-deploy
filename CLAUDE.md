# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build       # tsc → dist/ (declarations + inline sourcemaps)
npm run watch       # tsc -w
npm run typecheck   # tsc --noEmit -p tsconfig.test.json (type-checks src/ AND test/)
npm test            # typecheck, then jest
npm run lint        # does not exist — there is no linter in this repo
```

Running a subset of tests (note `npm test` always runs the typecheck first, so call `jest` directly to skip it):

```bash
npx jest test/deploy.test.ts          # one file
npx jest -t "feature branches"        # one describe/test by name
```

CI (`.github/workflows/build-pipeline.yml`) runs exactly `npm ci` → `npm run build` → `npm test`, so those three from a clean tree reproduce it.

## Dependencies

Node engine: `>=20`.

| Kind | Package | Range |
|---|---|---|
| peer | `aws-cdk-lib` | `^2.232.1` |
| peer | `constructs` | `^10.0.0` |
| runtime | `simple-git` | `^3.30.0` |
| dev | `typescript` | `~7.0.2` |
| dev | `@swc/core` | `^1.15.46` |
| dev | `@swc/jest` | `^0.2.39` |
| dev | `jest` | `^30.2.0` |
| dev | `@types/jest` | `^30.0.0` |
| dev | `@types/node` | `^24.10.1` |
| dev | `aws-cdk-lib`, `constructs` | mirror the peer ranges |

`aws-cdk-lib` and `constructs` are **peer** dependencies: consumers supply them, and they are duplicated in `devDependencies` only so this repo can build and test. Keep the two copies of each range in sync — a peer range the repo itself doesn't satisfy will pass CI and break consumers.

`simple-git` is the only thing shipped to consumers at runtime. `typescript` is a dev dependency but is still installed on the consumer's machine, because `prepare` compiles `dist/` at install time (see *Releasing*).

**Whenever you change a dependency or its version range, update the dependency table above *and* the `## Requirements` section in `README.md`.** The README states the peer ranges, the Node engine, and the `simple-git`/`typescript` versions to consumers; a bump that lands only in `package.json` leaves both documents lying. Also check the `allowScripts` map (below) if the changed dep has a postinstall.

## Toolchain constraints

**TypeScript 7 is the native (Go) compiler.** The `typescript` npm package no longer exposes the JavaScript compiler API. Consequences that are easy to trip over:

- `ts-jest` **cannot work** and was deliberately removed. Jest transpiles via `@swc/jest`, which strips types *without* type-checking. Type safety in tests comes solely from the separate `npm run typecheck` step — if you make `npm test` skip it, tests stop being type-checked. Don't reinstall ts-jest to "fix" a transform issue.
- Any tool needing `ts.transpileModule`/`ts.createProgram` needs `@typescript/typescript6` instead; `@typescript/native` does not exist on npm despite ts-jest's error message suggesting it.

**Install scripts are gated.** `package.json` has an `allowScripts` map; a new dependency with a postinstall (e.g. `@swc/core`) must be added there as `"name@exact.version": true` or its native binary won't link. The version is pinned exactly, so it needs updating when that dep is upgraded.

**Two tsconfigs.** `tsconfig.json` is the build config — it emits `src/` to `dist/` and *excludes* `test/`. `tsconfig.test.json` extends it with `noEmit` and widens `include` to both, adding `jest` types. Compiler-option changes usually belong in the base config.

## Architecture

A library, not an app: consumers import it, and their own CDK entrypoint calls into it. Two deliberately separated layers.

**`src/ReactSpaStack.ts`** — a pure CDK `Stack` with no environment or git awareness. Given `(scope, id, domain, {bucketName, zipObjectKey}, props?)` it wires: private S3 bucket (named after the domain) → CloudFront distribution behind an Origin Access Control → DNS-validated ACM certificate → Route53 A-alias, plus a `BucketDeployment` that unzips the artifact from a *separate, pre-existing* artifact bucket and invalidates `/*`.

Invariants enforced in the constructor and asserted in tests: `domain` must end with `ruchij.com` (the hosted zone is looked up for that parent), and `zipObjectKey` must end with `.zip`.

Two coupled details that look independent but are not:

- **Both 403 and 404 must map to `/index.html`.** OAC's generated bucket policy grants `s3:GetObject` only, so S3 reports a missing key as 403, not 404. Dropping the 403 response breaks every SPA deep link. (Under the previous OAI setup, `grantRead` included `s3:List*`, which is why 404-only worked then.)
- **`retainContent`** (on `ReactSpaStackProps`) drives *both* `removalPolicy` and `autoDeleteObjects`. `deploy.ts` sets it to `prefix == null`, so production retains and every ephemeral environment tears down.

**`src/naming.ts`** — `sanitizeLabel` reduces a branch name to something valid as a DNS label, S3 bucket name component, and CFN stack id simultaneously. The length budget is computed from the base domain (`63 - domainName.length - 1`) because the bucket is named after the *full* domain, and S3's 63-char bucket limit binds before DNS's per-label limit does. Truncation appends a hash of the original so names stay stable and collision-free across deploys.

**`src/deploy.ts`** — the orchestration layer. `deployReactSpa` resolves the branch (explicit `config.branch` → `GITHUB_REF_NAME` → git, throwing on a detached HEAD) and derives everything the construct needs. Note the raw branch name is kept for the artifact S3 key — it must match what the consumer's pipeline uploaded — while only the *prefix* is sanitized:

| git branch | `ENVIRONMENT` | stack id | domain |
|---|---|---|---|
| `main` | `production` | `MyStack` | `myapp.ruchij.com` |
| `main` | anything else / unset | `MyStack-staging` | `staging.myapp.ruchij.com` |
| `feature-x` | *(ignored)* | `MyStack-feature-x` | `feature-x.myapp.ruchij.com` |

The prefix is `null` for production and is joined into both the stack id (with `-`) and the domain (with `.`), so the same `getPrefix` result drives both. Artifact key is always `${branch}/${shortCommit}/client.zip`. Region is hard-pinned to `us-east-1` (CloudFront requires its ACM certs there); the account comes from `CDK_DEFAULT_ACCOUNT` and is passed through undefined if unset.

`src/index.ts` is the public surface — anything not re-exported there is internal.

### Testing notes

`test/ReactSpaStack.test.ts` synthesises real templates and asserts with `aws-cdk-lib/assertions`. It always passes a concrete `env: { account, region }`; without it `HostedZone.fromLookup` resolves to dummy context values and assertions drift.

`test/deploy.test.ts`'s `beforeEach` deletes `GITHUB_REF_NAME` along with the other env vars. This is load-bearing on CI, not tidiness: GitHub Actions sets it, and branch resolution ranks it above git, so leaving it in place would silently override the mocked branch and make these tests pass locally while asserting the wrong thing on CI.

That suite mocks `simple-git` and `../src/ReactSpaStack`, then reads `ReactSpaStackMock.mock.calls[0]` positionally — the construct's **argument order is part of what these tests pin**, so reordering the constructor signature breaks them in a way that isn't obvious from the failure message. The `simple-git` mock is a callable factory with `default`/`__esModule` attached because the module is a callable default export.

## Releasing

Fully automated on push to `main` — do not hand-create tags or bump the patch version. The pipeline reads `major.minor` from `package.json`, finds the highest existing `v<major>.<minor>.*` tag, increments the patch, commits the bump back to `main` with `[skip ci]`, tags it, creates a GitHub release, and force-moves the major alias tag (`v1`) onto it.

To open a new minor/major line, edit `version` in `package.json` (e.g. `1.1.0`) and push.

**Consumers install from a git tag** (`github:ruchira088/react-app-cdk-deploy#v1`), not from a registry. `dist/` is gitignored, so it does not exist in a fresh clone or in the tag — the `prepare` script is what builds it at install time on the consumer's machine. Breaking `prepare`, or dropping `dist`/`src`/`tsconfig.json` from the `files` array, ships an unusable package even though local builds and tests pass.

# react-app-cdk-deploy

Shared AWS CDK construct + deploy helper for React SPAs hosted under `ruchij.com`.

Provisions: S3 bucket → CloudFront behind an Origin Access Control (with SPA `403/404 → /index.html` fallback) → ACM certificate (DNS-validated) → Route53 alias record. Uploads the build artifact from a versioned `.zip` in a separate artifact bucket and invalidates the distribution.

## Requirements

- **Node.js >= 20**
- **`aws-cdk-lib` ^2.264.0** and **`constructs` ^10.0.0** — declared as peer dependencies, so your `cdk-deploy` project must install them itself. npm 7+ will auto-install them if they're missing, but pin them explicitly so your CDK CLI and construct library stay on the same version.

The only runtime dependency this package pulls in is [`simple-git`](https://www.npmjs.com/package/simple-git) (^3.36.0), used to resolve the current branch and commit hash at deploy time.

Because consumers install straight from a git tag, the `prepare` script compiles TypeScript on install — so `typescript` (~7.0.2) is fetched as part of the install too.

## Usage

In your React app's `cdk-deploy/package.json`:

```json
{
  "dependencies": {
    "react-app-cdk-deploy": "github:ruchira088/react-app-cdk-deploy#v1",
    "aws-cdk-lib": "^2.264.0",
    "constructs": "^10.0.0"
  }
}
```

Pin to the moving major alias (`#v1`) to always pick up the latest `v1.x` release, or pin to an exact tag (e.g. `#v1.1.0`) for a reproducible build.

In your `cdk-deploy/bin/cdk-deploy.ts`:

```ts
#!/usr/bin/env node
import { deployReactSpa } from "react-app-cdk-deploy"

deployReactSpa({
  stackName: "MyAppFrontEndStack",
  domainName: "myapp.ruchij.com",
  artifactBucket: "myapp-front-end-bundles.ruchij.com"
}).catch(err => { console.error(err); process.exit(1) })
```

The helper resolves the current git branch + short commit hash at deploy time, and computes:

- **artifact key**: `${branch}/${commit}/client.zip` — uses the *raw* branch name, so it matches whatever your build pipeline uploaded
- **deployed domain**:
  - `main` + `ENVIRONMENT=production` → `myapp.ruchij.com`
  - `main` + anything else → `staging.myapp.ruchij.com`
  - any other branch → `${branch}.myapp.ruchij.com`
- **stack name**: same logic, suffixed with `-${prefix}` for non-prod.

Region is fixed at `us-east-1` (CloudFront ACM requirement). AWS account comes from `CDK_DEFAULT_ACCOUNT`.

### Branch names

Branch names are sanitized before they become a domain, bucket name, or stack id: lowercased, with every run of non-alphanumeric characters collapsed to a single hyphen. So `feature/JIRA-123` deploys to `feature-jira-123.myapp.ruchij.com`. Names too long to fit inside S3's 63-character bucket-name limit are truncated and given a deterministic hash suffix, so a branch keeps the same names across deploys.

If git cannot report a branch — most CI systems check out a detached HEAD — the helper falls back to `GITHUB_REF_NAME`, and then throws with a clear message. You can bypass detection entirely:

```ts
deployReactSpa({ ..., branch: "my-branch" })
```

### Content retention

Production deploys (`main` + `ENVIRONMENT=production`) set the site bucket to `RemovalPolicy.RETAIN`, so destroying the stack leaves the content intact. Every prefixed environment — staging and branch deploys — keeps `DESTROY` with auto-delete, so they tear down cleanly. Using the construct directly, this is the `retainContent` prop, defaulting to `false`.

## Releasing

Releases are cut automatically by the GitHub Actions pipeline (`.github/workflows/build-pipeline.yml`). Every push to `main` that passes build + test:

1. Computes the next patch under the `major.minor` in `package.json` (e.g. `1.1` → `v1.1.0`, `v1.1.1`, …) by inspecting existing tags.
2. Bumps the `version` in `package.json` (+ lockfile) to the new value and commits it back to `main` with a `[skip ci]` message (so the bump commit doesn't retrigger the pipeline).
3. Creates the immutable release tag (`v1.1.x`) on that bump commit and a GitHub release with auto-generated notes.
4. Force-moves the major alias tag (`v1`) to point at that newest release, so `#v1` consumers track the latest.

To start a new minor or major line, bump the `version` in `package.json` (e.g. to `1.2.0` or `2.0.0`) and push to `main`; the next release will continue from there.

## Lower-level API

If you need to skip the git/branch orchestration, import the construct directly:

```ts
import { ReactSpaStack } from "react-app-cdk-deploy"
```

The constructor takes `(scope, id, domain, { bucketName, zipObjectKey }, props?)`. `domain` must end with `ruchij.com`; `zipObjectKey` must end with `.zip`.

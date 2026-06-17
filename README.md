# react-app-cdk-deploy

Shared AWS CDK construct + deploy helper for React SPAs hosted under `ruchij.com`.

Provisions: S3 bucket → CloudFront (with SPA `404 → /index.html` fallback) → ACM certificate (DNS-validated) → Route53 alias record. Uploads the build artifact from a versioned `.zip` in a separate artifact bucket and invalidates the distribution.

## Usage

In your React app's `cdk-deploy/package.json`:

```json
{
  "dependencies": {
    "react-app-cdk-deploy": "github:ruchira088/react-app-cdk-deploy#v1"
  }
}
```

Pin to the moving major alias (`#v1`) to always pick up the latest `v1.0.x` release, or pin to an exact tag (e.g. `#v1.0.3`) for a reproducible build.

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

- **artifact key**: `${branch}/${commit}/client.zip`
- **deployed domain**:
  - `main` + `ENVIRONMENT=production` → `myapp.ruchij.com`
  - `main` + anything else → `staging.myapp.ruchij.com`
  - any other branch → `${branch}.myapp.ruchij.com`
- **stack name**: same logic, suffixed with `-${prefix}` for non-prod.

Region is fixed at `us-east-1` (CloudFront ACM requirement). AWS account comes from `CDK_DEFAULT_ACCOUNT`.

## Releasing

Releases are cut automatically by the GitHub Actions pipeline (`.github/workflows/build-pipeline.yml`). Every push to `main` that passes build + test:

1. Computes the next patch under the `major.minor` in `package.json` (e.g. `1.0` → `v1.0.0`, `v1.0.1`, …) by inspecting existing tags.
2. Bumps the `version` in `package.json` (+ lockfile) to the new value and commits it back to `main` with a `[skip ci]` message (so the bump commit doesn't retrigger the pipeline).
3. Creates the immutable release tag (`v1.0.x`) on that bump commit and a GitHub release with auto-generated notes.
4. Force-moves the major alias tag (`v1`) to point at that newest release, so `#v1` consumers track the latest.

To start a new minor or major line, bump the `version` in `package.json` (e.g. to `1.1.0` or `2.0.0`) and push to `main`; the next release will continue from there.

## Lower-level API

If you need to skip the git/branch orchestration, import the construct directly:

```ts
import { ReactSpaStack } from "react-app-cdk-deploy"
```

The constructor takes `(scope, id, domain, { bucketName, zipObjectKey }, props?)`. `domain` must end with `ruchij.com`; `zipObjectKey` must end with `.zip`.

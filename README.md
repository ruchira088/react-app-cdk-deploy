# react-app-cdk-deploy

Shared AWS CDK construct + deploy helper for React SPAs hosted under `ruchij.com`.

Provisions: S3 bucket → CloudFront (with SPA `404 → /index.html` fallback) → ACM certificate (DNS-validated) → Route53 alias record. Uploads the build artifact from a versioned `.zip` in a separate artifact bucket and invalidates the distribution.

## Usage

In your React app's `cdk-deploy/package.json`:

```json
{
  "dependencies": {
    "react-app-cdk-deploy": "github:ruchira088/react-app-cdk-deploy#v1.0.0"
  }
}
```

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

1. Edit, commit on `main`.
2. `git tag vX.Y.Z && git push --tags`.
3. Bump consumer repos: `npm install react-app-cdk-deploy@github:ruchira088/react-app-cdk-deploy#vX.Y.Z`.

## Lower-level API

If you need to skip the git/branch orchestration, import the construct directly:

```ts
import { ReactSpaStack } from "react-app-cdk-deploy"
```

The constructor takes `(scope, id, domain, { bucketName, zipObjectKey }, props?)`. `domain` must end with `ruchij.com`; `zipObjectKey` must end with `.zip`.

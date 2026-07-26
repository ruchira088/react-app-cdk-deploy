import { App } from "aws-cdk-lib/core"
import SimpleGit from "simple-git"
import { ReactSpaStack } from "./ReactSpaStack"
import { MAX_BUCKET_NAME_LENGTH, sanitizeLabel } from "./naming"

export type DeployReactSpaConfig = {
  readonly stackName: string
  readonly domainName: string
  readonly artifactBucket: string

  /**
   * Overrides branch detection. Useful in CI systems that check out a detached
   * HEAD, where git cannot report a branch name.
   */
  readonly branch?: string
}

/** What `git branch` reports when no branch is checked out. */
const DETACHED_HEAD = "HEAD"

const getPrefix = (gitBranch: string): string | null => {
  if (gitBranch === "main") {
    if (process.env.ENVIRONMENT === "production") {
      return null
    } else {
      return "staging"
    }
  } else {
    return gitBranch
  }
}

const isUsableBranch = (value: string | undefined): value is string =>
  value != null && value.trim().length > 0 && value.trim() !== DETACHED_HEAD

/**
 * Resolves the branch being deployed, preferring explicit sources over git.
 * A detached HEAD — the default checkout state for most CI systems — makes
 * git the least reliable of the three.
 */
const resolveBranch = async (
  simpleGit: ReturnType<typeof SimpleGit>,
  override: string | undefined
): Promise<string> => {
  if (isUsableBranch(override)) {
    return override.trim()
  }

  if (isUsableBranch(process.env.GITHUB_REF_NAME)) {
    return process.env.GITHUB_REF_NAME.trim()
  }

  const gitBranch = await simpleGit.branch()

  if (isUsableBranch(gitBranch.current)) {
    return gitBranch.current.trim()
  }

  throw new Error(
    "Unable to determine the current git branch (detached HEAD?). " +
      "Set `branch` in the deploy config, or the GITHUB_REF_NAME environment variable."
  )
}

export const deployReactSpa = async (config: DeployReactSpaConfig): Promise<void> => {
  const app = new App()

  const simpleGit = SimpleGit()

  const branch = await resolveBranch(simpleGit, config.branch)
  const gitCommitHash = await simpleGit.revparse(["--short", "HEAD"])

  // The raw branch name, not the sanitized one: this key has to match whatever
  // the consumer's build pipeline uploaded, and S3 keys permit slashes.
  const zipObjectKey = `${branch}/${gitCommitHash}/client.zip`

  const rawPrefix: string | null = getPrefix(branch)
  const prefix: string | null =
    rawPrefix == null
      ? null
      : sanitizeLabel(rawPrefix, MAX_BUCKET_NAME_LENGTH - config.domainName.length - 1)

  if (prefix != null) {
    console.log(`Deploying with prefix: "${prefix}"`)
  } else {
    console.log("Deploying to production")
  }

  new ReactSpaStack(
    app,
    [config.stackName, prefix].filter(value => value != null).join("-"),
    [prefix, config.domainName].filter(value => value != null).join("."),
    {
      bucketName: config.artifactBucket,
      zipObjectKey
    },
    {
      env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: "us-east-1"
      },
      retainContent: prefix == null
    }
  )
}

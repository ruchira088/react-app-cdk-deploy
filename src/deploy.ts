import { App } from "aws-cdk-lib/core"
import SimpleGit from "simple-git"
import { ReactSpaStack } from "./ReactSpaStack"

export type DeployReactSpaConfig = {
  readonly stackName: string
  readonly domainName: string
  readonly artifactBucket: string
}

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

export const deployReactSpa = async (config: DeployReactSpaConfig): Promise<void> => {
  const app = new App()

  const simpleGit = SimpleGit()

  const gitBranch = await simpleGit.branch()
  const gitCommitHash = await simpleGit.revparse(["--short", "HEAD"])
  const zipObjectKey = `${gitBranch.current}/${gitCommitHash}/client.zip`

  const prefix: string | null = getPrefix(gitBranch.current)

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
      }
    }
  )
}

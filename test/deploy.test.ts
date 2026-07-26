const mockBranch = jest.fn()
const mockRevparse = jest.fn()

jest.mock("simple-git", () => {
  const factory = (..._args: unknown[]) => ({
    branch: mockBranch,
    revparse: mockRevparse
  })
  return Object.assign(factory, { default: factory, __esModule: true })
})

jest.mock("../src/ReactSpaStack", () => ({
  ReactSpaStack: jest.fn()
}))

import { deployReactSpa } from "../src/deploy"
import { ReactSpaStack } from "../src/ReactSpaStack"

const ReactSpaStackMock = ReactSpaStack as unknown as jest.Mock

const ORIGINAL_ENV = process.env

const baseConfig = {
  stackName: "MyStack",
  domainName: "ruchij.com",
  artifactBucket: "artifacts"
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...ORIGINAL_ENV }
  delete process.env.ENVIRONMENT
  delete process.env.CDK_DEFAULT_ACCOUNT
  // Set by GitHub Actions; left in place it would outrank the mocked git
  // branch and quietly change what these tests exercise on CI.
  delete process.env.GITHUB_REF_NAME
  mockRevparse.mockResolvedValue("abc1234")
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe("deployReactSpa — main branch", () => {
  test("with ENVIRONMENT=production: no prefix on stack name or domain", async () => {
    process.env.ENVIRONMENT = "production"
    process.env.CDK_DEFAULT_ACCOUNT = "999999999999"
    mockBranch.mockResolvedValue({ current: "main" })

    await deployReactSpa(baseConfig)

    expect(ReactSpaStackMock).toHaveBeenCalledTimes(1)
    const [, stackId, domain, source, props] = ReactSpaStackMock.mock.calls[0]
    expect(stackId).toBe("MyStack")
    expect(domain).toBe("ruchij.com")
    expect(source).toEqual({
      bucketName: "artifacts",
      zipObjectKey: "main/abc1234/client.zip"
    })
    expect(props).toEqual({
      env: { account: "999999999999", region: "us-east-1" },
      retainContent: true
    })
  })

  test("without ENVIRONMENT: applies 'staging' prefix to stack and domain", async () => {
    mockBranch.mockResolvedValue({ current: "main" })

    await deployReactSpa(baseConfig)

    const [, stackId, domain] = ReactSpaStackMock.mock.calls[0]
    expect(stackId).toBe("MyStack-staging")
    expect(domain).toBe("staging.ruchij.com")
  })

  test("with ENVIRONMENT set to a non-production value: still applies 'staging' prefix", async () => {
    process.env.ENVIRONMENT = "dev"
    mockBranch.mockResolvedValue({ current: "main" })

    await deployReactSpa(baseConfig)

    const [, stackId, domain] = ReactSpaStackMock.mock.calls[0]
    expect(stackId).toBe("MyStack-staging")
    expect(domain).toBe("staging.ruchij.com")
  })

  test("ENVIRONMENT match is case-sensitive ('Production' is not 'production')", async () => {
    process.env.ENVIRONMENT = "Production"
    mockBranch.mockResolvedValue({ current: "main" })

    await deployReactSpa(baseConfig)

    const [, stackId, domain] = ReactSpaStackMock.mock.calls[0]
    expect(stackId).toBe("MyStack-staging")
    expect(domain).toBe("staging.ruchij.com")
  })
})

describe("deployReactSpa — feature branches", () => {
  test("uses the branch name as both stack-name suffix and domain prefix", async () => {
    mockBranch.mockResolvedValue({ current: "feature-x" })

    await deployReactSpa(baseConfig)

    const [, stackId, domain, source] = ReactSpaStackMock.mock.calls[0]
    expect(stackId).toBe("MyStack-feature-x")
    expect(domain).toBe("feature-x.ruchij.com")
    expect(source.zipObjectKey).toBe("feature-x/abc1234/client.zip")
  })

  test("ignores ENVIRONMENT=production on non-main branches", async () => {
    process.env.ENVIRONMENT = "production"
    mockBranch.mockResolvedValue({ current: "release" })

    await deployReactSpa(baseConfig)

    const [, stackId, domain] = ReactSpaStackMock.mock.calls[0]
    expect(stackId).toBe("MyStack-release")
    expect(domain).toBe("release.ruchij.com")
  })
})

describe("deployReactSpa — git interactions", () => {
  test("requests the short commit hash via simple-git revparse", async () => {
    process.env.ENVIRONMENT = "production"
    mockBranch.mockResolvedValue({ current: "main" })
    mockRevparse.mockResolvedValue("deadbee")

    await deployReactSpa(baseConfig)

    expect(mockBranch).toHaveBeenCalledTimes(1)
    expect(mockRevparse).toHaveBeenCalledWith(["--short", "HEAD"])
    const [, , , source] = ReactSpaStackMock.mock.calls[0]
    expect(source.zipObjectKey).toBe("main/deadbee/client.zip")
  })
})

describe("deployReactSpa — env propagation", () => {
  test("forwards CDK_DEFAULT_ACCOUNT and pins region to us-east-1", async () => {
    process.env.CDK_DEFAULT_ACCOUNT = "111122223333"
    mockBranch.mockResolvedValue({ current: "main" })

    await deployReactSpa(baseConfig)

    const [, , , , props] = ReactSpaStackMock.mock.calls[0]
    expect(props.env.account).toBe("111122223333")
    expect(props.env.region).toBe("us-east-1")
  })

  test("passes account=undefined when CDK_DEFAULT_ACCOUNT is unset", async () => {
    mockBranch.mockResolvedValue({ current: "main" })

    await deployReactSpa(baseConfig)

    const [, , , , props] = ReactSpaStackMock.mock.calls[0]
    expect(props.env.account).toBeUndefined()
    expect(props.env.region).toBe("us-east-1")
  })
})

describe("deployReactSpa — branch name sanitization", () => {
  test("converts slashes in a branch name into hyphens", async () => {
    mockBranch.mockResolvedValue({ current: "feature/login-page" })

    await deployReactSpa(baseConfig)

    const [, stackId, domain] = ReactSpaStackMock.mock.calls[0]
    expect(stackId).toBe("MyStack-feature-login-page")
    expect(domain).toBe("feature-login-page.ruchij.com")
  })

  test("lowercases branch names, since bucket names cannot contain uppercase", async () => {
    mockBranch.mockResolvedValue({ current: "Feature/JIRA-123" })

    await deployReactSpa(baseConfig)

    const [, stackId, domain] = ReactSpaStackMock.mock.calls[0]
    expect(stackId).toBe("MyStack-feature-jira-123")
    expect(domain).toBe("feature-jira-123.ruchij.com")
  })

  test("keeps the raw branch name in the artifact key, which must match the upload", async () => {
    mockBranch.mockResolvedValue({ current: "feature/login-page" })

    await deployReactSpa(baseConfig)

    const [, , , source] = ReactSpaStackMock.mock.calls[0]
    expect(source.zipObjectKey).toBe("feature/login-page/abc1234/client.zip")
  })

  test("keeps the resulting bucket name within the S3 63-character limit", async () => {
    mockBranch.mockResolvedValue({
      current: "feature/an-extremely-long-branch-name-that-would-overflow-the-limit"
    })

    await deployReactSpa(baseConfig)

    const [, , domain] = ReactSpaStackMock.mock.calls[0]
    expect(domain.length).toBeLessThanOrEqual(63)
    expect(domain.endsWith(".ruchij.com")).toBe(true)
  })
})

describe("deployReactSpa — branch resolution", () => {
  test("prefers an explicit branch from the config over git", async () => {
    mockBranch.mockResolvedValue({ current: "main" })

    await deployReactSpa({ ...baseConfig, branch: "override-branch" })

    const [, stackId] = ReactSpaStackMock.mock.calls[0]
    expect(stackId).toBe("MyStack-override-branch")
    expect(mockBranch).not.toHaveBeenCalled()
  })

  test("falls back to GITHUB_REF_NAME when git reports a detached HEAD", async () => {
    process.env.GITHUB_REF_NAME = "ci-branch"
    mockBranch.mockResolvedValue({ current: "HEAD" })

    await deployReactSpa(baseConfig)

    const [, stackId] = ReactSpaStackMock.mock.calls[0]
    expect(stackId).toBe("MyStack-ci-branch")
  })

  test("prefers an explicit config branch over GITHUB_REF_NAME", async () => {
    process.env.GITHUB_REF_NAME = "ci-branch"
    mockBranch.mockResolvedValue({ current: "main" })

    await deployReactSpa({ ...baseConfig, branch: "override-branch" })

    const [, stackId] = ReactSpaStackMock.mock.calls[0]
    expect(stackId).toBe("MyStack-override-branch")
  })

  test("throws on a detached HEAD with no fallback available", async () => {
    mockBranch.mockResolvedValue({ current: "HEAD" })

    await expect(deployReactSpa(baseConfig)).rejects.toThrow(
      /Unable to determine the current git branch/
    )
    expect(ReactSpaStackMock).not.toHaveBeenCalled()
  })

  test("throws when git reports an empty branch name", async () => {
    mockBranch.mockResolvedValue({ current: "" })

    await expect(deployReactSpa(baseConfig)).rejects.toThrow(
      /Unable to determine the current git branch/
    )
  })
})

describe("deployReactSpa — content retention", () => {
  test("retains content on a production deploy", async () => {
    process.env.ENVIRONMENT = "production"
    mockBranch.mockResolvedValue({ current: "main" })

    await deployReactSpa(baseConfig)

    const [, , , , props] = ReactSpaStackMock.mock.calls[0]
    expect(props.retainContent).toBe(true)
  })

  test("does not retain content on staging", async () => {
    mockBranch.mockResolvedValue({ current: "main" })

    await deployReactSpa(baseConfig)

    const [, , , , props] = ReactSpaStackMock.mock.calls[0]
    expect(props.retainContent).toBe(false)
  })

  test("does not retain content on a feature branch", async () => {
    mockBranch.mockResolvedValue({ current: "feature-x" })

    await deployReactSpa(baseConfig)

    const [, , , , props] = ReactSpaStackMock.mock.calls[0]
    expect(props.retainContent).toBe(false)
  })
})

describe("deployReactSpa — logging", () => {
  test("logs 'Deploying to production' on production main", async () => {
    process.env.ENVIRONMENT = "production"
    mockBranch.mockResolvedValue({ current: "main" })
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {})

    await deployReactSpa(baseConfig)

    expect(logSpy).toHaveBeenCalledWith("Deploying to production")
    logSpy.mockRestore()
  })

  test("logs the prefix when not deploying to production", async () => {
    mockBranch.mockResolvedValue({ current: "feature" })
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {})

    await deployReactSpa(baseConfig)

    expect(logSpy).toHaveBeenCalledWith('Deploying with prefix: "feature"')
    logSpy.mockRestore()
  })
})

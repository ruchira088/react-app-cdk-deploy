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
      env: { account: "999999999999", region: "us-east-1" }
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

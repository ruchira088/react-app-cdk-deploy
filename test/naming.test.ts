import { MAX_BUCKET_NAME_LENGTH, sanitizeLabel } from "../src/naming"

const MAX = 40

describe("sanitizeLabel", () => {
  test("leaves an already-valid label untouched", () => {
    expect(sanitizeLabel("feature-x", MAX)).toBe("feature-x")
  })

  test("replaces slashes, the most common offender in branch names", () => {
    expect(sanitizeLabel("feature/login-page", MAX)).toBe("feature-login-page")
  })

  test("lowercases, since S3 bucket names may not contain uppercase", () => {
    expect(sanitizeLabel("Feature/JIRA-123", MAX)).toBe("feature-jira-123")
  })

  test("replaces underscores and other punctuation", () => {
    expect(sanitizeLabel("release_2.0+rc1", MAX)).toBe("release-2-0-rc1")
  })

  test("collapses runs of separators into a single hyphen", () => {
    expect(sanitizeLabel("a///b___c", MAX)).toBe("a-b-c")
  })

  test("strips leading and trailing separators", () => {
    expect(sanitizeLabel("/wip/", MAX)).toBe("wip")
  })

  test("throws when nothing usable survives sanitization", () => {
    expect(() => sanitizeLabel("///", MAX)).toThrow(/Unable to derive a valid label/)
    expect(() => sanitizeLabel("", MAX)).toThrow(/Unable to derive a valid label/)
  })

  test("throws when the budget is too small to hold a label", () => {
    expect(() => sanitizeLabel("feature", 4)).toThrow(/too little room/)
  })
})

describe("sanitizeLabel truncation", () => {
  const longBranch = "feature/a-very-long-branch-name-that-will-not-fit-anywhere"

  test("respects the maximum length", () => {
    expect(sanitizeLabel(longBranch, 20).length).toBeLessThanOrEqual(20)
  })

  test("appends a hash suffix so truncated names stay unique", () => {
    expect(sanitizeLabel(longBranch, 20)).toMatch(/^[a-z0-9-]+-[0-9a-f]{6}$/)
  })

  test("is deterministic, so a branch keeps the same names across deploys", () => {
    expect(sanitizeLabel(longBranch, 20)).toBe(sanitizeLabel(longBranch, 20))
  })

  test("distinguishes two long branches sharing a prefix", () => {
    const a = sanitizeLabel(`${longBranch}-one`, 20)
    const b = sanitizeLabel(`${longBranch}-two`, 20)

    expect(a).not.toBe(b)
  })

  test("does not leave a doubled hyphen where the truncation lands", () => {
    expect(sanitizeLabel("feature/abcdefghij/klmnop", 18)).not.toMatch(/--/)
  })

  test("produces a bucket-name-safe result at the real domain budget", () => {
    const domain = "myapp.ruchij.com"
    const label = sanitizeLabel(longBranch, MAX_BUCKET_NAME_LENGTH - domain.length - 1)

    expect(`${label}.${domain}`.length).toBeLessThanOrEqual(MAX_BUCKET_NAME_LENGTH)
  })
})

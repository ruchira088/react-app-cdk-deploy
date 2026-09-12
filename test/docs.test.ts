import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * README.md and CLAUDE.md both restate the dependency ranges from package.json
 * for consumers and for agents respectively. A bump that lands only in
 * package.json leaves both documents lying, so these tests make that drift a
 * CI failure rather than a rule to remember.
 */

const ROOT = join(__dirname, "..")
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8")
const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

type PackageJson = {
  engines: { node: string }
  peerDependencies: Record<string, string>
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}

const pkg = JSON.parse(read("package.json")) as PackageJson
const readme = read("README.md")
const claudeMd = read("CLAUDE.md")

const nodeVersion = pkg.engines.node.replace(/^>=/, "")

describe("package.json internal consistency", () => {
  test("devDependencies mirror the peer ranges so the repo tests what consumers get", () => {
    for (const [name, range] of Object.entries(pkg.peerDependencies)) {
      expect(pkg.devDependencies[name]).toBe(range)
    }
  })

  test("the Node engine is a simple lower bound", () => {
    expect(pkg.engines.node).toMatch(/^>=\d+$/)
  })
})

describe("README.md Requirements section", () => {
  test("states the Node engine", () => {
    expect(readme).toContain(`**Node.js >= ${nodeVersion}**`)
  })

  test("states each peer dependency range in prose and in the usage snippet", () => {
    for (const [name, range] of Object.entries(pkg.peerDependencies)) {
      expect(readme).toContain(`**\`${name}\` ${range}**`)
      expect(readme).toContain(`"${name}": "${range}"`)
    }
  })

  test("states the simple-git runtime range", () => {
    expect(readme).toMatch(
      new RegExp(`\\[\`simple-git\`\\]\\([^)]*\\) \\(${escape(pkg.dependencies["simple-git"])}\\)`)
    )
  })

  test("states the typescript version fetched by prepare", () => {
    expect(readme).toContain(`\`typescript\` (${pkg.devDependencies["typescript"]})`)
  })
})

describe("CLAUDE.md dependency table", () => {
  test("states the Node engine", () => {
    expect(claudeMd).toContain(`Node engine: \`${pkg.engines.node}\`.`)
  })

  test("has a row for every peer dependency", () => {
    for (const [name, range] of Object.entries(pkg.peerDependencies)) {
      expect(claudeMd).toContain(`| peer | \`${name}\` | \`${range}\` |`)
    }
  })

  test("has a row for every runtime dependency", () => {
    for (const [name, range] of Object.entries(pkg.dependencies)) {
      expect(claudeMd).toContain(`| runtime | \`${name}\` | \`${range}\` |`)
    }
  })

  test("has a row for every dev dependency that is not a mirrored peer", () => {
    for (const [name, range] of Object.entries(pkg.devDependencies)) {
      if (name in pkg.peerDependencies) {
        continue
      }
      expect(claudeMd).toContain(`| dev | \`${name}\` | \`${range}\` |`)
    }
  })
})

describe("AGENTS.md", () => {
  test("is the same document as CLAUDE.md", () => {
    expect(read("AGENTS.md")).toBe(claudeMd)
  })
})

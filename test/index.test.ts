import * as publicApi from "../src/index"

describe("public API surface", () => {
  test("exports the construct and the deploy helper", () => {
    expect(typeof publicApi.ReactSpaStack).toBe("function")
    expect(typeof publicApi.deployReactSpa).toBe("function")
  })

  test("exports nothing beyond the documented surface", () => {
    expect(Object.keys(publicApi).sort()).toEqual(["ReactSpaStack", "deployReactSpa"])
  })
})

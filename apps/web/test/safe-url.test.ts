import { describe, expect, it } from "vitest"
import { toSafeExternalHref } from "../src/lib/safe-url"

describe("toSafeExternalHref", () => {
  it("接受 http/https", () => {
    expect(toSafeExternalHref("https://github.com/honojs/hono")).toBe(
      "https://github.com/honojs/hono",
    )
    expect(toSafeExternalHref("http://example.com")).toBe("http://example.com/")
  })

  it("拒绝危险协议与空值", () => {
    expect(toSafeExternalHref("javascript:alert(1)")).toBeNull()
    expect(toSafeExternalHref("data:text/html,hi")).toBeNull()
    expect(toSafeExternalHref("")).toBeNull()
    expect(toSafeExternalHref(null)).toBeNull()
    expect(toSafeExternalHref("not a url")).toBeNull()
  })
})

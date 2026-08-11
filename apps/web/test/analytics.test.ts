import { beforeEach, describe, expect, it } from "vitest"
import { TestClient, registerOwner } from "./helpers"

let owner: TestClient
let guest: TestClient

beforeEach(async () => {
  owner = await registerOwner()
  guest = new TestClient()
})

describe("PUT /api/settings/analytics", () => {
  it("未登录返回 401", async () => {
    const res = await guest.put<{ code?: string }>("/api/settings/analytics", {
      measurement_id: "G-TEST12345",
    })
    expect(res.status).toBe(401)
    expect(res.body.code).toBe("UNAUTHORIZED")
  })

  it("非法 Measurement ID 返回 400", async () => {
    const res = await owner.put<{ code?: string }>("/api/settings/analytics", {
      measurement_id: "UA-123456-1",
    })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe("VALIDATION_ERROR")
  })

  it("保存后在 /auth/status 回显；访客也能读到", async () => {
    const put = await owner.put<{
      google_analytics_measurement_id: string | null
    }>("/api/settings/analytics", {
      measurement_id: "g-abc123xyz",
    })
    expect(put.status).toBe(200)
    expect(put.body.google_analytics_measurement_id).toBe("G-ABC123XYZ")

    const ownerStatus = await owner.json<{
      google_analytics_measurement_id: string | null
    }>("/api/auth/status")
    expect(ownerStatus.status).toBe(200)
    expect(ownerStatus.body.google_analytics_measurement_id).toBe("G-ABC123XYZ")

    const guestStatus = await guest.json<{
      google_analytics_measurement_id: string | null
    }>("/api/auth/status")
    expect(guestStatus.status).toBe(200)
    expect(guestStatus.body.google_analytics_measurement_id).toBe("G-ABC123XYZ")
  })

  it("空串或 null 清空后 status 为 null", async () => {
    await owner.put("/api/settings/analytics", {
      measurement_id: "G-KEEPME123",
    })

    const cleared = await owner.put<{
      google_analytics_measurement_id: string | null
    }>("/api/settings/analytics", {
      measurement_id: "",
    })
    expect(cleared.status).toBe(200)
    expect(cleared.body.google_analytics_measurement_id).toBeNull()

    const status = await guest.json<{
      google_analytics_measurement_id: string | null
    }>("/api/auth/status")
    expect(status.body.google_analytics_measurement_id).toBeNull()

    const clearedNull = await owner.put<{
      google_analytics_measurement_id: string | null
    }>("/api/settings/analytics", {
      measurement_id: null,
    })
    expect(clearedNull.status).toBe(200)
    expect(clearedNull.body.google_analytics_measurement_id).toBeNull()
  })
})

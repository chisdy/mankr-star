import { discoveryChannelSchema } from "@mankr/shared"
import { Hono } from "hono"
import type { AppEnv } from "../env"
import { requireAuthOrPublicRead } from "../middleware/auth"
import {
  discoveryEnabled,
  readDiscovery,
  readDiscoveryChannels,
} from "../lib/discovery/repository"

export const discoveryRoutes = new Hono<AppEnv>()
discoveryRoutes.use("/discovery", requireAuthOrPublicRead)
discoveryRoutes.use("/discovery/*", requireAuthOrPublicRead)
discoveryRoutes.get("/discovery/channels", async (c) => {
  c.header("Cache-Control", "private, no-store")
  return c.json(
    await readDiscoveryChannels(
      c.env.DB,
      discoveryEnabled(c.env.DISCOVERY_ENABLED)
    )
  )
})
discoveryRoutes.get("/discovery", async (c) => {
  c.header("Cache-Control", "private, no-store")
  const extra = Object.keys(c.req.query()).filter((key) => key !== "channel")
  if (extra.length)
    return c.json(
      { error: "Only fixed channels are supported", code: "INVALID_QUERY" },
      400
    )
  const parsed = discoveryChannelSchema.safeParse(
    c.req.query("channel") ?? "ai"
  )
  return c.json(
    await readDiscovery(
      c.env.DB,
      discoveryEnabled(c.env.DISCOVERY_ENABLED),
      parsed.success ? parsed.data : "ai",
      !!c.get("userId") && !c.get("isPublicRead")
    )
  )
})

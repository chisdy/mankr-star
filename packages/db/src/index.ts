import { drizzle } from "drizzle-orm/d1"
import * as schema from "./schema"

export type DbEnv = { DB: D1Database }

export function createDb(env: DbEnv) {
  return drizzle(env.DB, { schema })
}

export type Db = ReturnType<typeof createDb>

export * from "./schema"

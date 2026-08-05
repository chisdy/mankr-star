export type Env = {
  DB: D1Database
  ASSETS?: Fetcher
  SESSION_SECRET: string
  PAT_ENCRYPTION_KEY: string
  AI_KEY_ENCRYPTION_KEY?: string
  /** 可选：公共元数据兜底 token */
  GITHUB_TOKEN?: string
}

export type Variables = {
  userId?: string
  user?: {
    id: string
    username: string
    email: string | null
  }
  /** 未登录但公开浏览已开启时为 true */
  isPublicRead?: boolean
  db: import("@mankr/db").Db
}

export type AppEnv = {
  Bindings: Env
  Variables: Variables
}

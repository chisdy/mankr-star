export type GithubRepoMeta = {
  owner: string
  repo: string
  fullName: string
  description: string | null
  language: string | null
  stars: number
  forks: number
  license: string | null
  homepage: string | null
  defaultBranch: string | null
  topics: string[]
  pushedAt: string | null
  updatedAt: string | null
  htmlUrl: string
  archived: boolean
  disabled: boolean
  size: number
}

export type GithubRelease = {
  tagName: string
  name: string | null
  publishedAt: string | null
}

export class GithubApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = "GithubApiError"
    this.status = status
  }
}

function authHeaders(token?: string | null): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "mankr-star",
    "X-GitHub-Api-Version": "2022-11-28",
  }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

function mapRepoPayload(
  owner: string,
  repo: string,
  data: Record<string, unknown>,
): GithubRepoMeta {
  const licenseObj = data.license as { spdx_id?: string } | null
  return {
    owner,
    repo,
    fullName: String(data.full_name ?? `${owner}/${repo}`),
    description: (data.description as string | null) ?? null,
    language: (data.language as string | null) ?? null,
    stars: Number(data.stargazers_count ?? 0),
    forks: Number(data.forks_count ?? 0),
    license: licenseObj?.spdx_id ?? null,
    homepage: (data.homepage as string | null) || null,
    defaultBranch: (data.default_branch as string | null) ?? null,
    topics: Array.isArray(data.topics) ? (data.topics as string[]) : [],
    pushedAt: (data.pushed_at as string | null) ?? null,
    updatedAt: (data.updated_at as string | null) ?? null,
    htmlUrl: String(data.html_url ?? `https://github.com/${owner}/${repo}`),
    archived: Boolean(data.archived),
    disabled: Boolean(data.disabled),
    size: Number(data.size ?? 0),
  }
}

export async function fetchGithubRepo(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<GithubRepoMeta> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}`,
    { headers: authHeaders(token) },
  )
  if (res.status === 404) {
    throw new GithubApiError("仓库不存在或无权访问", 404)
  }
  if (res.status === 403) {
    throw new GithubApiError("无权访问该仓库", 403)
  }
  if (!res.ok) {
    throw new GithubApiError(
      `GitHub API 错误: ${res.status}`,
      res.status,
    )
  }
  const data = (await res.json()) as Record<string, unknown>
  return mapRepoPayload(owner, repo, data)
}

export async function fetchLatestRelease(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<GithubRelease | null> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
    { headers: authHeaders(token) },
  )
  if (res.status === 404) return null
  if (!res.ok) return null
  const data = (await res.json()) as Record<string, unknown>
  return {
    tagName: String(data.tag_name ?? ""),
    name: (data.name as string | null) ?? null,
    publishedAt: (data.published_at as string | null) ?? null,
  }
}

export async function fetchReadmeSnippet(
  owner: string,
  repo: string,
  maxChars: number,
  token?: string | null,
  signal?: AbortSignal,
): Promise<string | null> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/readme`,
    {
      headers: {
        ...authHeaders(token),
        Accept: "application/vnd.github.raw+json",
      },
      signal,
    },
  )
  if (!res.ok) return null
  const text = await res.text()
  return text.slice(0, maxChars)
}

export type StarredRepo = {
  owner: string
  repo: string
  fullName: string
  description: string | null
  language: string | null
  stars: number
  forks: number
  htmlUrl: string
  topics: string[]
  pushedAt: string | null
  updatedAt: string | null
  license: string | null
  homepage: string | null
  defaultBranch: string | null
  archived: boolean
  disabled: boolean
  size: number
}

export async function fetchStarredPage(
  token: string,
  page: number,
  perPage: number,
): Promise<{ repos: StarredRepo[]; hasMore: boolean }> {
  const res = await fetch(
    `https://api.github.com/user/starred?page=${page}&per_page=${perPage}`,
    { headers: authHeaders(token) },
  )
  if (res.status === 401) {
    throw new GithubApiError("GitHub PAT 无效或已过期", 401)
  }
  if (!res.ok) {
    throw new GithubApiError(`GitHub Stars 拉取失败: ${res.status}`, res.status)
  }
  const data = (await res.json()) as Array<Record<string, unknown>>
  const repos: StarredRepo[] = data.map((item) => {
    const fullName = String(item.full_name ?? "")
    const [owner = "", repo = ""] = fullName.split("/")
    const mapped = mapRepoPayload(owner, repo, item)
    return {
      owner: mapped.owner,
      repo: mapped.repo,
      fullName: mapped.fullName,
      description: mapped.description,
      language: mapped.language,
      stars: mapped.stars,
      forks: mapped.forks,
      htmlUrl: mapped.htmlUrl,
      topics: mapped.topics,
      pushedAt: mapped.pushedAt,
      updatedAt: mapped.updatedAt,
      license: mapped.license,
      homepage: mapped.homepage,
      defaultBranch: mapped.defaultBranch,
      archived: mapped.archived,
      disabled: mapped.disabled,
      size: mapped.size,
    }
  })
  const link = res.headers.get("link") ?? ""
  const hasMore = link.includes('rel="next"')
  return { repos, hasMore }
}

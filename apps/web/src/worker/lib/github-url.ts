export type ParsedGithubRepo = {
  owner: string
  repo: string
  externalId: string
  canonicalUrl: string
}

/**
 * 接受完整 GitHub URL 或 owner/repo
 */
export function parseGithubRepoInput(input: string): ParsedGithubRepo | null {
  const raw = input.trim()
  if (!raw) return null

  let owner: string | undefined
  let repo: string | undefined

  const short = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/)
  if (short && !raw.includes("://") && !raw.startsWith("github.com")) {
    owner = short[1]
    repo = short[2]
  } else {
    try {
      const withProto = raw.startsWith("http") ? raw : `https://${raw}`
      const url = new URL(withProto)
      if (
        url.hostname !== "github.com" &&
        url.hostname !== "www.github.com"
      ) {
        return null
      }
      const parts = url.pathname.split("/").filter(Boolean)
      if (parts.length < 2) return null
      owner = parts[0]
      repo = parts[1]!.replace(/\.git$/, "")
    } catch {
      return null
    }
  }

  if (!owner || !repo) return null
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    return null
  }

  const externalId = `${owner}/${repo}`
  return {
    owner,
    repo,
    externalId,
    canonicalUrl: `https://github.com/${externalId}`,
  }
}

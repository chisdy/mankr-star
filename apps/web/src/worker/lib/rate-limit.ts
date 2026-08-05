type Bucket = { count: number; resetAt: number }

/** MVP 内存限流（单 isolate；多 isolate 不共享，足够防暴力） */
const buckets = new Map<string, Bucket>()

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; remaining: number; resetAt: number } {
  const now = Date.now()
  let bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs }
    buckets.set(key, bucket)
  }
  bucket.count += 1
  const remaining = Math.max(0, limit - bucket.count)
  return { ok: bucket.count <= limit, remaining, resetAt: bucket.resetAt }
}

/** 偶尔清理过期桶，避免 Map 无限增长 */
export function pruneRateLimitBuckets(): void {
  const now = Date.now()
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k)
  }
}

import { describe, expect, it } from "vitest"
import type { KbBookmarkHit } from "../src/worker/lib/kb-search"
import {
  createKbSourceRegistry,
  registerFastPathSources,
} from "../src/worker/lib/kb-tools"

/**
 * 正文里的 [#n] / [Wn] 由前端按「第 n 个 bookmark / web 类型来源」解析，
 * 所以编号表必须保证：第 k 个被登记的收藏，就是 sources 里第 k 个 bookmark。
 * 一旦编号重排或重复登记，回答里的引用就会指向错误的资料。
 */
function hit(id: string): KbBookmarkHit {
  return {
    id,
    title: `标题 ${id}`,
    url: `https://example.com/${id}`,
    description: null,
    summaryAi: null,
    notes: null,
    contentExcerpt: null,
    siteName: null,
    owner: null,
    externalId: null,
  }
}

function web(n: number) {
  return {
    title: `网页 ${n}`,
    url: `https://web.example.com/${n}`,
    snippet: "摘要",
  }
}

describe("KbSourceRegistry 引用编号", () => {
  it("同一条收藏重复登记时复用编号且不重复入列", () => {
    const registry = createKbSourceRegistry()

    expect(registry.bookmark(hit("a"))).toEqual({ index: 1, fresh: true })
    expect(registry.bookmark(hit("b"))).toEqual({ index: 2, fresh: true })
    expect(registry.bookmark(hit("a"))).toEqual({ index: 1, fresh: false })

    expect(registry.sources).toHaveLength(2)
  })

  it("收藏与网页各自独立编号", () => {
    const registry = createKbSourceRegistry()

    registry.bookmark(hit("a"))
    expect(registry.web(web(1))).toEqual({ index: 1, fresh: true })
    expect(registry.bookmark(hit("b"))).toEqual({ index: 2, fresh: true })
    expect(registry.web(web(2))).toEqual({ index: 2, fresh: true })

    const bookmarks = registry.sources.filter((s) => s.type === "bookmark")
    const webs = registry.sources.filter((s) => s.type === "web")
    // [#k] 解析成「第 k 个 bookmark 来源」，顺序必须与分配顺序一致
    expect(bookmarks.map((s) => s.id)).toEqual(["a", "b"])
    expect(webs.map((s) => s.title)).toEqual(["网页 1", "网页 2"])
  })

  it("循环路径新增来源接着快路径的编号往后排", () => {
    const registry = createKbSourceRegistry()
    const { bookmarkContext, webContext } = registerFastPathSources(
      registry,
      [hit("a"), hit("b")],
      [web(1)],
    )

    expect(bookmarkContext).toContain("[#1]")
    expect(bookmarkContext).toContain("[#2]")
    expect(webContext).toContain("[W1]")

    // 后续工具查到的新资料只能往后追加，绝不能从 1 重新开始
    expect(registry.bookmark(hit("c"))).toEqual({ index: 3, fresh: true })
    expect(registry.web(web(2))).toEqual({ index: 2, fresh: true })
    expect(registry.sources).toHaveLength(5)
  })
})

#!/usr/bin/env node
/**
 * Local workerd sampled CPU evidence; never deploys or reads account credentials.
 * Usage: node scripts/discovery-resource-smoke.mjs --fixtures-dir /tmp --output /tmp/discovery-resource-report.json
 * Fetch full public XML separately as /tmp/mankr-discovery-{huggingface,webdev,cloudflare}.xml.
 * https://developers.cloudflare.com/workers/observability/dev-tools/cpu-profiling/
 * https://chromedevtools.github.io/devtools-protocol/tot/Profiler/
 */
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const webRequire = createRequire(path.join(repo, "apps/web/package.json"))
// Reuse the installed Wrangler toolchain without installing new dependencies.
const wranglerRequire = createRequire(
  webRequire.resolve("wrangler/package.json")
)
const { Miniflare } = wranglerRequire("miniflare")
const { build } = wranglerRequire("esbuild")
const args = process.argv.slice(2)
const option = (name, fallback) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const fixtureDir = path.resolve(option("--fixtures-dir", "/tmp"))
const output = path.resolve(
  option("--output", "/tmp/discovery-resource-report.json")
)
const intervalUs = 100
const rssLimit = Number(option("--rss-limit", "30"))
if (!Number.isInteger(rssLimit) || rssLimit < 1 || rssLimit > 30)
  throw new Error("--rss-limit must be an integer from 1 to 30")
const sources = ["huggingface", "webdev", "cloudflare", "hn40"]
const fixtures = {}
const manifest = []
for (const id of sources.filter((source) => source !== "hn40")) {
  const filename = path.join(fixtureDir, `mankr-discovery-${id}.xml`)
  const data = await readFile(filename)
  if (data.length > 1024 * 1024)
    throw new Error(`Fixture exceeds source byte budget: ${filename}`)
  fixtures[id] = data.toString("utf8")
  manifest.push({
    sourceId: id,
    file: filename,
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
  })
}

const worker = `
import { DISCOVERY_CONFIG, classifyDiscoveryContent } from "./src/worker/lib/discovery/channels.ts";
import { fetchRssFeed } from "./src/worker/lib/discovery/rss.ts";
import { fetchHnItem } from "./src/worker/lib/discovery/hacker-news.ts";
export default {
  async fetch(request,env) {
    const source = new URL(request.url).pathname.slice(1);
    const config = structuredClone(DISCOVERY_CONFIG);
    config.budgets.rssEntries = ${rssLimit};
    const now = new Date("2026-10-08T06:00:00Z");
    let requests = 0;
    if(source === "hn40") {
      const context = { now, beforeRequest: async()=>{requests++}, fetch: async(input)=> {
        const id = Number(String(input).match(/item\\/(\\d+)\\.json/)[1]);
        return Response.json({id,type:"story",title:"LLM inference React database CLI developer tools",text:"Large language model platform, infrastructure and automation",url:"https://example.org/article-"+id,time:now.getTime()/1000-3600,score:100,descendants:15});
      }};
      const items = [];
      for(let i=1;i<=40;i++) { const item=await fetchHnItem(i,i-1,context,config); if(item) items.push(item); }
      return Response.json({source,requests,candidates:items.length,classificationSample:classifyDiscoveryContent("Golang database",null,"https://example.org")});
    }
    const feed = config.feeds.find((item)=>item.id===source);
    if(!feed) return new Response("unknown fixture",{status:404});
    const result = await fetchRssFeed(feed, { now, beforeRequest:async()=>{requests++}, fetch:async()=>new Response(env[source]) },undefined,config);
    return Response.json({source,requests,candidates:result.candidates.length,title:result.candidates[0]?.title??null});
  }
};`
const bundled = await build({
  stdin: {
    contents: worker,
    resolveDir: path.join(repo, "apps/web"),
    sourcefile: "discovery-resource-worker.ts",
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  write: false,
})

async function inspectorConnection(miniflare) {
  const inspector = await miniflare.getInspectorURL()
  const listingUrl = new URL("/json/list", inspector)
  listingUrl.protocol = inspector.protocol === "wss:" ? "https:" : "http:"
  const listing = await fetch(listingUrl).then((response) => response.json())
  const target =
    listing.find((item) => item.id?.includes("discovery-resource")) ??
    listing.find((item) => item.webSocketDebuggerUrl)
  if (!target?.webSocketDebuggerUrl)
    throw new Error("No workerd inspector target")
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true })
    socket.addEventListener("error", reject, { once: true })
  })
  let nextId = 0
  const pending = new Map()
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data))
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timer)
    pending.delete(message.id)
    if (message.error) request.reject(new Error(JSON.stringify(message.error)))
    else request.resolve(message.result)
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Inspector timed out: ${method}`))
      }, 10_000)
      pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ id, method, params }))
    })
  return { send, close: () => socket.close() }
}

function summarize(profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
  const byFunction = new Map()
  let sampledActiveUs = 0
  let sampledJsUs = 0
  let sampledIdleUs = 0
  const samples = profile.samples ?? []
  for (let index = 0; index < samples.length; index++) {
    const node = nodes.get(samples[index])
    const delta = profile.timeDeltas?.[index] ?? intervalUs
    const name = node?.callFrame?.functionName ?? "unknown"
    const url = node?.callFrame?.url ?? ""
    if (name === "(idle)") {
      sampledIdleUs += delta
      continue
    }
    sampledActiveUs += delta
    // Script-attributed samples exclude engine `(program)`/inspector background.
    if (url) sampledJsUs += delta
    byFunction.set(
      `${name} @ ${url}`,
      (byFunction.get(`${name} @ ${url}`) ?? 0) + delta
    )
  }
  return {
    samplingIntervalUs: intervalUs,
    sampleCount: samples.length,
    sampledActiveMs: sampledActiveUs / 1000,
    sampledJsMs: sampledJsUs / 1000,
    sampledIdleMs: sampledIdleUs / 1000,
    largestFunctions: [...byFunction]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([functionName, timeUs]) => ({
        functionName,
        sampledMs: timeUs / 1000,
      })),
  }
}

const results = []
for (const source of sources) {
  // Fresh isolate per source makes "cold" and its three warmed invocations distinct.
  const mf = new Miniflare({
    name: "discovery-resource-smoke",
    modules: true,
    script: bundled.outputFiles[0].text,
    compatibilityDate: "2026-08-04",
    inspectorPort: 0,
    bindings: fixtures,
    host: "127.0.0.1",
    port: 0,
  })
  let inspector
  try {
    await mf.ready
    inspector = await inspectorConnection(mf)
    await inspector.send("Profiler.enable")
    await inspector.send("Profiler.setSamplingInterval", {
      interval: intervalUs,
    })
    for (let iteration = 0; iteration < 4; iteration++) {
      await inspector.send("Profiler.start")
      const response = await mf.dispatchFetch(`http://localhost/${source}`)
      const data = await response.json()
      const { profile } = await inspector.send("Profiler.stop")
      const report = {
        source,
        temperature: iteration === 0 ? "cold" : "warm",
        iteration,
        ...data,
        ...summarize(profile),
      }
      results.push(report)
      await mkdir(path.dirname(output), { recursive: true })
      await writeFile(
        `${output}.${source}.${iteration}.cpuprofile`,
        JSON.stringify(profile)
      )
      console.log(JSON.stringify(report))
    }
  } finally {
    inspector?.close()
    await mf.dispose()
  }
}
const report = {
  measuredAt: new Date().toISOString(),
  runtime: "local Miniflare/workerd V8 inspector",
  method:
    "Profiler sampling, 100 microsecond interval; actual script samples, never performance.now wall time",
  limitations: [
    "Sampling estimates execution within the observed profile window; inspector RPC, GC, scheduling and instrumentation add noise.",
    "No D1 work is included; HN40 is the whole daily fixture, while production fetch pieces are at most ten stories.",
    "Local hardware and inspector overhead differ from Cloudflare production CPU accounting. This does not prove the 10ms Free production gate.",
    "Keep DISCOVERY_ENABLED=false until the target account migrations and production CPU/request/D1 observations are verified.",
  ],
  fixtures: manifest,
  rssCandidateLimit: rssLimit,
  results,
}
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
console.log(`Resource report: ${output}`)

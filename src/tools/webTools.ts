import { z } from 'zod'
import { defineTool, type Tool } from './tool.js'
import { truncateOutput } from './util.js'

/** 极简 HTML -> 文本。 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

export const WebFetchTool = defineTool({
  name: 'WebFetch',
  description: '抓取网页并返回正文文本。',
  prompt: '抓取一个 URL 的内容并转为纯文本返回（截断到合理长度）。',
  inputSchema: z.object({
    url: z.string().url().describe('要抓取的 URL'),
  }),
  isReadOnly: () => true,
  needsPermission: () => false,
  renderInput: i => i.url,
  async execute(input, ctx) {
    try {
      const res = await fetch(input.url, {
        signal: ctx.signal,
        headers: { 'User-Agent': 'StrikeAgent-CLI/0.1' },
      })
      if (!res.ok) {
        return { content: `请求失败 HTTP ${res.status}`, isError: true }
      }
      const ct = res.headers.get('content-type') ?? ''
      const body = await res.text()
      const text = ct.includes('html') ? htmlToText(body) : body
      return { content: truncateOutput(text), summary: `抓取 ${input.url}` }
    } catch (e) {
      return {
        content: `抓取失败: ${e instanceof Error ? e.message : String(e)}`,
        isError: true,
      }
    }
  },
}) as Tool

export const WebSearchTool = defineTool({
  name: 'WebSearch',
  description: '联网搜索关键词并返回结果摘要。',
  prompt: '用关键词搜索互联网，返回标题/链接/摘要列表。',
  inputSchema: z.object({
    query: z.string().describe('搜索关键词'),
  }),
  isReadOnly: () => true,
  needsPermission: () => false,
  renderInput: i => i.query,
  async execute(input, ctx) {
    try {
      const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(input.query)}`
      const res = await fetch(url, {
        signal: ctx.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 StrikeAgent-CLI' },
      })
      const html = await res.text()
      const results: string[] = []
      const re = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
      let m: RegExpExecArray | null
      while ((m = re.exec(html)) && results.length < 8) {
        const link = decodeURIComponent(
          (m[1].match(/uddg=([^&]+)/)?.[1] ?? m[1]) as string,
        )
        const title = htmlToText(m[2])
        if (title) results.push(`- ${title}\n  ${link}`)
      }
      if (!results.length) {
        return { content: `未找到 "${input.query}" 的搜索结果` }
      }
      return {
        content: results.join('\n'),
        summary: `搜索 "${input.query}"（${results.length} 条）`,
      }
    } catch (e) {
      return {
        content: `搜索失败: ${e instanceof Error ? e.message : String(e)}`,
        isError: true,
      }
    }
  },
}) as Tool

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { sessionsDir } from '../config/paths.js'
import type { ChatMessage } from '../core/message.js'

export interface SessionData {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  cwd: string
  messages: ChatMessage[]
}

export function newSessionId(): string {
  return crypto.randomBytes(6).toString('hex')
}

function sessionPath(cwd: string, id: string): string {
  return path.join(sessionsDir(cwd), `${id}.json`)
}

export async function saveSession(data: SessionData): Promise<void> {
  data.updatedAt = Date.now()
  await fsp.writeFile(
    sessionPath(data.cwd, data.id),
    JSON.stringify(data, null, 2),
    'utf8',
  )
}

export function listSessions(cwd: string = process.cwd()): SessionData[] {
  const dir = sessionsDir(cwd)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as SessionData
      } catch {
        return null
      }
    })
    .filter((s): s is SessionData => s !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function loadLatestSession(cwd: string = process.cwd()): SessionData | undefined {
  return listSessions(cwd)[0]
}

export function loadSession(
  id: string,
  cwd: string = process.cwd(),
): SessionData | undefined {
  const p = sessionPath(cwd, id)
  if (!fs.existsSync(p)) return undefined
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as SessionData
  } catch {
    return undefined
  }
}

export function titleFrom(messages: ChatMessage[]): string {
  const first = messages.find(m => m.role === 'user')
  if (!first) return '新会话'
  const text = first.content
    .map(b => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim()
  return text.slice(0, 40) || '新会话'
}

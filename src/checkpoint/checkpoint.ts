import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { checkpointsDir } from '../config/paths.js'

interface Snapshot {
  filePath: string
  /** 备份文件在 checkpoints 目录下的名字；不存在表示原文件当时不存在。 */
  backupName: string | null
  existedBefore: boolean
  ts: number
  /** 所属对话回合（用于 /rewind 按回合还原代码）。 */
  turn: number
}

/** 当前会话内累计的快照栈（最新的在末尾）。 */
const stack: Snapshot[] = []

/** 对话回合标记：每个用户输入对应一个回合。 */
export interface TurnMark {
  turn: number
  /** 该回合开始时 messages 数组长度（回退时截断到此） */
  messageLen: number
  /** 用户输入摘要（展示用） */
  label: string
  ts: number
}

const turnMarks: TurnMark[] = []
let currentTurn = 0

/** 开始一个新的对话回合（在每条用户输入处理前调用）。 */
export function beginTurn(messageLen: number, label: string): number {
  currentTurn++
  turnMarks.push({
    turn: currentTurn,
    messageLen,
    label: label.slice(0, 60),
    ts: Date.now(),
  })
  return currentTurn
}

export function getTurnMarks(): TurnMark[] {
  return turnMarks
}

/**
 * 在修改文件前记录其当前内容快照（供 /undo 回滚 / /rewind 还原）。
 */
export function recordFileSnapshot(cwd: string, absPath: string): void {
  try {
    const dir = checkpointsDir(cwd)
    const existed = fs.existsSync(absPath)
    let backupName: string | null = null
    if (existed) {
      backupName =
        crypto.randomBytes(8).toString('hex') + '-' + path.basename(absPath)
      fs.copyFileSync(absPath, path.join(dir, backupName))
    }
    stack.push({
      filePath: absPath,
      backupName,
      existedBefore: existed,
      ts: Date.now(),
      turn: currentTurn,
    })
  } catch {
    /* 检查点是尽力而为，失败不影响主流程 */
  }
}

export function checkpointCount(): number {
  return stack.length
}

/** 把单个快照恢复到磁盘。 */
async function restoreSnapshot(dir: string, snap: Snapshot): Promise<void> {
  if (!snap.existedBefore) {
    if (fs.existsSync(snap.filePath)) await fsp.unlink(snap.filePath)
  } else if (snap.backupName) {
    await fsp.copyFile(path.join(dir, snap.backupName), snap.filePath)
    await fsp.unlink(path.join(dir, snap.backupName)).catch(() => {})
  }
}

/**
 * 回滚最近 n 次文件改动（默认全部）。返回被恢复的文件列表。
 */
export async function undo(cwd: string, n?: number): Promise<string[]> {
  const dir = checkpointsDir(cwd)
  const restored: string[] = []
  const count = n ?? stack.length
  for (let i = 0; i < count && stack.length; i++) {
    const snap = stack.pop()!
    try {
      await restoreSnapshot(dir, snap)
      restored.push(snap.filePath)
    } catch {
      /* 单个回滚失败继续 */
    }
  }
  return restored
}

/**
 * 回退到指定回合：还原"该回合及之后"所有文件改动（按时间逆序），
 * 并丢弃这些回合的标记。返回 { restoredFiles, messageLen }。
 */
export async function rewindToTurn(
  cwd: string,
  turn: number,
): Promise<{ restoredFiles: string[]; messageLen: number }> {
  const dir = checkpointsDir(cwd)
  const restored = new Set<string>()
  // 逆序恢复 turn >= 目标回合 的所有快照（恢复到该回合之前的状态）
  while (stack.length && stack[stack.length - 1].turn >= turn) {
    const snap = stack.pop()!
    try {
      await restoreSnapshot(dir, snap)
      restored.add(snap.filePath)
    } catch {
      /* 忽略 */
    }
  }
  // 找到目标回合的 messageLen，并丢弃其后的回合标记
  const mark = turnMarks.find(m => m.turn === turn)
  const messageLen = mark?.messageLen ?? 0
  for (let i = turnMarks.length - 1; i >= 0; i--) {
    if (turnMarks[i].turn >= turn) turnMarks.splice(i, 1)
  }
  currentTurn = turn - 1
  return { restoredFiles: [...restored], messageLen }
}

export function clearCheckpoints(): void {
  stack.length = 0
  turnMarks.length = 0
  currentTurn = 0
}

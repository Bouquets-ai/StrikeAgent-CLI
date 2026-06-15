import {
  type CompanionBones,
  type Rarity,
  type StatName,
  EYES,
  HATS,
  RARITIES,
  RARITY_WEIGHTS,
  SPECIES,
  STAT_NAMES,
} from './types.js'
import { getConfig } from '../config/index.js'

/** Mulberry32：极小的可种子化伪随机数发生器。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!
}

function rollRarity(rng: () => number): Rarity {
  const total = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0)
  let roll = rng() * total
  for (const r of RARITIES) {
    roll -= RARITY_WEIGHTS[r]
    if (roll < 0) return r
  }
  return 'common'
}

const RARITY_FLOOR: Record<Rarity, number> = {
  common: 5,
  uncommon: 15,
  rare: 25,
  epic: 35,
  legendary: 50,
}

function rollStats(rng: () => number, rarity: Rarity): Record<StatName, number> {
  const floor = RARITY_FLOOR[rarity]
  const peak = pick(rng, STAT_NAMES)
  let dump = pick(rng, STAT_NAMES)
  while (dump === peak) dump = pick(rng, STAT_NAMES)

  const stats = {} as Record<StatName, number>
  for (const name of STAT_NAMES) {
    if (name === peak) stats[name] = Math.min(100, floor + 50 + Math.floor(rng() * 30))
    else if (name === dump) stats[name] = Math.max(1, floor - 10 + Math.floor(rng() * 15))
    else stats[name] = floor + Math.floor(rng() * 40)
  }
  return stats
}

const SALT = 'strikeagent-buddy-v1'

function rollFrom(rng: () => number): CompanionBones {
  const rarity = rollRarity(rng)
  return {
    rarity,
    species: pick(rng, SPECIES),
    eye: pick(rng, EYES),
    hat: rarity === 'common' ? 'none' : pick(rng, HATS),
    shiny: rng() < 0.02,
    stats: rollStats(rng, rarity),
  }
}

let cache: { key: string; bones: CompanionBones } | null = null

/** 由 userId 确定性派生骨架（骨架不持久化，防篡改稀有度）。 */
export function rollBones(userId: string): CompanionBones {
  const key = userId + SALT
  if (cache?.key === key) return cache.bones
  const bones = rollFrom(mulberry32(hashString(key)))
  cache = { key, bones }
  return bones
}

export function rollBonesFromSeed(seed: string): CompanionBones {
  return rollFrom(mulberry32(hashString(seed)))
}

// 每次进程启动用一个随机种子，让宠物外形（物种/配色/属性）每次启动都不同。
const LAUNCH_SEED = `${Date.now()}-${Math.random()}-${process.pid}`
let launchCache: CompanionBones | null = null
export function rollLaunchBones(): CompanionBones {
  if (!launchCache) launchCache = rollBonesFromSeed(LAUNCH_SEED)
  return launchCache
}

export function buddyUserId(): string {
  return getConfig().userId || 'anon'
}

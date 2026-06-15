export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const
export type Rarity = (typeof RARITIES)[number]

export const RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 60,
  uncommon: 25,
  rare: 10,
  epic: 4,
  legendary: 1,
}

export const RARITY_LABEL: Record<Rarity, string> = {
  common: '普通',
  uncommon: '精良',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
}

/** 原创物种表（打击/突袭主题的小机械精灵）。 */
export const SPECIES = [
  'Sparkbot', // 火花机器人
  'Boltling', // 闪电小子
  'Pixie-Drone', // 像素无人机
  'Cinder', // 余烬
  'Glitchcat', // 故障猫
  'Nibble', // 啃啃兽
  'Aero', // 气流体
  'Quark', // 夸克
] as const
export type Species = (typeof SPECIES)[number]

export const EYES = ['•', 'o', '^', '◕', 'ﾟ', '×', '◔'] as const
export const HATS = ['none', 'antenna', 'crown', 'bolt', 'visor'] as const

export const STAT_NAMES = ['攻击', '智慧', '速度', '幸运', '忠诚'] as const
export type StatName = (typeof STAT_NAMES)[number]

export interface CompanionBones {
  rarity: Rarity
  species: Species
  eye: string
  hat: (typeof HATS)[number]
  shiny: boolean
  stats: Record<StatName, number>
}

export interface Companion extends CompanionBones {
  /** 持久化的"灵魂" */
  name: string
  personality: string
}

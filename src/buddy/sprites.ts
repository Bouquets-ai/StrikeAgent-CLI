import type { CompanionBones, Species } from './types.js'

export type Mood =
  | 'idle'
  | 'thinking'
  | 'working'
  | 'error'
  | 'celebrate'
  | 'talking'

/** 每个物种一个主题色（都避开 Claude 的橙色）。 */
export const SPECIES_COLOR: Record<Species, string> = {
  Sparkbot: '#36D6E7', // 电光青
  Boltling: '#F2D94E', // 闪电黄
  'Pixie-Drone': '#5B9CF2', // 天空蓝
  Cinder: '#FF5C8A', // 余烬粉红
  Glitchcat: '#C77DFF', // 故障紫
  Nibble: '#6BD66B', // 嫩芽绿
  Aero: '#BFE9F2', // 气流白
  Quark: '#9B6BF2', // 夸克紫
}

export function speciesColor(species: Species): string {
  return SPECIES_COLOR[species] ?? '#36D6E7'
}

/** 根据情绪/帧决定眼睛字形（眨眼、X 眼、惊喜眼等）。 */
function eyeGlyph(baseEye: string, mood: Mood, frame: number): string {
  if (mood === 'idle' && frame % 8 === 0) return '-' // 眨眼
  if (mood === 'error') return '×'
  if (mood === 'celebrate') return '^'
  if (mood === 'thinking') return frame % 2 === 0 ? '•' : '◦'
  if (mood === 'working') return frame % 2 === 0 ? 'o' : 'O'
  return baseEye || '•'
}

/** 嘴/表情（窄体 inline 用）。 */
function mouthFor(mood: Mood, frame: number): string {
  switch (mood) {
    case 'thinking':
      return frame % 2 === 0 ? '~' : '.'
    case 'working':
      return frame % 2 === 0 ? 'v' : 'w'
    case 'error':
      return '×'
    case 'celebrate':
      return frame % 2 === 0 ? 'ᗢ' : 'ᗧ'
    case 'talking':
      return frame % 2 === 0 ? 'o' : 'O'
    default:
      return '‿'
  }
}

// 各物种的像素造型构造器：传入眼睛字形 e、情绪、帧，返回 5 行字符画。
type ArtFn = (e: string, mood: Mood, frame: number) => string[]

const SPECIES_ART: Record<Species, ArtFn> = {
  // 火花机器人：方头 + 会闪的天线
  Sparkbot: (e, mood, f) => {
    const tip = mood === 'celebrate' ? '٭' : f % 2 === 0 ? '╹' : '╷'
    const mouth = mood === 'talking' && f % 2 === 0 ? '▢▢' : '▭▭'
    return [
      `     ${tip}     `,
      `  ┌───────┐  `,
      `  │ ${e}   ${e} │  `,
      `  │  ${mouth}  │  `,
      `  └┬─────┬┘  `,
    ]
  },

  // 闪电小子：锯齿状身体，会抖动闪烁
  Boltling: (e, mood, f) => {
    const z = f % 2 === 0 ? '◤◢◤◢' : '◢◤◢◤'
    return [
      `    ⚡${f % 2 ? '⚡' : ' '}     `,
      `   ╱${z}╲   `,
      `   │ ${e} ${e} │   `,
      `   ╲ ${mood === 'celebrate' ? 'ᗢ' : '◡'} ╱   `,
      `    ╲▁▁╱    `,
    ]
  },

  // 像素无人机：两侧旋翼旋转
  'Pixie-Drone': (e, _m, f) => {
    const rotor = ['—', '\\', '|', '/'][f % 4]
    return [
      ` ${rotor}═╗   ╔═${rotor} `,
      `   ╚═┳━┳═╝   `,
      `   ┃ ${e} ${e} ┃   `,
      `   ┃  ▿  ┃   `,
      `   ╚━━━━━╝   `,
    ]
  },

  // 余烬：跳动的火焰造型
  Cinder: (e, mood, f) => {
    const flame = f % 2 === 0 ? '(  )' : ' )( '
    return [
      `    ${flame}    `,
      `   ╱▒▒▒▒╲   `,
      `  ▕ ${e}  ${e} ▏  `,
      `  ▕  ${mood === 'error' ? '︿' : '⌣'}  ▏  `,
      `   ╲▒▒▒▒╱   `,
    ]
  },

  // 故障猫：抖动的耳朵 + 偶发故障错位
  Glitchcat: (e, mood, f) => {
    const ears = f % 2 === 0 ? '/\\  /\\' : '/\\ /\\ '
    const glitch = mood === 'error' || f % 4 === 3
    const body = glitch ? ' ▓░▓ ▓░ ' : ' ▓▓▓▓▓▓ '
    return [
      `   ${ears}   `,
      `  ╔══════╗  `,
      `  ║ ${e}  ${e} ║  `,
      `  ║${body}║`.slice(0, 14),
      `  ╚══════╝  `,
    ]
  },

  // 啃啃兽：圆身，门牙一咬一咬
  Nibble: (e, _m, f) => {
    const teeth = f % 2 === 0 ? 'ᗧᗧ' : 'ᐯᐯ'
    return [
      `   ▄████▄   `,
      `  ██${e}██${e}██  `,
      `  ██████████`.slice(0, 14),
      `  ██ ${teeth} ██  `,
      `   ▀▀  ▀▀   `,
    ]
  },

  // 气流体：漂浮的云朵，拖尾点点流动
  Aero: (e, _m, f) => {
    const trail = ['· ·', ' ··', '·· ', ' · '][f % 4]
    return [
      `   ☁☁☁☁   `,
      `  (${e}   ${e})  `,
      `  ( ${'◡'} )  ${trail}`,
      `   `,
      `   ⁀⁀⁀⁀   `,
    ]
  },

  // 夸克：核心 + 绕行的电子
  Quark: (e, _m, f) => {
    const pos = f % 4
    const orbit = [
      `  ●        `,
      `        ●  `,
      `         ● `,
      ` ●         `,
    ][pos]
    return [
      orbit,
      `   ╭────╮   `,
      `   │${e}  ${e}│   `,
      `   │ ◡◡ │   `,
      `   ╰────╯   `,
    ]
  },
}

/**
 * 返回宠物精灵的多行像素艺术。形态随物种变化，眼睛/肢体随情绪与帧动态变化。
 */
export function renderSprite(
  bones: CompanionBones,
  mood: Mood,
  frame: number,
): string[] {
  const e = eyeGlyph(bones.eye, mood, frame)
  const fn = SPECIES_ART[bones.species] ?? SPECIES_ART.Sparkbot
  return fn(e, mood, frame)
}

/** 单行紧凑表示（状态栏用）。 */
export function renderInline(bones: CompanionBones, mood: Mood, frame: number): string {
  const e = eyeGlyph(bones.eye, mood, frame)
  return `(${e}${mouthFor(mood, frame)}${e})`
}

export const MOOD_FROM_EVENT: Record<string, Mood> = {
  'query:start': 'thinking',
  'assistant:thinking': 'thinking',
  'tool:start': 'working',
  error: 'error',
  'query:end': 'idle',
}

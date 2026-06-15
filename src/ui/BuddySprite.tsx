import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { renderSprite, speciesColor, type Mood } from '../buddy/sprites.js'
import type { Companion } from '../buddy/types.js'
import { RARITY_LABEL } from '../buddy/types.js'
import type { BuddyMood } from '../buddy/mood.js'

const RARITY_LABEL_COLOR: Record<string, string> = {
  common: 'white',
  uncommon: 'green',
  rare: 'blue',
  epic: 'magenta',
  legendary: 'yellow',
}


export function BuddySprite({
  companion,
  moodController,
}: {
  companion: Companion
  moodController: BuddyMood
}) {
  const [frame, setFrame] = useState(0)
  const [mood, setMood] = useState<Mood>('idle')
  const [bubble, setBubble] = useState<string | null>(null)

  useEffect(() => {
    const t = setInterval(() => setFrame(f => (f + 1) % 4), 500)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const off = moodController.onChange((m, b) => {
      setMood(m)
      setBubble(b)
    })
    const cur = moodController.current()
    setMood(cur.mood)
    setBubble(cur.bubble)
    return off
  }, [moodController])

  const lines = renderSprite(companion, mood, frame)
  const labelColor = RARITY_LABEL_COLOR[companion.rarity] ?? 'white'
  const petColor = speciesColor(companion.species)

  return (
    <Box flexDirection="row" marginLeft={1}>
      <Box flexDirection="column">
        {lines.map((l, i) => (
          <Text key={i} color={petColor}>
            {l}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" marginLeft={2} marginTop={1}>
        <Text color={petColor} bold>
          {companion.name}
          {companion.shiny ? ' ✨' : ''}
        </Text>
        <Text color={labelColor}>
          {RARITY_LABEL[companion.rarity]} · {companion.species}
        </Text>
        {bubble ? <Text color="cyan">💬 {bubble}</Text> : <Text dimColor>……</Text>}
      </Box>
    </Box>
  )
}

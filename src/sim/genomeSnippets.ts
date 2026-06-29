import { OPS, SENSORS, DIRECTIONS } from './genome'

export interface GenomeSnippet {
  id: string
  label: string
  category: 'condition' | 'roots' | 'growth' | 'seeds' | 'defense' | 'stack'
  description: string
  lines: string[]
}

export interface GenomeBlock {
  id: string
  label: string
  description: string
  lines: string[]
}

export const SNIPPET_CATEGORY_LABELS: Record<GenomeSnippet['category'], string> = {
  condition: 'Условия',
  roots: 'Корни',
  growth: 'Рост',
  seeds: 'Семена',
  defense: 'Защита',
  stack: 'Стек',
}

/** Готовые секции генома — собирают жизнеспособное растение по частям */
export const GENOME_BLOCKS: GenomeBlock[] = [
  {
    id: 'block-minimal',
    label: 'Минимум',
    description: 'Якорь, корень вниз и рост вверх — жизнеспособный каркас',
    lines: [
      'SENSE DEPTH',
      'PUSH 0.03',
      'LT',
      'SENSE HEIGHT',
      'PUSH 0.04',
      'LT',
      'AND',
      'BRANCH DOWN WHEN≥0.50',
      'DIR UP',
      'SENSE HEIGHT',
      'PUSH 0.01',
      'LT',
      'SENSE DEPTH',
      'PUSH 0.04',
      'GT',
      'SENSE DEPTH',
      'PUSH 0.70',
      'LT',
      'AND',
      'AND',
      'GROW WHEN≥0.50',
      'DIR UP',
      'SENSE DEPTH',
      'PUSH 0.03',
      'LT',
      'SENSE HEIGHT',
      'PUSH 0.80',
      'LT',
      'SENSE ENERGY',
      'PUSH 0.10',
      'GT',
      'AND',
      'AND',
      'GROW WHEN≥0.50',
    ],
  },
  {
    id: 'block-roots',
    label: 'Корневая система',
    description: 'Якорь + стержневой и боковые корни',
    lines: [
      'SENSE DEPTH',
      'PUSH 0.03',
      'LT',
      'SENSE HEIGHT',
      'PUSH 0.04',
      'LT',
      'AND',
      'BRANCH DOWN WHEN≥0.50',
      'DIR UP',
      'SENSE HEIGHT',
      'PUSH 0.01',
      'LT',
      'SENSE DEPTH',
      'PUSH 0.04',
      'GT',
      'SENSE DEPTH',
      'PUSH 0.70',
      'LT',
      'AND',
      'AND',
      'GROW WHEN≥0.50',
      'DIR LEFT',
      'SENSE HEIGHT',
      'PUSH 0.01',
      'LT',
      'SENSE DEPTH',
      'PUSH 0.05',
      'GT',
      'SENSE RANDOM',
      'PUSH 0.40',
      'LT',
      'AND',
      'AND',
      'BRANCH RIGHT WHEN≥0.50',
      'DIR RIGHT',
      'SENSE HEIGHT',
      'PUSH 0.01',
      'LT',
      'SENSE DEPTH',
      'PUSH 0.05',
      'GT',
      'SENSE RANDOM',
      'PUSH 0.40',
      'LT',
      'AND',
      'AND',
      'BRANCH LEFT WHEN≥0.50',
    ],
  },
  {
    id: 'block-shoot',
    label: 'Побег и крона',
    description: 'Рост вверх до потолка',
    lines: [
      'DIR UP',
      'SENSE DEPTH',
      'PUSH 0.03',
      'LT',
      'SENSE HEIGHT',
      'PUSH 0.80',
      'LT',
      'SENSE ENERGY',
      'PUSH 0.10',
      'GT',
      'AND',
      'AND',
      'GROW WHEN≥0.50',
    ],
  },
  {
    id: 'block-seeds',
    label: 'Семена',
    description: 'Сброс семян при энергии и высоте',
    lines: [
      'DIR UP',
      'SENSE ENERGY',
      'PUSH 0.01',
      'GT',
      'SENSE HEIGHT',
      'PUSH 0.02',
      'GT',
      'AND',
      'SEED 0.28 WHEN≥0.50',
      'DIR UP',
      'SENSE HEIGHT',
      'PUSH 0.15',
      'GT',
      'SENSE ENERGY',
      'PUSH 0.01',
      'GT',
      'AND',
      'SEED 0.20 WHEN≥0.50',
    ],
  },
]

export interface HypothesisVariant {
  id: string
  label: string
  description: string
  /** Строки условия (без ACTION) */
  conditionLines: string[]
  /** Строка ACTION, к которой применяется гипотеза */
  actionLine: string
}

export const SNIPPETS: GenomeSnippet[] = [
  {
    id: 'cond-light',
    label: 'Свет выше порога',
    category: 'condition',
    description: 'Кладёт 1 на стек, если LIGHT > 0.5',
    lines: ['SENSE LIGHT', 'PUSH 0.50', 'GT'],
  },
  {
    id: 'cond-energy',
    label: 'Энергия выше порога',
    category: 'condition',
    description: 'Кладёт 1 на стек, если ENERGY > 0.3',
    lines: ['SENSE ENERGY', 'PUSH 0.30', 'GT'],
  },
  {
    id: 'cond-depth',
    label: 'В почве',
    category: 'condition',
    description: 'Глубина больше порога — клетка в почве',
    lines: ['SENSE DEPTH', 'PUSH 0.05', 'GT'],
  },
  {
    id: 'cond-height-low',
    label: 'Низкая высота',
    category: 'condition',
    description: 'Высота ниже 0.05 — у поверхности',
    lines: ['SENSE HEIGHT', 'PUSH 0.05', 'LT'],
  },
  {
    id: 'root-anchor',
    label: 'Якорь у поверхности',
    category: 'roots',
    description: 'Ветка вниз, если клетка у границы почва/воздух',
    lines: [
      'SENSE DEPTH',
      'PUSH 0.03',
      'LT',
      'SENSE HEIGHT',
      'PUSH 0.04',
      'LT',
      'AND',
      'BRANCH DOWN WHEN≥0.50',
    ],
  },
  {
    id: 'root-down',
    label: 'Корень вниз',
    category: 'roots',
    description: 'Рост корня вперёд (для dir=DOWN)',
    lines: [
      'DIR UP',
      'SENSE HEIGHT',
      'PUSH 0.01',
      'LT',
      'SENSE DEPTH',
      'PUSH 0.04',
      'GT',
      'SENSE DEPTH',
      'PUSH 0.70',
      'LT',
      'AND',
      'AND',
      'GROW WHEN≥0.50',
    ],
  },
  {
    id: 'root-side',
    label: 'Боковой корень',
    category: 'roots',
    description: 'Боковая ветка корня влево',
    lines: [
      'DIR LEFT',
      'SENSE HEIGHT',
      'PUSH 0.01',
      'LT',
      'SENSE DEPTH',
      'PUSH 0.05',
      'GT',
      'SENSE RANDOM',
      'PUSH 0.40',
      'LT',
      'AND',
      'AND',
      'BRANCH RIGHT WHEN≥0.50',
    ],
  },
  {
    id: 'grow-up',
    label: 'Рост вверх',
    category: 'growth',
    description: 'Побег вверх при низкой высоте',
    lines: [
      'DIR UP',
      'SENSE HEIGHT',
      'PUSH 0.03',
      'LT',
      'SENSE DEPTH',
      'PUSH 0.03',
      'LT',
      'AND',
      'GROW WHEN≥0.50',
    ],
  },
  {
    id: 'grow-crown',
    label: 'Крона',
    category: 'growth',
    description: 'Продолжение роста вверх до потолка',
    lines: [
      'DIR UP',
      'SENSE DEPTH',
      'PUSH 0.03',
      'LT',
      'SENSE HEIGHT',
      'PUSH 0.80',
      'LT',
      'SENSE ENERGY',
      'PUSH 0.10',
      'GT',
      'AND',
      'AND',
      'GROW WHEN≥0.50',
    ],
  },
  {
    id: 'seed-basic',
    label: 'Семя при энергии',
    category: 'seeds',
    description: 'Сброс семени при запасе энергии и высоте',
    lines: [
      'DIR UP',
      'SENSE ENERGY',
      'PUSH 0.01',
      'GT',
      'SENSE HEIGHT',
      'PUSH 0.02',
      'GT',
      'AND',
      'SEED 0.28 WHEN≥0.50',
    ],
  },
  {
    id: 'spike-side',
    label: 'Шип вбок',
    category: 'defense',
    description: 'Шип слева при достаточной энергии',
    lines: [
      'SENSE HEIGHT',
      'PUSH 0.05',
      'GT',
      'SENSE ENERGY',
      'PUSH 0.08',
      'GT',
      'AND',
      'SPIKE LEFT WHEN≥0.50',
    ],
  },
  {
    id: 'shoot-up',
    label: 'Выстрел вверх',
    category: 'defense',
    description: 'SHOOT вверх при чужаке рядом',
    lines: [
      'DIR UP',
      'SENSE FOREIGN',
      'SENSE HEIGHT',
      'PUSH 0.07',
      'GT',
      'SENSE ENERGY',
      'PUSH 0.07',
      'GT',
      'AND',
      'AND',
      'SHOOT UP WHEN≥0.50',
    ],
  },
  {
    id: 'nop',
    label: 'NOP',
    category: 'stack',
    description: 'Пустая операция',
    lines: ['NOP'],
  },
]

export const HYPOTHESIS_VARIANTS: HypothesisVariant[] = [
  {
    id: 'grow-light-vs-energy',
    label: 'Рост: свет vs энергия',
    description: 'Что важнее для GROW — свет или запас энергии?',
    conditionLines: ['SENSE LIGHT', 'PUSH 0.50', 'GT'],
    actionLine: 'GROW WHEN≥0.50',
  },
  {
    id: 'grow-light-energy-alt',
    label: 'Рост: энергия (альт.)',
    description: 'Условие на энергию вместо света',
    conditionLines: ['SENSE ENERGY', 'PUSH 0.30', 'GT'],
    actionLine: 'GROW WHEN≥0.50',
  },
  {
    id: 'seed-height-vs-age',
    label: 'Семя: высота vs возраст',
    description: 'Семя при высоте или при зрелости?',
    conditionLines: ['SENSE HEIGHT', 'PUSH 0.15', 'GT', 'SENSE ENERGY', 'PUSH 0.01', 'GT', 'AND'],
    actionLine: 'SEED 0.20 WHEN≥0.50',
  },
  {
    id: 'seed-age-alt',
    label: 'Семя: возраст (альт.)',
    description: 'Семя при возрасте растения',
    conditionLines: ['SENSE AGE', 'PUSH 0.50', 'GT', 'SENSE ENERGY', 'PUSH 0.01', 'GT', 'AND'],
    actionLine: 'SEED 0.20 WHEN≥0.50',
  },
  {
    id: 'spike-foreign-vs-random',
    label: 'Шип: чужак vs случайность',
    description: 'Шип при FOREIGN или вероятностно',
    conditionLines: ['SENSE FOREIGN', 'SENSE ENERGY', 'PUSH 0.08', 'GT', 'AND'],
    actionLine: 'SPIKE LEFT WHEN≥0.50',
  },
  {
    id: 'spike-random-alt',
    label: 'Шип: случайно (альт.)',
    description: 'Вероятностный шип',
    conditionLines: ['SENSE RANDOM', 'PUSH 0.30', 'LT', 'SENSE ENERGY', 'PUSH 0.08', 'GT', 'AND'],
    actionLine: 'SPIKE LEFT WHEN≥0.50',
  },
]

export interface CompletionItem {
  label: string
  insert: string
  detail?: string
}

const OPCODE_COMPLETIONS: CompletionItem[] = OPS.map((op) => ({
  label: op,
  insert: op === 'GROW' ? 'GROW WHEN≥0.50' : op === 'PUSH' ? 'PUSH 0.50' : op === 'SENSE' ? 'SENSE ENERGY' : op === 'DIR' ? 'DIR UP' : op === 'SEED' ? 'SEED 0.28 WHEN≥0.50' : op === 'BRANCH' || op === 'SPIKE' || op === 'SHOOT' ? `${op} UP WHEN≥0.50` : op,
  detail: 'опкод',
}))

const SENSOR_COMPLETIONS: CompletionItem[] = SENSORS.map((s) => ({
  label: s,
  insert: s,
  detail: 'сенсор',
}))

const DIR_COMPLETIONS: CompletionItem[] = DIRECTIONS.map((d) => ({
  label: d,
  insert: d,
  detail: 'направление',
}))

const WHEN_COMPLETIONS: CompletionItem[] = [
  { label: 'WHEN≥0.50', insert: 'WHEN≥0.50', detail: 'порог' },
  { label: 'WHEN prev ok', insert: 'WHEN prev ok', detail: 'порог' },
  { label: 'WHEN prev fail', insert: 'WHEN prev fail', detail: 'порог' },
]

export function getCompletions(partialLine: string, cursorPos: number): CompletionItem[] {
  const before = partialLine.slice(0, cursorPos)
  const tokens = before.trim().split(/\s+/)
  const lastToken = tokens[tokens.length - 1]?.toUpperCase() ?? ''
  const firstToken = tokens[0]?.toUpperCase() ?? ''

  if (tokens.length <= 1 && !before.includes(' ')) {
    const prefix = lastToken
    return OPCODE_COMPLETIONS.filter((c) => c.label.startsWith(prefix))
  }

  if (firstToken === 'SENSE') {
    return SENSOR_COMPLETIONS.filter((c) => c.label.startsWith(lastToken))
  }

  if (firstToken === 'DIR') {
    return DIR_COMPLETIONS.filter((c) => c.label.startsWith(lastToken))
  }

  if (['GROW', 'BRANCH', 'SPIKE', 'SHOOT', 'SEED'].includes(firstToken)) {
    if (before.includes('WHEN') || tokens.some((t) => t.startsWith('WHEN'))) {
      return WHEN_COMPLETIONS.filter((c) => c.label.toUpperCase().startsWith(lastToken))
    }
    if (['BRANCH', 'SPIKE', 'SHOOT'].includes(firstToken) && tokens.length === 2) {
      return [
        { label: 'UP', insert: 'UP', detail: 'WHERE' },
        { label: 'DOWN', insert: 'DOWN', detail: 'WHERE' },
        { label: 'LEFT', insert: 'LEFT', detail: 'WHERE' },
        { label: 'RIGHT', insert: 'RIGHT', detail: 'WHERE' },
      ].filter((c) => c.label.startsWith(lastToken))
    }
  }

  return []
}

export function snippetsByCategory(category: GenomeSnippet['category']): GenomeSnippet[] {
  return SNIPPETS.filter((s) => s.category === category)
}

export function hypothesisPairs(): { base: HypothesisVariant; alt: HypothesisVariant }[] {
  return [
    { base: HYPOTHESIS_VARIANTS[0]!, alt: HYPOTHESIS_VARIANTS[1]! },
    { base: HYPOTHESIS_VARIANTS[2]!, alt: HYPOTHESIS_VARIANTS[3]! },
    { base: HYPOTHESIS_VARIANTS[4]!, alt: HYPOTHESIS_VARIANTS[5]! },
  ]
}

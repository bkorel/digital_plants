import { useCallback, useRef, useState, startTransition, memo } from 'react'
import { cloneGenome, hardyTemplateGenome } from '../sim/genome'
import type { GenomeStepTraceView } from '../sim/genomeStepTrace'
import type { LabGenomeCoverage } from '../sim/labSession'
import type { Genome, SavedGenome } from '../sim/types'
import { Rng } from '../sim/rng'
import ConstructorLabPanel from './ConstructorLabPanel'
import GenomeEditor from './GenomeEditor'

interface Props {
  initialGenome?: Genome
  collection: SavedGenome[]
  onBack: () => void
  onSaveToCollection: (genome: Genome, name: string) => void
}

const ConstructorEditorPane = memo(function ConstructorEditorPane({
  genome,
  genomeRevision,
  executionCoverage,
  stepTrace,
  onCommit,
  onDraftChange,
}: {
  genome: Genome
  genomeRevision: number
  executionCoverage: LabGenomeCoverage | null
  stepTrace: GenomeStepTraceView | null
  onCommit: (g: Genome) => void
  onDraftChange: (g: Genome) => void
}) {
  return (
    <div className="constructor-screen__editor">
      <GenomeEditor
        key={genomeRevision}
        appliedGenome={genome}
        onCommit={onCommit}
        onDraftChange={onDraftChange}
        executionCoverage={executionCoverage}
        stepTrace={stepTrace}
      />
    </div>
  )
})

export default function GenomeConstructorScreen({
  initialGenome,
  collection,
  onBack,
  onSaveToCollection,
}: Props) {
  const [genome, setGenome] = useState<Genome>(
    () => initialGenome ?? hardyTemplateGenome(new Rng(42)),
  )
  const draftGenomeRef = useRef(genome)
  const [genomeRevision, setGenomeRevision] = useState(0)
  const [loadingGenome, setLoadingGenome] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [executionCoverage, setExecutionCoverage] = useState<LabGenomeCoverage | null>(null)
  const [stepTrace, setStepTrace] = useState<GenomeStepTraceView | null>(null)

  const onCoverageChange = useCallback((coverage: LabGenomeCoverage) => {
    setExecutionCoverage(coverage)
  }, [])

  const onStepTrace = useCallback((trace: GenomeStepTraceView | null) => {
    setStepTrace(trace)
  }, [])

  const commitGenome = useCallback((g: Genome) => {
    setGenome(g)
    draftGenomeRef.current = g
    setGenomeRevision((r) => r + 1)
    setExecutionCoverage(null)
    setStepTrace(null)
  }, [])

  const handleDraftChange = useCallback((g: Genome) => {
    draftGenomeRef.current = g
  }, [])

  const loadFromCollection = useCallback((g: Genome) => {
    const cloned = cloneGenome(g)
    setLoadingGenome(true)
    draftGenomeRef.current = cloned

    requestAnimationFrame(() => {
      startTransition(() => {
        setGenome(cloned)
        setGenomeRevision((r) => r + 1)
        setExecutionCoverage(null)
        setStepTrace(null)
      })
      requestAnimationFrame(() => setLoadingGenome(false))
    })
  }, [])

  const handleSave = () => {
    const name = saveName.trim() || `Конструктор ${new Date().toLocaleString('ru')}`
    onSaveToCollection(cloneGenome(draftGenomeRef.current), name)
    setSaveName('')
  }

  return (
    <div className="constructor-screen">
      {loadingGenome && (
        <div className="constructor-screen__loading" aria-live="polite">
          Загрузка генома…
        </div>
      )}
      <header className="constructor-screen__header">
        <button type="button" onClick={onBack}>
          ← Назад
        </button>
        <h1>Генетический конструктор</h1>
        <div className="constructor-screen__header-actions">
          <input
            type="text"
            placeholder="Имя для коллекции"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
          />
          <button type="button" onClick={handleSave}>
            Сохранить
          </button>
        </div>
      </header>

      <div className="constructor-screen__body">
        <ConstructorEditorPane
          genome={genome}
          genomeRevision={genomeRevision}
          executionCoverage={executionCoverage}
          stepTrace={stepTrace}
          onCommit={commitGenome}
          onDraftChange={handleDraftChange}
        />

        <ConstructorLabPanel
          genome={genome}
          sessionKey={genomeRevision}
          onCoverageChange={onCoverageChange}
          onStepTrace={onStepTrace}
        />
      </div>

      {collection.length > 0 && (
        <div className="constructor-screen__collection">
          <h3>Из коллекции</h3>
          <div className="constructor-screen__collection-list">
            {collection.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => loadFromCollection(cloneGenome(item.genome))}
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

import { useState } from 'react'
import { applyBoothImport, parseBoothCsv, parseBoothImportJson } from '../lib/import'
import {
  loadOtakon2026ArtistAlleySample,
  loadOtakon2026DealersSample,
  OTAKON_2026_ARTIST_ALLEY_SAMPLE,
  OTAKON_2026_DEALERS_SAMPLE,
  saveFloorMapBlob,
} from '../lib/sampleData'
import { getCopyPromptPackage } from '../lib/aiPrompt'

interface Props {
  eventId: number
  floorMapId?: number | null
  onDone: () => void
}

export function ImportPanel({ eventId, floorMapId, onDone }: Props) {
  const [jsonText, setJsonText] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [replace, setReplace] = useState(false)
  const [copied, setCopied] = useState(false)
  const [sampleBusy, setSampleBusy] = useState(false)

  const importText = async (text: string, kind: 'json' | 'csv') => {
    setError(null)
    setMessage(null)
    try {
      const data =
        kind === 'json' ? parseBoothImportJson(text) : parseBoothCsv(text)
      const result = await applyBoothImport(eventId, data, {
        replace,
        floorMapId: floorMapId ?? undefined,
      })
      setMessage(
        `Imported ${data.booths.length} booths (${result.booths} new, ${result.vendors} new vendors).`,
      )
      setJsonText('')
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const onFile = async (file: File) => {
    const text = await file.text()
    const kind = file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json'
    await importText(text, kind)
  }

  const onMapImage = async (file: File) => {
    setError(null)
    try {
      const dims = await saveFloorMapBlob(eventId, file, {
        mode: 'replace-active',
        name: file.name.replace(/\.[^.]+$/, '') || 'Floor map',
      })
      setMessage(`Map saved (${dims.width}×${dims.height}).`)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const loadDealersSample = async () => {
    setError(null)
    setMessage(null)
    setSampleBusy(true)
    try {
      const result = await loadOtakon2026DealersSample(eventId, { replace: true })
      setMessage(
        `Loaded ${OTAKON_2026_DEALERS_SAMPLE.label}: ${result.totalBooths} booths, ${result.obstacles} pillars, map ${result.width}×${result.height} (cached offline).`,
      )
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSampleBusy(false)
    }
  }

  const loadArtistAlleySample = async () => {
    setError(null)
    setMessage(null)
    setSampleBusy(true)
    try {
      const result = await loadOtakon2026ArtistAlleySample(eventId)
      setMessage(
        `Added ${OTAKON_2026_ARTIST_ALLEY_SAMPLE.label}: ${result.totalBooths} booths, map ${result.width}×${result.height}. Dealers map left as-is.`,
      )
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSampleBusy(false)
    }
  }

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(getCopyPromptPackage())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="stack-panel">
      <h3>Import</h3>
      <p className="muted">
        Load a floorplan image, then import booth JSON/CSV — or copy the AI prompt and paste
        results from Claude / ChatGPT.
      </p>

      <section className="panel-section">
        <h3>Sample data</h3>
        <p className="muted sm">
          Dealers replaces maps on this event. Artist Alley adds a second floor map and leaves
          Dealers alone. Online clients also get both from Cloud sync.
        </p>
        <div className="chip-row wrap">
          <button
            type="button"
            className="btn secondary"
            disabled={sampleBusy}
            onClick={() => void loadDealersSample()}
          >
            {sampleBusy ? 'Loading…' : `Load ${OTAKON_2026_DEALERS_SAMPLE.label}`}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={sampleBusy}
            onClick={() => void loadArtistAlleySample()}
          >
            {sampleBusy ? 'Loading…' : `Add ${OTAKON_2026_ARTIST_ALLEY_SAMPLE.label}`}
          </button>
        </div>
      </section>

      <section className="panel-section">
        <h3>1. Floor map image</h3>
        <p className="muted sm">
          Replaces the <strong>active</strong> map image. To add another hall without wiping this
          one, use Settings → Floor maps → Add another map.
        </p>
        <label className="file-btn">
          Choose image
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onMapImage(f)
              e.target.value = ''
            }}
          />
        </label>
      </section>

      <section className="panel-section">
        <h3>2. External AI helper</h3>
        <p className="muted sm">
          Copy the prompt + schema, paste into Claude Desktop or ChatGPT with your map image,
          then import the JSON below.
        </p>
        <button type="button" className="btn secondary" onClick={() => void copyPrompt()}>
          {copied ? 'Copied!' : 'Copy prompt + schema'}
        </button>
      </section>

      <section className="panel-section">
        <h3>3. Import booths (JSON / CSV)</h3>
        <label className="check-row">
          <input
            type="checkbox"
            checked={replace}
            onChange={(e) => setReplace(e.target.checked)}
          />
          Replace existing booths on the active map
        </label>
        <textarea
          className="textarea"
          rows={8}
          placeholder='{"event":"Otakon","booths":[{"id":"A12","label":"A12","name":"Vendor","rect":{"x":0.1,"y":0.2,"w":0.03,"h":0.02},"tags":["kits"]}]}'
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
        />
        <div className="btn-row">
          <button
            type="button"
            className="btn primary"
            disabled={!jsonText.trim()}
            onClick={() => void importText(jsonText, 'json')}
          >
            Import JSON
          </button>
          <label className="file-btn">
            Upload JSON/CSV
            <input
              type="file"
              accept=".json,.csv,application/json,text/csv"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onFile(f)
                e.target.value = ''
              }}
            />
          </label>
        </div>
        <p className="muted sm">
          CSV columns: booth,name,tags,x,y,w,h (tags pipe-separated). Coords optional — boxes
          auto-place if omitted.
        </p>
      </section>

      {message && <p className="ok">{message}</p>}
      {error && <p className="err">{error}</p>}
    </div>
  )
}

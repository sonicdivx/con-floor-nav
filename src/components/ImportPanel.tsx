import { useState } from 'react'
import { applyBoothImport, parseBoothCsv, parseBoothImportJson } from '../lib/import'
import { getCopyPromptPackage } from '../lib/aiPrompt'
import { db } from '../db/schema'

interface Props {
  eventId: number
  onDone: () => void
}

export function ImportPanel({ eventId, onDone }: Props) {
  const [jsonText, setJsonText] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [replace, setReplace] = useState(false)
  const [copied, setCopied] = useState(false)

  const importText = async (text: string, kind: 'json' | 'csv') => {
    setError(null)
    setMessage(null)
    try {
      const data =
        kind === 'json' ? parseBoothImportJson(text) : parseBoothCsv(text)
      const result = await applyBoothImport(eventId, data, { replace })
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
      const url = URL.createObjectURL(file)
      const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
        img.onerror = () => reject(new Error('Could not read image'))
        img.src = url
      })
      URL.revokeObjectURL(url)

      const existing = await db.floorMaps.where('eventId').equals(eventId).first()
      if (existing?.id != null) {
        await db.floorMaps.update(existing.id, {
          imageBlob: file,
          width: dims.w,
          height: dims.h,
        })
      } else {
        await db.floorMaps.add({
          eventId,
          imageBlob: file,
          width: dims.w,
          height: dims.h,
          createdAt: Date.now(),
        })
      }
      setMessage(`Map saved (${dims.w}×${dims.h}).`)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(getCopyPromptPackage())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="stack-panel">
      <h2>Setup & import</h2>
      <p className="muted">
        Load a floorplan image, then import booth JSON/CSV — or copy the AI prompt and paste
        results from Claude / ChatGPT.
      </p>

      <section className="panel-section">
        <h3>1. Floor map image</h3>
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
          Replace existing booths
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

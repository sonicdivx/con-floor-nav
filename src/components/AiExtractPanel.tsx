import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'
import { EXTERNAL_AI_PROMPT } from '../lib/aiPrompt'
import {
  extractBoothsWithAi,
  getAiProvider,
  getClaudeKey,
  getOpenAiKey,
  setAiProvider,
  setClaudeKey,
  setOpenAiKey,
  type AiProvider,
} from '../lib/aiExtract'
import { applyBoothImport, parseBoothImportJson } from '../lib/import'

interface Props {
  eventId: number
  onImported: () => void
}

export function AiExtractPanel({ eventId, onImported }: Props) {
  const floorMap = useLiveQuery(
    () => db.floorMaps.where('eventId').equals(eventId).first(),
    [eventId],
  )
  const [provider, setProvider] = useState<AiProvider>(getAiProvider())
  const [openAiKey, setOai] = useState(getOpenAiKey())
  const [claudeKey, setCk] = useState(getClaudeKey())
  const [vendorList, setVendorList] = useState('')
  const [reviewJson, setReviewJson] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const saveKeys = () => {
    setOpenAiKey(openAiKey.trim())
    setClaudeKey(claudeKey.trim())
    setAiProvider(provider)
    setMessage('API keys saved locally (never leave this device).')
  }

  const runExtract = async () => {
    setError(null)
    setMessage(null)
    if (!floorMap?.imageBlob) {
      setError('Upload a floor map image first.')
      return
    }
    setBusy(true)
    try {
      const json = await extractBoothsWithAi({
        imageBlob: floorMap.imageBlob,
        vendorListText: vendorList.trim() || undefined,
        prompt: EXTERNAL_AI_PROMPT,
        provider,
      })
      setReviewJson(json)
      setMessage('Review the JSON below, edit if needed, then save.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const saveReview = async () => {
    setError(null)
    try {
      const data = parseBoothImportJson(reviewJson)
      const result = await applyBoothImport(eventId, data, { replace: false })
      setMessage(
        `Saved ${data.booths.length} booths (${result.booths} new booths, ${result.vendors} new vendors).`,
      )
      onImported()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="stack-panel">
      <h2>Optional AI extraction</h2>
      <p className="muted">
        Online only — optional for pre-con prep. Keys stay in localStorage. Not required at the
        con.
      </p>

      <section className="panel-section">
        <h3>Provider & keys</h3>
        <div className="chip-row">
          <button
            type="button"
            className={`chip ${provider === 'openai' ? 'active' : ''}`}
            onClick={() => setProvider('openai')}
          >
            OpenAI
          </button>
          <button
            type="button"
            className={`chip ${provider === 'claude' ? 'active' : ''}`}
            onClick={() => setProvider('claude')}
          >
            Claude
          </button>
        </div>
        {provider === 'openai' ? (
          <input
            className="input"
            type="password"
            placeholder="OpenAI API key"
            value={openAiKey}
            onChange={(e) => setOai(e.target.value)}
            autoComplete="off"
          />
        ) : (
          <input
            className="input"
            type="password"
            placeholder="Anthropic API key"
            value={claudeKey}
            onChange={(e) => setCk(e.target.value)}
            autoComplete="off"
          />
        )}
        <button type="button" className="btn secondary" onClick={saveKeys}>
          Save keys locally
        </button>
      </section>

      <section className="panel-section">
        <h3>Optional vendor list</h3>
        <textarea
          className="textarea"
          rows={4}
          placeholder="Paste booth numbers and names to help matching…"
          value={vendorList}
          onChange={(e) => setVendorList(e.target.value)}
        />
        <button
          type="button"
          className="btn primary"
          disabled={busy || !floorMap}
          onClick={() => void runExtract()}
        >
          {busy ? 'Extracting…' : 'Extract from map'}
        </button>
      </section>

      {reviewJson && (
        <section className="panel-section">
          <h3>Review before save</h3>
          <textarea
            className="textarea mono"
            rows={12}
            value={reviewJson}
            onChange={(e) => setReviewJson(e.target.value)}
          />
          <button type="button" className="btn primary" onClick={() => void saveReview()}>
            Save reviewed JSON
          </button>
        </section>
      )}

      {message && <p className="ok">{message}</p>}
      {error && <p className="err">{error}</p>}
    </div>
  )
}

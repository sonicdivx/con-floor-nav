import { IMPORT_SCHEMA_EXAMPLE } from './import'
import { DEFAULT_TAGS } from '../db/types'

export const EXTERNAL_AI_PROMPT = `You are helping extract dealer/artist-alley booth layout data from a convention floor map image (and optionally a vendor list).

Return ONLY valid JSON matching this schema (no markdown fences, no commentary):

${JSON.stringify(IMPORT_SCHEMA_EXAMPLE, null, 2)}

Rules:
- Coordinates are normalized 0–1 relative to the map image (origin top-left).
- rect: { x, y, w, h } where x,y is the top-left corner of the booth box.
- id / label should match booth numbers on the map when visible.
- name is the vendor/artist name when known; omit if unknown.
- tags: choose from [${DEFAULT_TAGS.join(', ')}] when you can infer; otherwise omit or use "other".
- Include every booth you can reasonably locate. Approximate boxes are fine — the user will nudge them in the app.
- If a vendor list is provided, match names to booth numbers and place rects on the map.

Output a single JSON object with "event" (if known) and "booths" array.`

export function getCopyPromptPackage(): string {
  return EXTERNAL_AI_PROMPT
}

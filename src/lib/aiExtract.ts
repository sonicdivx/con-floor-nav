const OPENAI_KEY = 'cfn-openai-key'
const CLAUDE_KEY = 'cfn-claude-key'
const AI_PROVIDER = 'cfn-ai-provider'

export type AiProvider = 'openai' | 'claude'

export function getOpenAiKey(): string {
  return localStorage.getItem(OPENAI_KEY) ?? ''
}

export function setOpenAiKey(key: string) {
  if (key) localStorage.setItem(OPENAI_KEY, key)
  else localStorage.removeItem(OPENAI_KEY)
}

export function getClaudeKey(): string {
  return localStorage.getItem(CLAUDE_KEY) ?? ''
}

export function setClaudeKey(key: string) {
  if (key) localStorage.setItem(CLAUDE_KEY, key)
  else localStorage.removeItem(CLAUDE_KEY)
}

export function getAiProvider(): AiProvider {
  const v = localStorage.getItem(AI_PROVIDER)
  return v === 'claude' ? 'claude' : 'openai'
}

export function setAiProvider(p: AiProvider) {
  localStorage.setItem(AI_PROVIDER, p)
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function extractJson(text: string): string {
  const trimmed = text.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) return fence[1].trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1)
  return trimmed
}

export async function extractBoothsWithAi(opts: {
  imageBlob: Blob
  vendorListText?: string
  prompt: string
  provider: AiProvider
}): Promise<string> {
  const mime = opts.imageBlob.type || 'image/png'
  const b64 = await blobToBase64(opts.imageBlob)
  const userText = [
    opts.prompt,
    opts.vendorListText
      ? `\n\nOptional vendor list:\n${opts.vendorListText}`
      : '',
  ].join('')

  if (opts.provider === 'openai') {
    const key = getOpenAiKey()
    if (!key) throw new Error('Add an OpenAI API key in Settings first.')
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: userText },
              {
                type: 'image_url',
                image_url: { url: `data:${mime};base64,${b64}` },
              },
            ],
          },
        ],
        max_tokens: 8000,
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`OpenAI error: ${res.status} ${err}`)
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content ?? ''
    return extractJson(content)
  }

  const key = getClaudeKey()
  if (!key) throw new Error('Add a Claude API key in Settings first.')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mime, data: b64 },
            },
            { type: 'text', text: userText },
          ],
        },
      ],
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Claude error: ${res.status} ${err}`)
  }
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>
  }
  const text =
    data.content?.filter((c) => c.type === 'text').map((c) => c.text).join('\n') ??
    ''
  return extractJson(text)
}

import { GoogleGenAI } from '@google/genai'

// Vision-capable fallback chain (confirmed working with inline image data on free tier).
// Models are tried in order; we skip 429 rate-limits and move to the next.
// We do NOT retry on 400 Bad Request — those are genuine errors.
// Removed from chain (do NOT add back):
// - gemini-flash-latest     → 400: rejects inlineData image bytes
// - gemini-pro-latest       → permanent 429 on free tier (quota = 0)
// - gemini-2.5-pro          → permanent 429 on free tier (quota = 0)
const VISION_FALLBACK_CHAIN = [
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-exp', // highly available on free tier testing
]

const TEXT_FALLBACK_CHAIN = [
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-exp',
]

export async function callGeminiWithFallback(
  options: {
    prompt: string
    imageBase64?: string
    responseSchema?: any
    temperature?: number
    useGoogleSearch?: boolean
  }
): Promise<any> {
  const keysStr = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || ''
  const apiKeys = keysStr.split(',').map(k => k.trim()).filter(Boolean)

  if (apiKeys.length === 0) {
    throw new Error('GEMINI_API_KEYS environment variable is not set.')
  }

  let cleanBase64 = ''
  let mimeType = 'image/jpeg'
  if (options.imageBase64) {
    if (options.imageBase64.startsWith('data:')) {
      const match = options.imageBase64.match(/^data:([^;]+);base64,(.*)$/)
      if (match) {
        mimeType = match[1]
        cleanBase64 = match[2]
      } else {
        cleanBase64 = options.imageBase64
      }
    } else {
      cleanBase64 = options.imageBase64
    }
  }

  // Choose chain based on whether an image is included
  const chain = cleanBase64 ? VISION_FALLBACK_CHAIN : TEXT_FALLBACK_CHAIN

  let lastError: any = null

  // Loop through available API keys
  for (const apiKey of apiKeys) {
    const maskedKey = `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`
    
    // Loop through fallback models
    for (const model of chain) {
      try {
        console.log(`[Gemini SDK fallback] Attempting call with model: ${model} using key ${maskedKey}`)
        const ai = new GoogleGenAI({ apiKey })

        const parts: any[] = []
        if (cleanBase64) {
          parts.push({
            inlineData: {
              data: cleanBase64,
              mimeType
            }
          })
        }
        parts.push({ text: options.prompt })

        const apiResponse = await ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts
            }
          ],
          config: {
            temperature: options.temperature ?? 0.1,
            tools: options.useGoogleSearch ? [{ googleSearch: {} }] : undefined,
            responseMimeType: options.responseSchema ? 'application/json' : undefined,
            responseSchema: options.responseSchema
          }
        })

        const text = apiResponse.text
        if (!text) {
          throw new Error(`Model ${model} returned empty response text`)
        }

        if (options.responseSchema) {
          return JSON.parse(text.trim())
        }
        return text.trim()
      } catch (err: any) {
        const errMsg = err.message || ''
        const statusCode = err.status || err.statusCode || 0

        console.warn(`[Gemini SDK fallback] Model ${model} failed (${statusCode}) with key ${maskedKey}: ${errMsg.slice(0, 200)}`)
        lastError = err

        if (statusCode === 429) {
          // Rate limit or quota exhaustion hit. 
          // Break the model loop and try the next API key.
          break
        }
        
        // Other errors (e.g. 500, model unsupported) -> try next model with same key.
        continue
      }
    }
  }

  throw lastError || new Error('All models in fallback chain failed.')
}

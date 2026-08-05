import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@bantayog/db'
import { ProductsService } from './products.service.js'

import { type AppResult, ok, err, ValidationError } from '../lib/errors.js'
import { callGeminiWithFallback } from '../lib/gemini-client.js'
import { recordVisionScan, recordScanOutcome } from '../lib/analytics-metrics.js'

export interface CandidateResult {
  name: string
  confidence: number
  product: {
    id: string
    name: string
    eligibility_status: 'eligible' | 'ineligible'
    category: string
  } | null
}

export interface VisionClassificationSuccess {
  identified: true
  candidates: CandidateResult[]
}

export interface VisionClassificationFailure {
  identified: false
  reason: string
}

export type VisionClassificationResult = VisionClassificationSuccess | VisionClassificationFailure

export class VisionService {
  private productsService: ProductsService

  constructor(db: SupabaseClient<Database>) {
    this.productsService = new ProductsService(db)
  }

  /**
   * Identifies a product in an image using Gemini vision,
   * then matches each candidate against the local products catalog.
   */
  async classifyProduct(imageBase64: string): Promise<AppResult<VisionClassificationResult>> {
    if (!imageBase64 || imageBase64.trim() === '') {
      return ok({ identified: false, reason: 'Empty image data provided' })
    }

    try {
      const confidenceThreshold = parseFloat(process.env.GEMINI_CONFIDENCE_THRESHOLD || '0.7')

      const responseObj = await callGeminiWithFallback({
        prompt: 'Analyze the product shown in this image. Identify the brand and product name. Return a list of candidates sorted by likelihood.',
        imageBase64: imageBase64,
        useGoogleSearch: true,
        temperature: 0.1,
        responseSchema: {
          type: 'OBJECT',
          properties: {
            candidates: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  name: { type: 'STRING', description: 'Identified name of the product' },
                  confidence: { type: 'NUMBER', description: 'Confidence score from 0.0 to 1.0' }
                },
                required: ['name', 'confidence']
              }
            }
          },
          required: ['candidates']
        }
      })

      const rawCandidates = responseObj?.candidates || []

      const filteredCandidates = rawCandidates.filter(
        (c: any) => c && typeof c.name === 'string' && typeof c.confidence === 'number' && c.confidence >= confidenceThreshold
      )

      if (filteredCandidates.length === 0) {
        return ok({ identified: false, reason: 'unrecognizable' })
      }

      const candidatesWithProducts: CandidateResult[] = []

      for (const candidate of filteredCandidates) {
        const matchResult = await this.productsService.validateProduct(candidate.name)
        if (matchResult.isOk()) {
          const matchResultValue = matchResult.value
          candidatesWithProducts.push({
            name: candidate.name,
            confidence: candidate.confidence,
            product: matchResultValue.matched ? matchResultValue.product : null
          })
        } else {
          candidatesWithProducts.push({
            name: candidate.name,
            confidence: candidate.confidence,
            product: null
          })
        }
      }

      return ok({
        identified: true,
        candidates: candidatesWithProducts
      })

    } catch (error: any) {
      console.error('Vision classification failed:', error)
      return err(new ValidationError(`Vision classification failed: ${error.message}`))
    }
  }

  /**
   * Prompts Gemini to analyze the product in an image and return a child safety verdict.
   */
  async analyzeChildSafety(imageBase64: string): Promise<AppResult<any>> {
    if (!imageBase64 || imageBase64.trim() === '') {
      return err(new ValidationError('Empty image data provided'))
    }

    try {
      const responseObj = await callGeminiWithFallback({
        prompt: 'Identify the product brand and name in this image. Grounding instruction: Search the web/internet to verify the exact ingredients, sugar content, chemical additives, common allergens, and child-suitability guidelines for this product. Base your analysis only on verified web sources and what is visibly identifiable in the image. If the product, brand, or ingredients cannot be confidently identified (due to dark image, poor lighting, or blur), return "Unrecognizable" as the product_name and false for is_child_friendly.',
        imageBase64: imageBase64,
        useGoogleSearch: true,
        temperature: 0.1,
        responseSchema: {
          type: 'OBJECT',
          properties: {
            product_name: { type: 'STRING', description: 'Name of the identified product' },
            is_child_friendly: { type: 'BOOLEAN', description: 'Whether the product is child-friendly / suitable for children' },
            flagged_ingredients: { 
              type: 'ARRAY', 
              items: { type: 'STRING' },
              description: 'List of ingredients that are concerning or flagged (empty if none)'
            },
            reasoning: { type: 'STRING', description: 'Explanation or reasoning for the child-safety verdict' }
          },
          required: ['product_name', 'is_child_friendly', 'flagged_ingredients', 'reasoning']
        }
      })

      return ok(responseObj)

    } catch (error: any) {
      console.error('Child safety vision analysis failed:', error)
      return err(new ValidationError(`Child safety vision analysis failed: ${error.message}`))
    }
  }

  /**
   * Fully Optimized Single-Step Pipeline
   */
  async analyzeScan(imageBase64: string): Promise<AppResult<any>> {
    if (!imageBase64 || imageBase64.trim() === '') {
      return err(new ValidationError('Empty image data provided'))
    }

    let cleanBase64 = imageBase64
    if (imageBase64.startsWith('data:')) {
      const match = imageBase64.match(/^data:([^;]+);base64,(.*)$/)
      if (match) {
        cleanBase64 = match[2]
      }
    }

    // AI Vision Performance widget (admin analytics tab): records the
    // wall-clock latency and outcome of every scan attempt through this
    // pipeline. "Success" means the pipeline returned a verdict
    // (blurry/unrecognized/identified all count); only a thrown error below
    // is recorded as a failure. There is no confidence-score field on the
    // Gemini response, so none is recorded.
    const scanStartedAt = Date.now()

    try {
      console.log('[VisionService] Running optimized single-step scan...')
      const prompt = `Analyze the product shown in this image.
Grounding instruction: Only assert a product identification or nutritional judgment you are confident in from what's visible in the image. 
Focus strictly on the main subject (ignore background items). Inspect not just the largest printed text, but also logos, circular seals, badges, and small emblem marks — brand names are often embedded inside these. Be mindful of local Philippine brands.

Classify the outcome into exactly one of three statuses:
- "blurry": Use this ONLY if the image is too blurry, too dark, or too low quality to analyze the main product.
- "unrecognized": Use this if you cannot confidently identify the exact brand or product name, but the image is not blurry (e.g. generic packaging without labels, or obscure local product).
- "identified": Use this if you are confident in the product name and brand.

If the status is "unrecognized" or "identified", perform a child safety gate evaluation: is it good/safe for children? (is_child_friendly). List any flagged ingredients (e.g. high sugar, high sodium, artificial preservatives, common allergens). 
For the reasoning, write a very concise, professional explanation (max 2 sentences) written for a merchant. E.g., "Contains excessive sugar and artificial colors, which are restricted under local child nutrition guidelines."

If the status is "identified", also research:
1. A typical retail market price (base price) in Philippine Pesos (PHP) for this product in the Philippines.
2. A matching nutrition category from this list: FRUITS, VEGETABLES, MEATS, BEVERAGES, DAIRY, GRAINS, CANNED_GOODS, SNACKS, OTHER.

Return JSON matching this schema:
{
  "status": "blurry" | "unrecognized" | "identified",
  "product_name": "identified product name with brand (empty if unrecognized or blurry)",
  "is_child_friendly": boolean,
  "reasoning": "A concise explanation for child safety verdict (at most 2 sentences)",
  "flagged_ingredients": ["array of concerning ingredients"],
  "researched_base_price": number (typical price in PHP, or null if blurry/unrecognized),
  "category": "FRUITS" | "VEGETABLES" | "MEATS" | "BEVERAGES" | "DAIRY" | "GRAINS" | "CANNED_GOODS" | "SNACKS" | "OTHER" (or null if blurry/unrecognized)
}`

      const schema = {
        type: 'OBJECT',
        properties: {
          status: { type: 'STRING', enum: ['blurry', 'unrecognized', 'identified'] },
          product_name: { type: 'STRING', description: 'Product name with brand' },
          is_child_friendly: { type: 'BOOLEAN', description: 'Is suitable for children' },
          reasoning: { type: 'STRING', description: 'Detailed reasoning for the nutritional verdict' },
          flagged_ingredients: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: 'List of flagged ingredients'
          },
          researched_base_price: { type: 'NUMBER', description: 'Typical price in PHP or null' },
          category: {
            type: 'STRING',
            enum: ['FRUITS', 'VEGETABLES', 'MEATS', 'BEVERAGES', 'DAIRY', 'GRAINS', 'CANNED_GOODS', 'SNACKS', 'OTHER'],
            description: 'Nutrition category'
          }
        },
        required: ['status', 'product_name', 'is_child_friendly', 'reasoning', 'flagged_ingredients']
      }

      const result = await callGeminiWithFallback({
        prompt,
        imageBase64: cleanBase64,
        temperature: 0.1,
        responseSchema: schema,
        useGoogleSearch: false
      })

      if (result.status === 'blurry') {
        void recordVisionScan({ success: true, latencyMs: Date.now() - scanStartedAt })
        void recordScanOutcome({ approved: false, rejectionReason: 'blurry' })
        return ok({
          status: 'blurry',
          reasoning: 'Photo is too blurry to analyze — please retake the picture'
        })
      }

      if (result.status === 'unrecognized') {
        void recordVisionScan({ success: true, latencyMs: Date.now() - scanStartedAt })
        void recordScanOutcome({ approved: false, rejectionReason: 'unrecognized' })
        return ok({
          status: 'unrecognized',
          productName: result.product_name || 'Unrecognized Brand',
          isChildFriendly: result.is_child_friendly,
          reasoning: result.reasoning,
          flaggedIngredients: result.flagged_ingredients
        })
      }

      if (result.status === 'identified') {
        const pName = result.product_name || 'Identified Product'
        
        // Call ProductsService to get/create product and save the scan image
        const imageWithPrefix = cleanBase64.startsWith('data:') ? cleanBase64 : `data:image/jpeg;base64,${cleanBase64}`
        const categoryVal = result.category || 'VEGETABLES'
        
        const dbProductResult = await this.productsService.validateOrCreateProduct(pName, imageWithPrefix, categoryVal)
        let dbProduct: any = null
        if (dbProductResult.isOk()) {
          dbProduct = dbProductResult.value.product
        }

        const basePrice = result.researched_base_price || 50
        const eligibilityStatus = dbProduct
          ? dbProduct.eligibility_status
          : (result.is_child_friendly ? 'eligible' : 'ineligible')
        void recordVisionScan({ success: true, latencyMs: Date.now() - scanStartedAt })
        void recordScanOutcome({
          approved: eligibilityStatus === 'eligible',
          rejectionReason: eligibilityStatus === 'eligible' ? undefined : 'ineligible',
        })
        return ok({
          status: 'identified',
          productName: dbProduct ? dbProduct.name : pName,
          eligibilityStatus,
          isChildFriendly: dbProduct ? dbProduct.eligibility_status === 'eligible' : result.is_child_friendly,
          priceRangeMin: dbProduct ? Number(dbProduct.price_range_min) : Math.max(0, basePrice - 10),
          priceRangeMax: dbProduct ? Number(dbProduct.price_range_max) : basePrice + 10,
          reasoning: result.reasoning,
          flaggedIngredients: result.flagged_ingredients,
          category: dbProduct ? dbProduct.category : categoryVal,
          imageUrl: dbProduct ? dbProduct.image_url : imageWithPrefix
        })
      }

      void recordVisionScan({ success: false, latencyMs: Date.now() - scanStartedAt })
      void recordScanOutcome({ approved: false, rejectionReason: 'error' })
      return err(new ValidationError('Invalid status returned from Gemini API'))
    } catch (error: any) {
      void recordVisionScan({ success: false, latencyMs: Date.now() - scanStartedAt })
      void recordScanOutcome({ approved: false, rejectionReason: 'error' })
      console.error('Unified scan analysis failed:', error)
      const errMsg: string = error.message || ''
      if (errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('429')) {
        return err(new ValidationError('rate_limit: AI service is temporarily busy. Please wait a moment and try again.'))
      }
      if (errMsg.includes('INVALID_ARGUMENT') || errMsg.includes('400')) {
        return err(new ValidationError(`image_error: Could not process the image. Try capturing again in better lighting. (${errMsg.slice(0, 100)}`))
      }
      return err(new ValidationError(`scan_error: ${errMsg.slice(0, 200)}`))
    }
  }

}

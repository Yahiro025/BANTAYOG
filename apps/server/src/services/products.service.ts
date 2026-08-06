import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@bantayog/db'
import { ProductRepository } from '../repositories/product.repository.js'
import { type AppResult, ok, err, PersistenceError } from '../lib/errors.js'
import { callGeminiWithFallback } from '../lib/gemini-client.js'

export interface ValidationSuccessResult {
  matched: true
  product: {
    id: string
    name: string
    eligibility_status: 'eligible' | 'ineligible'
    category: string
    price_range_min: number
    price_range_max: number
    image_url?: string | null
  }
}

export interface ValidationFailureResult {
  matched: false
  reason: string
}

export type ValidationResult = ValidationSuccessResult | ValidationFailureResult

export class ProductsService {
  private productRepo: ProductRepository
  private db: SupabaseClient<Database>

  constructor(db: SupabaseClient<Database>) {
    this.db = db
    this.productRepo = new ProductRepository(db)
  }

  // Validates a product name against the catalog.
// Performs case-insensitive matches using fuzzy/ILIKE query logic.
  async validateProduct(name: string): Promise<AppResult<ValidationResult>> {
    if (!name || name.trim() === '') {
      return ok({ matched: false, reason: 'Empty product name provided' })
    }

    try {
      const results = await this.productRepo.findByNameFuzzy(name.trim())

      if (!results || results.length === 0) {
        return ok({ matched: false, reason: 'Product not found in catalog' })
      }

      // Find the best/first match from the list
      const matched = results[0] as any
      return ok({
        matched: true,
        product: {
          id: matched.id,
          name: matched.name,
          eligibility_status: matched.eligibility_status,
          category: matched.category,
          price_range_min: Number(matched.price_range_min),
          price_range_max: Number(matched.price_range_max),
          image_url: matched.image_url
        }
      })
    } catch (error: any) {
      return err(new PersistenceError(`Database lookup failed: ${error.message}`, 'products'))
    }
  }

  // Looks up a product by exact GTIN barcode (EAN-13/EAN-8/UPC-A/UPC-E).
  // UPC-A (12 digits) and its EAN-13 form (leading zero) describe the same
  // product, so both candidates are tried when the caller sends the 12-digit
  // form — the catalog is canonicalized to EAN-13 by the seed script.
  async validateByGtin(gtin: string): Promise<AppResult<ValidationResult>> {
    try {
      const candidates = gtin.length === 12 ? [gtin, `0${gtin}`] : [gtin]
      let matched: any = null
      for (const candidate of candidates) {
        matched = await this.productRepo.findByGtin(candidate)
        if (matched) break
      }

      if (!matched) {
        return ok({ matched: false, reason: 'No product found for this barcode' })
      }

      return ok({
        matched: true,
        product: {
          id: matched.id,
          name: matched.name,
          eligibility_status: matched.eligibility_status,
          category: matched.category,
          price_range_min: Number(matched.price_range_min),
          price_range_max: Number(matched.price_range_max),
          image_url: matched.image_url
        }
      })
    } catch (error: any) {
      return err(new PersistenceError(`Database lookup failed: ${error.message}`, 'products'))
    }
  }

  // Validates a product by name. If it doesn't exist, researches it via Gemini,
// creates a draft row with category='Draft' and ±₱10 price range, and returns it.
  async validateOrCreateProduct(
    name: string,
    imageUrl?: string,
    category?: string
  ): Promise<AppResult<ValidationSuccessResult>> {
    const trimmedName = name.trim()
    
    try {
      // 1. Exact/fuzzy check to prevent duplicates
      const { data: existing, error } = await this.db
        .from('products')
        .select('*')
        .ilike('name', trimmedName)
        .limit(1)

      if (error) throw error

      if (existing && existing.length > 0) {
        const matched = existing[0] as any
        let needsUpdate = false
        const updatePayload: any = {}

        if (!matched.image_url && imageUrl) {
          updatePayload.image_url = imageUrl
          needsUpdate = true
        }
        if (matched.category === 'Draft' && category && category !== 'Draft') {
          updatePayload.category = category
          needsUpdate = true
        }

        if (needsUpdate) {
          const { error: updateError } = await (this.db as any)
            .from('products')
            .update(updatePayload)
            .eq('id', matched.id)
          
          if (!updateError) {
            if (updatePayload.image_url) matched.image_url = updatePayload.image_url
            if (updatePayload.category) matched.category = updatePayload.category
          }
        }

        return ok({
          matched: true,
          product: {
            id: matched.id,
            name: matched.name,
            eligibility_status: matched.eligibility_status as 'eligible' | 'ineligible',
            category: matched.category,
            price_range_min: Number(matched.price_range_min),
            price_range_max: Number(matched.price_range_max),
            image_url: matched.image_url
          }
        })
      }

      // 2. Not found in catalog. Perform Gemini base price research
      console.log(`[ProductsService] Product "${trimmedName}" not found in DB. Researching price...`)
      
      const prompt = `Research the typical retail market price (base price) in Philippine Pesos (PHP) for the product "${trimmedName}" in the Philippines.
Additionally, verify if this product is child-friendly / suitable for children.
Grounding instruction: Only assert a product identification or nutritional judgment you are confident in from what's visible or verifiable via research. If uncertain, say so rather than guessing.

Return JSON matching this schema:
{
  "researched_base_price": number,
  "is_child_friendly": boolean,
  "reasoning": "brief reasoning"
}`

      const schema = {
        type: 'OBJECT',
        properties: {
          researched_base_price: { type: 'NUMBER', description: 'Typical base price in PHP' },
          is_child_friendly: { type: 'BOOLEAN', description: 'Is suitable/safe for children' },
          reasoning: { type: 'STRING', description: 'Brief nutritional verdict reasoning' }
        },
        required: ['researched_base_price', 'is_child_friendly', 'reasoning']
      }

      let researchedBasePrice = 50 // sensible default PHP
      let isChildFriendly = true

      try {
        const geminiRes = await callGeminiWithFallback({
          prompt,
          responseSchema: schema,
          temperature: 0.1
        })
        if (geminiRes && typeof geminiRes.researched_base_price === 'number') {
          researchedBasePrice = geminiRes.researched_base_price
          isChildFriendly = geminiRes.is_child_friendly
        }
      } catch (geminiErr) {
        console.error(`[ProductsService] Gemini price research failed for "${trimmedName}", using defaults:`, geminiErr)
      }

      const minPrice = Math.max(0, researchedBasePrice - 10)
      const maxPrice = researchedBasePrice + 10

      // 3. Insert new draft row
      const inserted = await this.productRepo.insert({
        name: trimmedName,
        category: category || 'Draft', // Mark as draft category for admin review or use AI category
        eligibility_status: isChildFriendly ? 'eligible' : 'ineligible',
        price_range_min: minPrice,
        price_range_max: maxPrice,
        image_url: imageUrl || null
      } as any)

      return ok({
        matched: true,
        product: {
          id: inserted.id,
          name: inserted.name,
          eligibility_status: inserted.eligibility_status as 'eligible' | 'ineligible',
          category: inserted.category,
          price_range_min: Number(inserted.price_range_min),
          price_range_max: Number(inserted.price_range_max),
          image_url: inserted.image_url
        }
      })
    } catch (errVal: any) {
      return err(new PersistenceError(`Failed to validate or create product "${trimmedName}": ${errVal.message}`, 'products'))
    }
  }
}


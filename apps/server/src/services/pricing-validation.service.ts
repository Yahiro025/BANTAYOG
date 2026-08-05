import { MarketPricesService } from './market-prices.service.js'
import { type AppResult, ok, err, ValidationError } from '../lib/errors.js'
import { callGeminiWithFallback } from '../lib/gemini-client.js'

export class PricingValidationService {
  private marketPricesService: MarketPricesService

  constructor() {
    this.marketPricesService = new MarketPricesService()
  }

  // Validates non-branded (wet market/palengke) products using Gemini.
// Incorporates the Fail Fast principle: rejects products not found in official DA-AMAS records.
  async validateNonBranded(
    imageBase64: string,
    productName: string,
    price: number,
    unit: string
  ): Promise<AppResult<any>> {
    if (!imageBase64 || imageBase64.trim() === '') {
      return err(new ValidationError('Empty image data provided'))
    }
    if (!productName || productName.trim() === '') {
      return err(new ValidationError('Product name is required'))
    }

    let cleanBase64 = imageBase64
    if (imageBase64.startsWith('data:')) {
      const match = imageBase64.match(/^data:([^;]+);base64,(.*)$/)
      if (match) {
        cleanBase64 = match[2]
      }
    }

    try {
      console.log(`[PricingValidationService] Validating non-branded product: ${productName} (${price} ${unit})`)
      
      const marketPriceResult = await this.marketPricesService.searchMarketPrice(productName)
      
      // FAIL FAST: If not found in DA-AMAS static records, reject immediately.
      if (!marketPriceResult.isOk() || !marketPriceResult.value) {
        console.warn(`[PricingValidationService] Fail Fast triggered: Market price not found for ${productName}`)
        return ok({
          isJustified: false,
          isChildFriendly: false,
          reasoning: `Product price for "${productName}" is not found in official DA-AMAS records. Cannot validate.`,
          flaggedIngredients: [],
          researchedPriceMin: 0,
          researchedPriceMax: 0,
          suggestedCategory: 'OTHER',
          mismatchReason: 'Price validation failed: Commodity not recognized in national price bulletins.'
        })
      }

      const data = marketPriceResult.value

      // STRICT PRICE CHECK (FAIL FAST): +/- 20% tolerance
      const minAllowedPrice = data.price_min * 0.8
      const maxAllowedPrice = data.price_max * 1.2

      if (price < minAllowedPrice || price > maxAllowedPrice) {
        console.warn(`[PricingValidationService] Strict Price Fail: Entered ₱${price}, Allowed: ₱${minAllowedPrice} - ₱${maxAllowedPrice}`)
        return ok({
          isJustified: false,
          isChildFriendly: false,
          reasoning: `The entered price of ₱${price} is outside the allowed market range (₱${minAllowedPrice.toFixed(2)} - ₱${maxAllowedPrice.toFixed(2)}).`,
          flaggedIngredients: [],
          researchedPriceMin: data.price_min,
          researchedPriceMax: data.price_max,
          suggestedCategory: data.category || 'OTHER',
          mismatchReason: `Price ₱${price} is severely out of bounds based on the official DA-AMAS range of ₱${data.price_min} - ₱${data.price_max}.`
        })
      }

      const contextText = `\n[SYSTEM CONTEXT - LATEST OFFICIAL PRICES]\nAccording to official data (Source: ${data.source}) as of ${data.as_of_date}:\n- "${data.commodity_name}": ₱${data.price_min} - ₱${data.price_max} ${data.unit}\nUse this as your strict baseline for price evaluation.\n`

      const prompt = `You are an AI assistant helping validate wet market (palengke) transactions in the Philippines.
The merchant has taken a photo of a product and manually entered the following details:
- Product Name: "${productName}"
- Price: ₱${price}
- Unit: ${unit}
${contextText}
Perform the following validation:
1. Compare the entered Product Name against the provided image. Do they match? If not, flag it.
2. Evaluate child safety/nutritional suitability (is_child_friendly). List any flagged ingredients. Most fresh wet market goods (fruits, veg, meat) are highly nutritious and child-friendly unless they are processed goods.
3. Determine a category from: FRUITS, VEGETABLES, MEATS, BEVERAGES, DAIRY, GRAINS, CANNED_GOODS, SNACKS, OTHER.

Return JSON matching this schema:
{
  "is_justified": boolean, // true if product name matches image AND price is within reasonable range
  "is_child_friendly": boolean, // true if nutritious/safe for children
  "reasoning": "A concise explanation for the validation verdict and child safety (at most 2 sentences)",
  "flagged_ingredients": ["array of concerning ingredients, empty if fresh/safe"],
  "researched_price_min": number, // lower bound of reasonable price
  "researched_price_max": number, // upper bound of reasonable price
  "suggested_category": "FRUITS" | "VEGETABLES" | "MEATS" | "BEVERAGES" | "DAIRY" | "GRAINS" | "CANNED_GOODS" | "SNACKS" | "OTHER",
  "mismatch_reason": "If is_justified is false, briefly explain why (e.g., 'Image shows an apple but product name is orange', 'Price ₱1000 is too high for 1 piece of onion'). Leave empty if justified."
}`

      const schema = {
        type: 'OBJECT',
        properties: {
          is_justified: { type: 'BOOLEAN', description: 'Overall validation pass/fail' },
          is_child_friendly: { type: 'BOOLEAN', description: 'Is suitable for children' },
          reasoning: { type: 'STRING', description: 'Detailed reasoning for the verdicts' },
          flagged_ingredients: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: 'List of flagged ingredients'
          },
          researched_price_min: { type: 'NUMBER', description: 'Researched min price in PHP' },
          researched_price_max: { type: 'NUMBER', description: 'Researched max price in PHP' },
          suggested_category: {
            type: 'STRING',
            enum: ['FRUITS', 'VEGETABLES', 'MEATS', 'BEVERAGES', 'DAIRY', 'GRAINS', 'CANNED_GOODS', 'SNACKS', 'OTHER'],
            description: 'Nutrition category'
          },
          mismatch_reason: { type: 'STRING', description: 'Reason for failure if is_justified is false' }
        },
        required: [
          'is_justified', 
          'is_child_friendly', 
          'reasoning', 
          'flagged_ingredients', 
          'researched_price_min', 
          'researched_price_max', 
          'suggested_category'
        ]
      }

      const result = await callGeminiWithFallback({
        prompt,
        imageBase64: cleanBase64,
        temperature: 0.1,
        responseSchema: schema,
        useGoogleSearch: false
      })

      return ok({
        isJustified: result.is_justified,
        isChildFriendly: result.is_child_friendly,
        reasoning: result.reasoning,
        flaggedIngredients: result.flagged_ingredients || [],
        researchedPriceMin: result.researched_price_min,
        researchedPriceMax: result.researched_price_max,
        suggestedCategory: result.suggested_category,
        mismatchReason: result.mismatch_reason || undefined
      })
    } catch (error: any) {
      console.error('Non-branded validation failed:', error)
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

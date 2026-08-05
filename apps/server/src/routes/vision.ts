import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { createServiceClient } from '../lib/supabase.js'
import { VisionService } from '../services/vision.service.js'
import { PricingValidationService } from '../services/pricing-validation.service.js'
import { toClassificationDTO } from '../dto/mappers.js'
import { errorToHttpStatus, errorToResponseBody } from '../lib/errors.js'
import type { Env } from '../types/env.js'

const visionRoutes = new Hono<{ Bindings: Env }>()

// Enforce max image size (~10MB limit in characters)
const MAX_BASE64_LENGTH = 15 * 1024 * 1024 // ~15MB base64 string

const classifySchema = z.object({
  imageBase64: z.string().min(1).max(MAX_BASE64_LENGTH, 'Image base64 payload exceeds size limit')
})

const validateNonBrandedSchema = z.object({
  imageBase64: z.string().min(1).max(MAX_BASE64_LENGTH, 'Image base64 payload exceeds size limit'),
  productName: z.string().min(1),
  price: z.number().positive(),
  unit: z.string().min(1)
})

// POST /api/vision/classify
// Accepts inline base64 image data and returns candidate products from the catalog.
visionRoutes.post('/classify', zValidator('json', classifySchema), async (c) => {
  const { imageBase64 } = c.req.valid('json')
  const db = createServiceClient()
  const visionService = new VisionService(db)

  const result = await visionService.classifyProduct(imageBase64)

  return result.match(
    (res) => c.json(toClassificationDTO(res)),
    (error) => c.json(errorToResponseBody(error), errorToHttpStatus(error))
  )
})

// POST /api/vision/analyze-nutrition
// Accepts inline base64 image data and returns structured child nutritional safety verdict.
visionRoutes.post('/analyze-nutrition', zValidator('json', classifySchema), async (c) => {
  const { imageBase64 } = c.req.valid('json')
  const db = createServiceClient()
  const visionService = new VisionService(db)

  const result = await visionService.analyzeChildSafety(imageBase64)

  return result.match(
    (res) => c.json(res),
    (error) => c.json(errorToResponseBody(error), errorToHttpStatus(error))
  )
})

// POST /api/vision/analyze-scan
// Performs unified product identification, rate-limit fallback, product catalog lookup,
// price research (±₱10 for drafts), and child-safety gates.
visionRoutes.post('/analyze-scan', zValidator('json', classifySchema), async (c) => {
  const { imageBase64 } = c.req.valid('json')
  const db = createServiceClient()
  const visionService = new VisionService(db)

  const result = await visionService.analyzeScan(imageBase64)

  return result.match(
    (res) => c.json(res),
    (error) => c.json(errorToResponseBody(error), errorToHttpStatus(error))
  )
})

// POST /api/vision/validate-non-branded
// Validates a non-branded palengke item with image and manual inputs.
visionRoutes.post('/validate-non-branded', zValidator('json', validateNonBrandedSchema), async (c) => {
  const { imageBase64, productName, price, unit } = c.req.valid('json')
  const pricingValidationService = new PricingValidationService()

  const result = await pricingValidationService.validateNonBranded(imageBase64, productName, price, unit)

  return result.match(
    (res) => c.json(res),
    (error) => c.json(errorToResponseBody(error), errorToHttpStatus(error))
  )
})

export default visionRoutes


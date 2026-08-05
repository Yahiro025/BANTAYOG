import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { createServiceClient } from '../lib/supabase.js'
import { ProductsService } from '../services/products.service.js'
import { errorToHttpStatus, errorToResponseBody } from '../lib/errors.js'
import type { Env } from '../types/env.js'

const productRoutes = new Hono<{ Bindings: Env }>()

const validateSchema = z.object({
  name: z.string().min(1),
  imageUrl: z.string().optional(),
  category: z.string().optional()
})

// POST /api/products/validate
// Accepts a product name and validates it against the catalog.
productRoutes.post('/validate', zValidator('json', validateSchema), async (c) => {
  const { name } = c.req.valid('json')
  const db = createServiceClient()
  const productsService = new ProductsService(db)

  const result = await productsService.validateProduct(name)

  return result.match(
    (val) => {
      if (!val.matched) {
        return c.json({
          matched: false,
          reason: val.reason
        }, 200)
      }
      return c.json(val)
    },
    (error) => c.json(errorToResponseBody(error), errorToHttpStatus(error))
  )
})

// POST /api/products/validate-or-create
// Accepts a product name, validates it, and if it doesn't exist, researches it via Gemini,
// inserts a draft product row, and returns it.
productRoutes.post('/validate-or-create', zValidator('json', validateSchema), async (c) => {
  const { name, imageUrl, category } = c.req.valid('json')
  const db = createServiceClient()
  const productsService = new ProductsService(db)

  const result = await productsService.validateOrCreateProduct(name, imageUrl, category)

  return result.match(
    (val) => c.json(val),
    (error) => c.json(errorToResponseBody(error), errorToHttpStatus(error))
  )
})

export default productRoutes


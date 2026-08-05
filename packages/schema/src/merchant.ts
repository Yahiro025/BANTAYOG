import { z } from 'zod'

export const MerchantStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
])
export type MerchantStatus = z.infer<typeof MerchantStatusSchema>

export const CreateMerchantDto = z.object({
  storeName: z.string().min(1).max(200),
  ownerName: z.string().min(1).max(200),
  mobileNumberE164: z
    .string()
    .min(1)
    .regex(/^\+[1-9]\d{1,14}$/, 'Must be E.164 format (e.g. +639171234567)'),
})
export type CreateMerchantDto = z.infer<typeof CreateMerchantDto>

export const MerchantDto = z.object({
  id: z.string().uuid(),
  authUserId: z.string().uuid(),
  storeName: z.string(),
  ownerName: z.string(),
  mobileNumberE164: z.string(),
  walletAddress: z
    .string()
    .regex(/^[GC][A-Z2-7]{55}$/, 'Must be a valid Stellar address')
    .nullable(),
  walletBalance: z.string(),
  status: MerchantStatusSchema,
  createdAt: z.string().datetime(),
})
export type MerchantDto = z.infer<typeof MerchantDto>

export const UpdateMerchantDto = z.object({
  storeName: z.string().min(1).max(200).optional(),
  ownerName: z.string().min(1).max(200).optional(),
  mobileNumberE164: z
    .string()
    .regex(/^\+[1-9]\d{1,14}$/, 'Must be E.164 format')
    .optional(),
  status: MerchantStatusSchema.optional(),
})
export type UpdateMerchantDto = z.infer<typeof UpdateMerchantDto>

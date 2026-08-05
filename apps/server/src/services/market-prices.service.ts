import { Result, ok, err } from 'neverthrow'
import { marketPrices, type MarketPriceData } from '../data/market-prices.data.js'

export class AppError extends Error {
  constructor(message: string, public readonly status = 500) {
    super(message)
  }
}

export class MarketPricesService {
  constructor() {}

  // Mock ingestion is no longer needed since we use a static data file.
  async ingestMockData(): Promise<Result<boolean, AppError>> {
    try {
      // No-op for static data MVP
      return ok(true)
    } catch (error: any) {
      console.error('[MarketPricesService] Ingestion failed:', error)
      return err(new AppError(`Ingestion failed: ${error.message}`))
    }
  }

  // Search for a market price by product name (using static data for MVP)
  async searchMarketPrice(productName: string): Promise<Result<MarketPriceData | null, AppError>> {
    try {
      if (!productName || productName.trim() === '') {
        return ok(null)
      }

      const searchTerm = productName.trim().toLowerCase()

      // Try searching commodity_name first
      let data = marketPrices.find(p => p.commodity_name.toLowerCase().includes(searchTerm))

      // Fallback to local_name
      if (!data) {
        data = marketPrices.find(p => p.local_name?.toLowerCase().includes(searchTerm)) || undefined
      }

      return ok(data || null)
    } catch (error: any) {
      console.error('[MarketPricesService] Search failed:', error)
      return err(new AppError(`Search failed: ${error.message}`))
    }
  }
}

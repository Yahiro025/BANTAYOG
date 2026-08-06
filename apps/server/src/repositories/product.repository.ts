import { BaseRepository } from '@bantayog/db'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@bantayog/db'

export class ProductRepository extends BaseRepository<'products'> {
  constructor(db: SupabaseClient<Database>) {
    super(db, 'products')
  }

  // Performs fuzzy search (case-insensitive ILIKE) by product name in the catalog.
  async findByNameFuzzy(name: string) {
    const { data, error } = await this.db
      .from('products')
      .select('*')
      .ilike('name', `%${name}%`)
      .limit(5)

    if (error) throw error
    return data
  }

  // Exact-match lookup by GTIN barcode (EAN-13/EAN-8/UPC-A/UPC-E).
  async findByGtin(gtin: string) {
    const { data, error } = await this.db
      .from('products')
      .select('*')
      .eq('gtin', gtin)
      .maybeSingle()

    if (error) throw error
    return data
  }
}

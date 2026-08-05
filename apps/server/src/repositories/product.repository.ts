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
}

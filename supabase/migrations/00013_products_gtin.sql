-- Adds an optional GTIN (EAN-13/EAN-8/UPC-A/UPC-E) barcode column to products,
-- so a merchant scan can match a product by barcode before falling back to Gemini vision.
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS gtin TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_gtin
    ON public.products(gtin)
    WHERE gtin IS NOT NULL;

-- Make the GTIN unique index inferable by ON CONFLICT (gtin).
DROP INDEX IF EXISTS public.idx_products_gtin;

CREATE UNIQUE INDEX idx_products_gtin
    ON public.products(gtin);

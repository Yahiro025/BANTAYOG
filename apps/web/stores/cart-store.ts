import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { z } from "zod";

const STORAGE_KEY = "bantayog-cart";
const PERSIST_VERSION = 2;

export interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  eligibility: "eligible" | "ineligible";
  imageDataUrl?: string;
  category?: string;
  unit?: string;
}

interface CartState {
  items: CartItem[];
  inputSource: "branded" | "non-branded" | null;
  restoreError: string | null;
  addItem: (item: Omit<CartItem, "id">) => void;
  removeItem: (id: string) => void;
  setInputSource: (source: "branded" | "non-branded") => void;
  clearCart: () => void;
}

// Zod schema used to validate persisted cart data on rehydration
const CartItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: z.number(),
  quantity: z.number().int().positive(),
  eligibility: z.enum(["eligible", "ineligible"]),
  imageDataUrl: z.string().optional(),
  category: z.string().optional(),
  unit: z.string().optional(),
});

const PersistedStateSchema = z.object({
  items: z.array(CartItemSchema),
});

function generateId(): string {
  return crypto.randomUUID();
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      inputSource: null,
      restoreError: null,

      addItem: (item) =>
        set((state) => ({
          items: [...state.items, { ...item, id: generateId() }],
        })),

      removeItem: (id) =>
        set((state) => ({
          items: state.items.filter((i) => i.id !== id),
        })),

      setInputSource: (source) => set({ inputSource: source }),

      clearCart: () => {
        if (typeof window !== "undefined") {
          sessionStorage.removeItem(STORAGE_KEY);
        }
        return set({ items: [], inputSource: null, restoreError: null });
      },
    }),
    {
      name: STORAGE_KEY,
      version: PERSIST_VERSION,
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        items: state.items.map(({ id, name, price, quantity, eligibility, imageDataUrl, category, unit }) => ({
          id,
          name,
          price,
          quantity,
          eligibility,
          imageDataUrl,
          category,
          unit,
        })),
      }),
      onRehydrateStorage: () => {
        return (state, error) => {
          if (error) {
            // Persistence layer error — reset to empty cart
            useCartStore.setState({
              items: [],
              restoreError: "The previous cart could not be restored.",
            });
            return;
          }

          if (state) {
            const result = PersistedStateSchema.safeParse({ items: state.items });
            if (!result.success) {
              // Validation failed — initialize empty cart and flag restore error
              useCartStore.setState({
                items: [],
                restoreError: "The previous cart could not be restored.",
              });
            }
          }
        };
      },
    }
  )
);

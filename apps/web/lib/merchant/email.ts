// Derive a deterministic email from owner name for Supabase Auth.
// Used during merchant registration and login.
export function deriveEmailFromOwnerName(ownerName: string): string {
  const normalized = ownerName
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9.-]/g, "");
  return `${normalized}@merchant.bantayog.local`;
}

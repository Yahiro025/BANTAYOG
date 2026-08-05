// QR Code Decoder
// Decodes QR codes scanned from Nutri-Pass cards and verifies
// the JWT signature. Extracts claims { bid, bal, ser, ver }.
// FE2 ownership — @bantayog/web

export interface DecodedQR {
  // Beneficiary ID (bid claim)
  beneficiaryId: string;
  // Remaining balance (bal claim)
  balance: number;
  // Series identifier (ser claim)
  series: string;
  // Schema version (ver claim)
  version: number;
  // Raw JWT string that was decoded
  raw: string;
}

// Decode and verify a QR payload (signed JWT).
// Returns structured claims or throws on invalid/expired token.
export function decodeQRPayload(_raw: string): DecodedQR {
  // TODO: implement JWT verification with jose
  throw new Error("Not implemented — T-1.9 placeholder");
}

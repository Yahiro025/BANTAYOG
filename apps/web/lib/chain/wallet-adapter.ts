// Wallet Adapter — Frontend Decision Tree
// Supports a single connection method:
// 1. Injected EIP-1193 (Freighter or any standard EVM injected provider)
// Targets Stellar Testnet with standard injected EVM wallets only.
// FE2-3.11 — @bantayog/web

// Types

export type WalletMethod = "injected";

export interface WalletConnection {
  method: WalletMethod;
  address: string;
  proof: string;
  message?: string;
}

export interface WalletProvider {
  isFreighter?: boolean;
  request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

// Environment Detection

function getInjectedProvider(): WalletProvider | null {
  if (typeof window === "undefined") return null;

  const ethereum = (window as unknown as Record<string, unknown>).ethereum as WalletProvider | undefined;
  if (ethereum) return ethereum;

  return null;
}

// Connection Method

// Connect via injected EIP-1193 provider (Freighter or any standard EVM wallet).
// Requests account access and signs a message for proof of ownership.
async function connectInjected(): Promise<WalletConnection> {
  const provider = getInjectedProvider();
  if (!provider?.request) {
    throw new Error("No injected wallet provider found");
  }

  // Request accounts
  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as string[];

  if (!accounts || accounts.length === 0) {
    throw new Error("No accounts returned by wallet");
  }

  const address = accounts[0];

  // Sign a message for proof of ownership
  const message = `BANTAYOG Wallet Verification\nAddress: ${address}\nTimestamp: ${Date.now()}`;
  const proof = (await provider.request({
    method: "sign",
    params: [message, address],
  })) as string;

  return { method: "injected", address, proof, message };
}

// Backend Verification Stub (BE2-3.7)

export interface BackendVerificationResult {
  verified: boolean;
  error?: string;
}

// Verify a wallet connection with the backend (BE2-3.7 wallet adapter gateway).
// TODO(BE2-3.7): replace with real endpoint once the backend wallet adapter
// gateway is implemented. The function signature and return type are the
// frontend-side contract — Backend 2 only needs to fill in the fetch URL
// and handle the response shape.
// @param address - The wallet address to verify
// @param proof   - Signed proof of ownership from sign
// @returns       - { verified: true } on success, { verified: false, error: "..." } on failure
export async function verifyWalletWithBackend(
  _address: string,
  _proof: string,
): Promise<BackendVerificationResult> {
  // TODO(BE2-3.7): replace with real endpoint once BE2-3.7 is implemented
  // const res = await fetch("/api/auth/verify-wallet", {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify({ address, proof }),
  // });
  // if (!res.ok) return { verified: false, error: `Verification failed (${res.status})` };
  // const data = await res.json();
  // return { verified: data.verified, error: data.error };

  // Placeholder: simulate backend verification
  await new Promise((r) => setTimeout(r, 800));
  return { verified: true };
}

// Decision Tree

// Connect using the only supported method: an injected EIP-1193 provider.
// Returns the connection details or throws if no injected provider is found.
export async function pickWallet(): Promise<WalletConnection> {
  if (!getInjectedProvider()) {
    throw new Error("No injected wallet provider found");
  }
  return await connectInjected();
}

// Get available wallet methods for the current environment.
// Used to render connection options in the UI.
export function getAvailableMethods(): WalletMethod[] {
  return getInjectedProvider() ? ["injected"] : [];
}

// Verify wallet connection with the backend.
// Sends the address and proof to BE2-3.7's wallet adapter gateway (/api/auth/wallet-login).
export async function verifyWalletConnection(
  connection: WalletConnection,
): Promise<{ verified: boolean; session?: { accessToken: string; expiresAt: string }; user?: any; error?: string }> {
  // Try to use window location origin or relative path, or fall back to configured backend url
  const apiBaseUrl = typeof window !== "undefined"
    ? (window.location.origin.includes("localhost") ? "http://localhost:3001" : "")
    : (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001")

  try {
    const res = await fetch(`${apiBaseUrl}/api/auth/wallet-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: connection.method,
        proof: {
          address: connection.address,
          message: connection.message,
          signature: connection.proof,
        }
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return { verified: false, error: data.message || "Wallet authentication failed" };
    }

    return {
      verified: true,
      session: data.session,
      user: data.user
    };
  } catch (err: any) {
    return { verified: false, error: err.message };
  }
}

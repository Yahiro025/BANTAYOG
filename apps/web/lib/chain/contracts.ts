// Contract ABIs and address resolution.
// Soroban-compiled artifacts are not checked in; we define minimal ABIs
// inline derived from the Solidity source. Addresses are read from env.

type Abi = any[];
function getAddress(a: string) { return a; }

// Env helpers

function getContractAddress(name: string): `0x${string}` {
  const val = process.env[name];
  if (!val) {
    throw new Error(
      `Missing contract address env var: ${name}. ` +
        `Run 'npx Soroban run scripts/deploy.ts --network Testnet' and copy addresses to .env.local.`,
    );
  }
  return getAddress(val) as `0x${string}`;
}

// Addresses (lazy resolution)

export function phpcTokenAddress(): `0x${string}` {
  return getContractAddress("PHPC_TOKEN_ADDRESS");
}

export function phpcSubsidyAddress(): `0x${string}` {
  return getContractAddress("PHPC_SUBSIDY_ADDRESS");
}

export function beneficiaryRegistryAddress(): `0x${string}` {
  return getContractAddress("BENEFICIARY_REGISTRY_ADDRESS");
}

export function merchantRegistryAddress(): `0x${string}` {
  return getContractAddress("MERCHANT_REGISTRY_ADDRESS");
}

// Minimal ABIs (derived from Solidity source)

export const PHPC_ABI: Abi = [
  {
    type: "function",
    name: "mint",
    inputs: [
      { name: "to", type: "address", internalType: "address" },
      { name: "amount", type: "uint256", internalType: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "transfer",
    inputs: [
      { name: "to", type: "address", internalType: "address" },
      { name: "amount", type: "uint256", internalType: "uint256" },
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8", internalType: "uint8" }],
    stateMutability: "pure",
  },
  {
    type: "event",
    name: "Minted",
    inputs: [
      { name: "to", type: "address", indexed: true, internalType: "address" },
      { name: "amount", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
];

export const PHPC_SUBSIDY_ABI: Abi = [
  {
    type: "function",
    name: "allocateCredits",
    inputs: [
      { name: "beneficiaryId", type: "bytes32", internalType: "bytes32" },
      { name: "amount", type: "uint256", internalType: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "processTransaction",
    inputs: [
      { name: "beneficiaryId", type: "bytes32", internalType: "bytes32" },
      { name: "merchantAddress", type: "address", internalType: "address" },
      { name: "amount", type: "uint256", internalType: "uint256" },
      { name: "transactionId", type: "bytes32", internalType: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "depositFunds",
    inputs: [{ name: "amount", type: "uint256", internalType: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "contractPHPCBalance",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getBalance",
    inputs: [{ name: "beneficiaryId", type: "bytes32", internalType: "bytes32" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "phpcToken",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "contract IERC20" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "CreditsAllocated",
    inputs: [
      { name: "beneficiaryId", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "amount", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "newBalance", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "TransactionProcessed",
    inputs: [
      { name: "beneficiaryId", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "merchantAddress", type: "address", indexed: true, internalType: "address" },
      { name: "amount", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "transactionId", type: "bytes32", indexed: false, internalType: "bytes32" },
    ],
    anonymous: false,
  },
];

export const BENEFICIARY_REGISTRY_ABI: Abi = [
  {
    type: "function",
    name: "register",
    inputs: [
      { name: "beneficiaryId", type: "bytes32", internalType: "bytes32" },
      { name: "dataHash", type: "bytes32", internalType: "bytes32" },
      { name: "tier", type: "uint8", internalType: "uint8" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "isRegistered",
    inputs: [{ name: "beneficiaryId", type: "bytes32", internalType: "bytes32" }],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getEntry",
    inputs: [{ name: "beneficiaryId", type: "bytes32", internalType: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct BeneficiaryRegistry.BeneficiaryEntry",
        components: [
          { name: "dataHash", type: "bytes32", internalType: "bytes32" },
          { name: "tier", type: "uint8", internalType: "uint8" },
          { name: "registeredAt", type: "uint64", internalType: "uint64" },
          { name: "active", type: "bool", internalType: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "updateTier",
    inputs: [
      { name: "beneficiaryId", type: "bytes32", internalType: "bytes32" },
      { name: "newTier", type: "uint8", internalType: "uint8" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "activeCount",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
];

export const MERCHANT_REGISTRY_ABI: Abi = [
  {
    type: "function",
    name: "register",
    inputs: [
      { name: "merchantAddress", type: "address", internalType: "address" },
      { name: "supabaseId", type: "bytes32", internalType: "bytes32" },
      { name: "storeNameHash", type: "bytes32", internalType: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "verify",
    inputs: [{ name: "merchantAddress", type: "address", internalType: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "isVerified",
    inputs: [{ name: "merchantAddress", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getEntry",
    inputs: [{ name: "merchantAddress", type: "address", internalType: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct MerchantRegistry.MerchantEntry",
        components: [
          { name: "storeNameHash", type: "bytes32", internalType: "bytes32" },
          { name: "status", type: "uint8", internalType: "enum MerchantRegistry.MerchantStatus" },
          { name: "registeredAt", type: "uint64", internalType: "uint64" },
          { name: "supabaseId", type: "bytes32", internalType: "bytes32" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "verifiedCount",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
];

import { chmod, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  Asset,
  AuthClawbackEnabledFlag,
  AuthRequiredFlag,
  AuthRevocableFlag,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk'

const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org'
const DEFAULT_NETWORK_PASSPHRASE = Networks.TESTNET
const DEFAULT_FRIENDBOT_URL = 'https://friendbot.stellar.org'
const DEFAULT_ASSET_CODE = 'PHPC'
const DEFAULT_INITIAL_SUPPLY = '100000'
const TRUSTLINE_LIMIT = '1000000000'
const TRANSACTION_TIMEOUT_SECONDS = 180
const FRIENDBOT_RETRY_COUNT = 5
const FRIENDBOT_RETRY_DELAY_MS = 2_000
const MAX_DECIMAL_PLACES = 7
const STROOPS_PER_ASSET = 10_000_000n
const REQUIRED_AUTH_FLAGS =
  AuthRequiredFlag | AuthRevocableFlag | AuthClawbackEnabledFlag
const GENERATED_ENV_FILE = '.env.stellar-testnet.local'

type AccountRole = {
  label: 'issuer' | 'distribution' | 'sponsor'
  secretEnv: string
  publicEnv?: string
}

const ACCOUNT_ROLES: readonly AccountRole[] = [
  {
    label: 'issuer',
    secretEnv: 'PHPC_ISSUER_SECRET',
    publicEnv: 'PHPC_ISSUER_PUBLIC_KEY',
  },
  {
    label: 'distribution',
    secretEnv: 'PHPC_DISTRIBUTION_SECRET',
  },
  {
    label: 'sponsor',
    secretEnv: 'STELLAR_SPONSOR_SECRET',
  },
]

type AccountCredential = {
  label: AccountRole['label']
  secretEnv: string
  publicEnv?: string
  keypair: Keypair
  publicKey: string
  generated: boolean
}

type StellarAccount = Awaited<ReturnType<Horizon.Server['loadAccount']>>
type StellarOperation = Parameters<TransactionBuilder['addOperation']>[0]

type AssetBalance = Extract<
  StellarAccount['balances'][number],
  { asset_code: string }
>

type BootstrapConfig = {
  horizonUrl: string
  networkPassphrase: string
  friendbotUrl: string
  assetCode: string
  initialSupply: string
  envFilePath: string
}

function loadOptionalEnvFile(filePath: string): void {
  try {
    process.loadEnvFile(filePath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      throw error
    }
  }
}

function loadEnvironment(): void {
  const cwd = process.cwd()
  loadOptionalEnvFile(path.resolve(cwd, GENERATED_ENV_FILE))
  loadOptionalEnvFile(path.resolve(cwd, '.env'))
}

function getConfig(): BootstrapConfig {
  const horizonUrl = process.env.STELLAR_HORIZON_URL?.trim() || DEFAULT_HORIZON_URL
  const networkPassphrase =
    process.env.STELLAR_NETWORK_PASSPHRASE?.trim() || DEFAULT_NETWORK_PASSPHRASE
  const friendbotUrl = DEFAULT_FRIENDBOT_URL
  const assetCode = process.env.PHPC_ASSET_CODE?.trim() || DEFAULT_ASSET_CODE
  const initialSupply = DEFAULT_INITIAL_SUPPLY
  const envFilePath = path.resolve(
    process.env.STELLAR_ENV_FILE?.trim() || GENERATED_ENV_FILE,
  )

  validateConfig({
    horizonUrl,
    networkPassphrase,
    friendbotUrl,
    assetCode,
    initialSupply,
    envFilePath,
  })

  return {
    horizonUrl,
    networkPassphrase,
    friendbotUrl,
    assetCode,
    initialSupply,
    envFilePath,
  }
}

function validateConfig(config: BootstrapConfig): void {
  let parsedHorizonUrl: URL
  try {
    parsedHorizonUrl = new URL(config.horizonUrl)
  } catch {
    throw new Error('STELLAR_HORIZON_URL must be a valid HTTP(S) URL')
  }

  if (!['http:', 'https:'].includes(parsedHorizonUrl.protocol)) {
    throw new Error('STELLAR_HORIZON_URL must use HTTP or HTTPS')
  }

  if (parsedHorizonUrl.hostname === 'horizon.stellar.org') {
    throw new Error('This bootstrap only permits Stellar testnet, not mainnet Horizon')
  }

  if (config.networkPassphrase !== Networks.TESTNET) {
    throw new Error('This bootstrap only permits the Stellar testnet network passphrase')
  }

  if (!/^[A-Za-z0-9]{1,12}$/.test(config.assetCode)) {
    throw new Error('PHPC_ASSET_CODE must contain 1 to 12 ASCII letters or digits')
  }

  decimalToStroops(config.initialSupply)
}

function getCredential(role: AccountRole): AccountCredential {
  const configuredSecret = process.env[role.secretEnv]?.trim()
  let keypair: Keypair
  let generated = false

  if (configuredSecret) {
    try {
      keypair = Keypair.fromSecret(configuredSecret)
    } catch {
      throw new Error(`${role.secretEnv} is not a valid Stellar secret key`)
    }
  } else {
    keypair = Keypair.random()
    generated = true
    process.env[role.secretEnv] = keypair.secret()
  }

  const publicKey = keypair.publicKey()
  if (role.publicEnv) {
    const configuredPublicKey = process.env[role.publicEnv]?.trim()
    if (configuredPublicKey && configuredPublicKey !== publicKey) {
      throw new Error(`${role.publicEnv} does not match ${role.secretEnv}`)
    }
    process.env[role.publicEnv] = publicKey
  }

  return {
    label: role.label,
    secretEnv: role.secretEnv,
    publicEnv: role.publicEnv,
    keypair,
    publicKey,
    generated,
  }
}

async function persistGeneratedCredentials(
  credentials: AccountCredential[],
  config: BootstrapConfig,
): Promise<void> {
  if (!credentials.some((credential) => credential.generated)) {
    return
  }

  const entries = [
    ['STELLAR_HORIZON_URL', config.horizonUrl],
    ['STELLAR_NETWORK_PASSPHRASE', config.networkPassphrase],
    ['PHPC_ASSET_CODE', config.assetCode],
    ['PHPC_ISSUER_PUBLIC_KEY', process.env.PHPC_ISSUER_PUBLIC_KEY],
    ['PHPC_ISSUER_SECRET', process.env.PHPC_ISSUER_SECRET],
    ['PHPC_DISTRIBUTION_SECRET', process.env.PHPC_DISTRIBUTION_SECRET],
    ['STELLAR_SPONSOR_SECRET', process.env.STELLAR_SPONSOR_SECRET],
  ] as const

  const resolvedEntries = entries.map(([name, value]) => {
    if (!value) {
      throw new Error(`Cannot persist generated credentials. Missing ${name}`)
    }
    return [name, value] as [string, string]
  })

  const contents = [
    '# Generated by scripts/bootstrap-stellar.ts. Keep this file private.',
    ...resolvedEntries.map(([name, value]) => `${name}=${formatEnvValue(value)}`),
    '',
  ].join('\n')

  await writeFile(config.envFilePath, contents, { encoding: 'utf8', mode: 0o600 })
  await chmod(config.envFilePath, 0o600)
  console.log(`Generated Stellar credentials saved to ${config.envFilePath}`)
}

function formatEnvValue(value: string): string {
  return /^[A-Za-z0-9_./:-]+$/.test(value) ? value : JSON.stringify(value)
}

function isNotFoundError(error: unknown): boolean {
  const candidate = error as {
    status?: number
    response?: { status?: number }
  }
  return candidate.status === 404 || candidate.response?.status === 404
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const configuredSecrets = [
    process.env.PHPC_ISSUER_SECRET,
    process.env.PHPC_DISTRIBUTION_SECRET,
    process.env.STELLAR_SPONSOR_SECRET,
  ].filter((value): value is string => Boolean(value))

  return configuredSecrets
    .reduce((safeMessage, secret) => safeMessage.replaceAll(secret, '[redacted]'), message)
    .slice(0, 500)
}

async function ensureFundedAccount(
  server: Horizon.Server,
  credential: AccountCredential,
  friendbotUrl: string,
): Promise<void> {
  try {
    await server.loadAccount(credential.publicKey)
    console.log(`${credential.label} account already exists: ${credential.publicKey}`)
    return
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw new Error(
        `Could not query the ${credential.label} account: ${describeError(error)}`,
      )
    }
  }

  console.log(`Requesting Stellar testnet funding for ${credential.label} account`)
  const endpoint = new URL(friendbotUrl)
  endpoint.searchParams.set('addr', credential.publicKey)

  let response: Response
  try {
    response = await fetch(endpoint, { signal: AbortSignal.timeout(30_000) })
  } catch (error) {
    throw new Error(`Friendbot request failed: ${describeError(error)}`)
  }

  if (!response.ok) {
    try {
      await server.loadAccount(credential.publicKey)
      console.log(`${credential.label} account was funded while Friendbot was responding`)
      return
    } catch {
      throw new Error(`Friendbot returned HTTP ${response.status} for ${credential.label}`)
    }
  }

  await waitForAccount(server, credential)
  console.log(`${credential.label} account funded: ${credential.publicKey}`)
}

async function waitForAccount(
  server: Horizon.Server,
  credential: AccountCredential,
): Promise<StellarAccount> {
  for (let attempt = 1; attempt <= FRIENDBOT_RETRY_COUNT; attempt += 1) {
    try {
      return await server.loadAccount(credential.publicKey)
    } catch (error) {
      if (!isNotFoundError(error) || attempt === FRIENDBOT_RETRY_COUNT) {
        throw new Error(
          `Funded ${credential.label} account was not visible on Horizon: ${describeError(error)}`,
        )
      }
      await delay(FRIENDBOT_RETRY_DELAY_MS)
    }
  }

  throw new Error(`Funded ${credential.label} account was not visible on Horizon`)
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function submitOperation(options: {
  server: Horizon.Server
  sourceAccount: StellarAccount
  sourceKeypair: Keypair
  networkPassphrase: string
  operation: StellarOperation,
  description: string
}): Promise<string> {
  const baseFee = await options.server.fetchBaseFee()
  const transaction = new TransactionBuilder(options.sourceAccount, {
    fee: Math.max(Number(baseFee), Number(BASE_FEE)).toString(),
    networkPassphrase: options.networkPassphrase,
  })
    .addOperation(options.operation)
    .setTimeout(TRANSACTION_TIMEOUT_SECONDS)
    .build()

  transaction.sign(options.sourceKeypair)

  try {
    const response = await options.server.submitTransaction(transaction)
    console.log(`${options.description}: ${response.hash}`)
    return response.hash
  } catch (error) {
    throw new Error(`${options.description} failed: ${describeError(error)}`)
  }
}

async function submitIssuerOperation(options: {
  server: Horizon.Server
  issuer: AccountCredential
  networkPassphrase: string
  operation: StellarOperation,
  description: string
}): Promise<string> {
  const sourceAccount = await options.server.loadAccount(options.issuer.publicKey)
  return submitOperation({
    server: options.server,
    sourceAccount,
    sourceKeypair: options.issuer.keypair,
    networkPassphrase: options.networkPassphrase,
    operation: options.operation,
    description: options.description,
  })
}

function findAssetBalance(
  account: StellarAccount,
  assetCode: string,
  issuerPublicKey: string,
): AssetBalance | undefined {
  return account.balances.find(
    (balance): balance is AssetBalance =>
      'asset_code' in balance &&
      balance.asset_code === assetCode &&
      balance.asset_issuer === issuerPublicKey,
  )
}

function decimalToStroops(value: string): bigint {
  if (!/^\d+(?:\.\d{1,7})?$/.test(value)) {
    throw new Error(
      `Invalid Stellar asset amount ${value}. Amounts must be non-negative decimals with at most 7 places`,
    )
  }

  const [wholePart, fractionPart = ''] = value.split('.')
  const paddedFraction = fractionPart.padEnd(MAX_DECIMAL_PLACES, '0')
  return BigInt(wholePart) * STROOPS_PER_ASSET + BigInt(paddedFraction || '0')
}

function stroopsToDecimal(value: bigint): string {
  if (value < 0n) {
    throw new Error('Stellar asset amounts cannot be negative')
  }

  const wholePart = value / STROOPS_PER_ASSET
  const fractionPart = (value % STROOPS_PER_ASSET)
    .toString()
    .padStart(MAX_DECIMAL_PLACES, '0')
    .replace(/0+$/, '')

  return fractionPart ? `${wholePart}.${fractionPart}` : wholePart.toString()
}

function getRequiredFlags(account: StellarAccount): string[] {
  const missingFlags: string[] = []
  if (!account.flags.auth_required) missingFlags.push('AUTH_REQUIRED')
  if (!account.flags.auth_revocable) missingFlags.push('AUTH_REVOCABLE')
  if (!account.flags.auth_clawback_enabled) {
    missingFlags.push('AUTH_CLAWBACK_ENABLED')
  }
  return missingFlags
}

async function bootstrapAsset(
  server: Horizon.Server,
  config: BootstrapConfig,
  issuer: AccountCredential,
  distribution: AccountCredential,
): Promise<void> {
  const asset = new Asset(config.assetCode, issuer.publicKey)
  let issuerAccount = await server.loadAccount(issuer.publicKey)
  const missingFlags = getRequiredFlags(issuerAccount)

  if (missingFlags.length > 0) {
    if (issuerAccount.flags.auth_immutable) {
      throw new Error(
        `Issuer has AUTH_IMMUTABLE set and is missing ${missingFlags.join(', ')}`,
      )
    }

    await submitOperation({
      server,
      sourceAccount: issuerAccount,
      sourceKeypair: issuer.keypair,
      networkPassphrase: config.networkPassphrase,
      operation: Operation.setOptions({ setFlags: REQUIRED_AUTH_FLAGS }),
      description: `Set PHPC issuer flags (${missingFlags.join(', ')})`,
    })
    issuerAccount = await server.loadAccount(issuer.publicKey)
  } else {
    console.log('PHPC issuer flags already set: AUTH_REQUIRED, AUTH_REVOCABLE, AUTH_CLAWBACK_ENABLED')
  }

  let distributionAccount = await server.loadAccount(distribution.publicKey)
  let trustline = findAssetBalance(
    distributionAccount,
    config.assetCode,
    issuer.publicKey,
  )

  if (!trustline) {
    await submitOperation({
      server,
      sourceAccount: distributionAccount,
      sourceKeypair: distribution.keypair,
      networkPassphrase: config.networkPassphrase,
      operation: Operation.changeTrust({ asset, limit: TRUSTLINE_LIMIT }),
      description: 'Create PHPC distribution trustline',
    })
    distributionAccount = await server.loadAccount(distribution.publicKey)
    trustline = findAssetBalance(
      distributionAccount,
      config.assetCode,
      issuer.publicKey,
    )
  } else {
    console.log('PHPC distribution trustline already exists')
  }

  if (!trustline) {
    throw new Error('PHPC distribution trustline was not visible after creation')
  }

  if (!trustline.is_authorized) {
    await submitIssuerOperation({
      server,
      issuer,
      networkPassphrase: config.networkPassphrase,
      operation: Operation.allowTrust({
        trustor: distribution.publicKey,
        assetCode: config.assetCode,
        authorize: true,
      }),
      description: 'Authorize PHPC distribution trustline',
    })
    distributionAccount = await server.loadAccount(distribution.publicKey)
    trustline = findAssetBalance(
      distributionAccount,
      config.assetCode,
      issuer.publicKey,
    )
  } else {
    console.log('PHPC distribution trustline already authorized')
  }

  if (!trustline?.is_authorized) {
    throw new Error('PHPC distribution trustline is not authorized')
  }

  const currentBalance = decimalToStroops(trustline.balance)
  const targetBalance = decimalToStroops(config.initialSupply)
  if (currentBalance >= targetBalance) {
    console.log(`PHPC distribution balance already meets target: ${trustline.balance}`)
    return
  }

  const amountToIssue = stroopsToDecimal(targetBalance - currentBalance)
  await submitIssuerOperation({
    server,
    issuer,
    networkPassphrase: config.networkPassphrase,
    operation: Operation.payment({
      destination: distribution.publicKey,
      asset,
      amount: amountToIssue,
    }),
    description: `Issue ${amountToIssue} ${config.assetCode} to distribution account`,
  })
}

async function verifyBootstrap(
  server: Horizon.Server,
  config: BootstrapConfig,
  issuer: AccountCredential,
  distribution: AccountCredential,
): Promise<{
  assetCode: string
  issuerPublicKey: string
  distributionPublicKey: string
  balance: string
  flags: string[]
  assetRecordCount: number
}> {
  const issuerAccount = await server.loadAccount(issuer.publicKey)
  const missingFlags = getRequiredFlags(issuerAccount)
  if (missingFlags.length > 0) {
    throw new Error(`Horizon verification found missing issuer flags: ${missingFlags.join(', ')}`)
  }

  const distributionAccount = await server.loadAccount(distribution.publicKey)
  const trustline = findAssetBalance(
    distributionAccount,
    config.assetCode,
    issuer.publicKey,
  )
  if (!trustline) {
    throw new Error('Horizon verification could not find the PHPC distribution trustline')
  }
  if (!trustline.is_authorized) {
    throw new Error('Horizon verification found an unauthorized PHPC distribution trustline')
  }
  if (!trustline.is_clawback_enabled) {
    throw new Error('Horizon verification found a trustline without clawback enabled')
  }

  const assetRecords = await server
    .assets()
    .forCode(config.assetCode)
    .forIssuer(issuer.publicKey)
    .limit(10)
    .call()
  if (assetRecords.records.length === 0) {
    throw new Error('Horizon verification could not find the PHPC asset record')
  }

  const targetBalance = decimalToStroops(config.initialSupply)
  if (decimalToStroops(trustline.balance) < targetBalance) {
    throw new Error(
      `Horizon verification found ${trustline.balance} ${config.assetCode}, below the ${config.initialSupply} target`,
    )
  }

  return {
    assetCode: config.assetCode,
    issuerPublicKey: issuer.publicKey,
    distributionPublicKey: distribution.publicKey,
    balance: trustline.balance,
    flags: ['AUTH_REQUIRED', 'AUTH_REVOCABLE', 'AUTH_CLAWBACK_ENABLED'],
    assetRecordCount: assetRecords.records.length,
  }
}

function printVerification(
  verification: Awaited<ReturnType<typeof verifyBootstrap>>,
  sponsor: AccountCredential,
  config: BootstrapConfig,
): void {
  console.log('\nStellar testnet bootstrap verified')
  console.log(`Network: ${config.networkPassphrase}`)
  console.log(`Horizon: ${config.horizonUrl}`)
  console.log(`Asset: ${verification.assetCode}:${verification.issuerPublicKey}`)
  console.log(`Issuer: ${verification.issuerPublicKey}`)
  console.log(`Distribution: ${verification.distributionPublicKey}`)
  console.log(`Sponsor: ${sponsor.publicKey}`)
  console.log(`Distribution balance: ${verification.balance} ${verification.assetCode}`)
  console.log(`Issuer flags: ${verification.flags.join(', ')}`)
  console.log(`Horizon asset records: ${verification.assetRecordCount}`)
  console.log(
    `Explorer: https://stellar.expert/explorer/testnet/asset/${verification.assetCode}-${verification.issuerPublicKey}`,
  )
}

async function main(): Promise<void> {
  loadEnvironment()
  const config = getConfig()
  const credentials = ACCOUNT_ROLES.map(getCredential)
  const issuer = credentials.find((credential) => credential.label === 'issuer')
  const distribution = credentials.find(
    (credential) => credential.label === 'distribution',
  )
  const sponsor = credentials.find((credential) => credential.label === 'sponsor')

  if (!issuer || !distribution || !sponsor) {
    throw new Error('Could not initialize all Stellar account roles')
  }

  await persistGeneratedCredentials(credentials, config)

  const server = new Horizon.Server(config.horizonUrl)
  for (const credential of credentials) {
    await ensureFundedAccount(server, credential, config.friendbotUrl)
  }

  if (process.argv.includes('--provision-only')) {
    console.log('Provisioning complete. Asset bootstrap was skipped.')
    console.log(`Public issuer key: ${issuer.publicKey}`)
    console.log(`Public distribution key: ${distribution.publicKey}`)
    console.log(`Public sponsor key: ${sponsor.publicKey}`)
    return
  }

  await bootstrapAsset(server, config, issuer, distribution)
  const verification = await verifyBootstrap(server, config, issuer, distribution)
  printVerification(verification, sponsor, config)
}

main().catch((error: unknown) => {
  console.error(`Stellar bootstrap failed: ${describeError(error)}`)
  process.exitCode = 1
})

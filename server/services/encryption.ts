import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

function getMasterKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!key) {
    throw new Error("ENCRYPTION_KEY or SESSION_SECRET must be set for credential encryption");
  }
  return Buffer.from(key, "utf8");
}

function deriveOrgKey(organizationId: number): Buffer {
  const masterKey = getMasterKey();
  const orgSalt = `org-${organizationId}-credentials`;
  return crypto.scryptSync(masterKey, orgSalt, 32);
}

export function encryptCredentials(plaintext: string, organizationId: number): string {
  const key = deriveOrgKey(organizationId);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  
  const authTag = cipher.getAuthTag();
  
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

export function decryptCredentials(ciphertext: string, organizationId: number): string {
  const key = deriveOrgKey(organizationId);
  const [ivHex, authTagHex, encrypted] = ciphertext.split(":");
  
  if (!ivHex || !authTagHex || !encrypted) {
    throw new Error("Invalid encrypted credential format");
  }
  
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  
  return decrypted;
}

export function encryptJsonCredentials(credentials: Record<string, unknown>, organizationId: number): string {
  return encryptCredentials(JSON.stringify(credentials), organizationId);
}

export function decryptJsonCredentials<T extends Record<string, unknown>>(ciphertext: string, organizationId: number): T {
  const decrypted = decryptCredentials(ciphertext, organizationId);
  return JSON.parse(decrypted) as T;
}

export function maskApiKey(key: string | undefined | null): string {
  if (!key) return "";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

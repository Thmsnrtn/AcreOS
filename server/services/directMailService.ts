import Lob from 'lob';
import type { MailSenderIdentity } from '@shared/schema';
import { creditService, usageMeteringService } from './credits';
import { storage } from '../storage';
import { decryptJsonCredentials } from './encryption';

interface RecipientAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
}

interface SendPostcardOptions {
  organizationId: number;
  senderIdentity: MailSenderIdentity;
  recipientName: string;
  recipientAddress: RecipientAddress;
  frontHtml: string;
  backHtml: string;
  size?: '4x6' | '6x9' | '6x11';
  skipCredits?: boolean;
}

interface SendLetterOptions {
  organizationId: number;
  senderIdentity: MailSenderIdentity;
  recipientName: string;
  recipientAddress: RecipientAddress;
  htmlContent: string;
  color?: boolean;
  doubleSided?: boolean;
  skipCredits?: boolean;
}

interface SendResult {
  lobId: string;
  url: string;
  expectedDeliveryDate: Date;
  credentialSource?: 'organization' | 'platform';
}

interface VerifyAddressResult {
  isValid: boolean;
  deliverability: string;
  details: {
    components?: {
      primaryNumber?: string;
      streetPredirection?: string;
      streetName?: string;
      streetSuffix?: string;
      city?: string;
      state?: string;
      zipCode?: string;
      zipCodePlus4?: string;
    };
    deliverabilityAnalysis?: {
      dpvConfirmation?: string;
      dpvCmra?: string;
      dpvVacant?: string;
      dpvFootnotes?: string[];
    };
    lobAddressId?: string;
  };
  errorMessage?: string;
}

interface LobClientResult {
  client: InstanceType<typeof Lob>;
  source: 'organization' | 'platform';
}

export async function getLobClient(orgId: number): Promise<LobClientResult> {
  try {
    const integration = await storage.getOrganizationIntegration(orgId, 'lob');
    
    if (integration && integration.isEnabled && integration.credentials?.encrypted) {
      const decrypted = decryptJsonCredentials<{ apiKey: string }>(
        integration.credentials.encrypted,
        orgId
      );
      
      if (decrypted.apiKey) {
        console.log(`[DirectMailService] Using organization Lob credentials for org ${orgId}`);
        return {
          client: new Lob({ apiKey: decrypted.apiKey }),
          source: 'organization',
        };
      }
    }
  } catch (error) {
    console.error(`[DirectMailService] Failed to get org Lob credentials for org ${orgId}:`, error);
  }
  
  const isProduction = process.env.NODE_ENV === 'production';
  const apiKey = isProduction 
    ? process.env.LOB_LIVE_API_KEY 
    : (process.env.LOB_TEST_API_KEY || process.env.LOB_LIVE_API_KEY);
  
  if (!apiKey) {
    throw new Error('Lob API key not configured. Set LOB_LIVE_API_KEY or LOB_TEST_API_KEY environment variable.');
  }
  
  console.log(`[DirectMailService] Using platform Lob credentials for org ${orgId}`);
  return {
    client: new Lob({ apiKey }),
    source: 'platform',
  };
}

function getPlatformLobClient(): InstanceType<typeof Lob> {
  const isProduction = process.env.NODE_ENV === 'production';
  const apiKey = isProduction 
    ? process.env.LOB_LIVE_API_KEY 
    : (process.env.LOB_TEST_API_KEY || process.env.LOB_LIVE_API_KEY);
  
  if (!apiKey) {
    throw new Error('Lob API key not configured. Set LOB_LIVE_API_KEY or LOB_TEST_API_KEY environment variable.');
  }
  
  return new Lob({ apiKey });
}

function formatSenderAddress(identity: MailSenderIdentity) {
  return {
    name: identity.companyName,
    address_line1: identity.addressLine1,
    address_line2: identity.addressLine2 || undefined,
    address_city: identity.city,
    address_state: identity.state,
    address_zip: identity.zipCode,
  };
}

function formatRecipientAddress(name: string, address: RecipientAddress) {
  return {
    name,
    address_line1: address.line1,
    address_line2: address.line2 || undefined,
    address_city: address.city,
    address_state: address.state,
    address_zip: address.zip,
  };
}

function parseExpectedDeliveryDate(dateString: string): Date {
  const parsed = new Date(dateString);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function checkCreditsAndRecord(organizationId: number, metadata?: Record<string, any>): Promise<{ hasCredits: boolean; costCents: number; errorMessage?: string }> {
  const costCents = await usageMeteringService.calculateCost('direct_mail', 1);
  const hasCredits = await creditService.hasEnoughCredits(organizationId, costCents);
  
  if (!hasCredits) {
    const balance = await creditService.getBalance(organizationId);
    return {
      hasCredits: false,
      costCents,
      errorMessage: `Insufficient credits. Required: $${(costCents / 100).toFixed(2)}, Balance: $${(balance / 100).toFixed(2)}`,
    };
  }
  
  return { hasCredits: true, costCents };
}

async function recordUsage(organizationId: number, metadata: Record<string, any>): Promise<void> {
  await usageMeteringService.recordUsage(organizationId, 'direct_mail', 1, metadata);
}

export async function sendPostcard(options: SendPostcardOptions): Promise<SendResult> {
  const { organizationId, senderIdentity, recipientName, recipientAddress, frontHtml, backHtml, size = '4x6' } = options;
  
  console.log(`[DirectMailService] Sending postcard for org ${organizationId} to ${recipientName}`);
  
  const { client, source } = await getLobClient(organizationId);
  
  const skipCredits = options.skipCredits === true || source === 'organization';
  
  if (!skipCredits) {
    const creditCheck = await checkCreditsAndRecord(organizationId, { type: 'postcard', recipient: recipientName });
    if (!creditCheck.hasCredits) {
      throw new Error(creditCheck.errorMessage);
    }
  }
  
  if (source === 'organization') {
    console.log(`[DirectMailService] Skipping credit usage for org ${organizationId} - using org credentials`);
  }
  
  try {
    const result = await client.postcards.create({
      to: formatRecipientAddress(recipientName, recipientAddress),
      from: formatSenderAddress(senderIdentity),
      front: frontHtml,
      back: backHtml,
      size,
    });
    
    console.log(`[DirectMailService] Postcard sent successfully: ${result.id} (source: ${source})`);
    
    if (!skipCredits) {
      await recordUsage(organizationId, { type: 'postcard', lobId: result.id, recipient: recipientName });
    }
    
    return {
      lobId: result.id,
      url: (result as any).url || '',
      expectedDeliveryDate: parseExpectedDeliveryDate(result.expected_delivery_date),
      credentialSource: source,
    };
  } catch (error: any) {
    console.error('[DirectMailService] Postcard send failed:', error);
    throw new Error(`Failed to send postcard: ${error.message || 'Unknown error'}`);
  }
}

export async function sendLetter(options: SendLetterOptions): Promise<SendResult> {
  const { organizationId, senderIdentity, recipientName, recipientAddress, htmlContent, color = false, doubleSided = false } = options;
  
  console.log(`[DirectMailService] Sending letter for org ${organizationId} to ${recipientName}`);
  
  const { client, source } = await getLobClient(organizationId);
  
  const skipCredits = options.skipCredits === true || source === 'organization';
  
  if (!skipCredits) {
    const creditCheck = await checkCreditsAndRecord(organizationId, { type: 'letter', recipient: recipientName });
    if (!creditCheck.hasCredits) {
      throw new Error(creditCheck.errorMessage);
    }
  }
  
  if (source === 'organization') {
    console.log(`[DirectMailService] Skipping credit usage for org ${organizationId} - using org credentials`);
  }
  
  try {
    const result = await client.letters.create({
      to: formatRecipientAddress(recipientName, recipientAddress),
      from: formatSenderAddress(senderIdentity),
      file: htmlContent,
      color,
      double_sided: doubleSided,
    });
    
    console.log(`[DirectMailService] Letter sent successfully: ${result.id} (source: ${source})`);
    
    if (!skipCredits) {
      await recordUsage(organizationId, { type: 'letter', lobId: result.id, recipient: recipientName });
    }
    
    return {
      lobId: result.id,
      url: (result as any).url || '',
      expectedDeliveryDate: parseExpectedDeliveryDate(result.expected_delivery_date),
      credentialSource: source,
    };
  } catch (error: any) {
    console.error('[DirectMailService] Letter send failed:', error);
    throw new Error(`Failed to send letter: ${error.message || 'Unknown error'}`);
  }
}

export async function verifyAddress(address: RecipientAddress): Promise<VerifyAddressResult> {
  console.log(`[DirectMailService] Verifying address: ${address.line1}, ${address.city}, ${address.state} ${address.zip}`);
  
  try {
    const client = getPlatformLobClient() as any;
    
    const result = await client.usVerifications.verify({
      primary_line: address.line1,
      secondary_line: address.line2 || '',
      city: address.city,
      state: address.state,
      zip_code: address.zip,
    });
    
    const deliverability = result.deliverability || 'unknown';
    const isValid = deliverability === 'deliverable' || deliverability === 'deliverable_unnecessary_unit';
    
    console.log(`[DirectMailService] Address verification result: ${deliverability}, isValid: ${isValid}`);
    
    return {
      isValid,
      deliverability,
      details: {
        components: result.components ? {
          primaryNumber: result.components.primary_number,
          streetPredirection: result.components.street_predirection,
          streetName: result.components.street_name,
          streetSuffix: result.components.street_suffix,
          city: result.components.city,
          state: result.components.state,
          zipCode: result.components.zip_code,
          zipCodePlus4: result.components.zip_code_plus_4,
        } : undefined,
        deliverabilityAnalysis: result.deliverability_analysis ? {
          dpvConfirmation: result.deliverability_analysis.dpv_confirmation,
          dpvCmra: result.deliverability_analysis.dpv_cmra,
          dpvVacant: result.deliverability_analysis.dpv_vacant,
          dpvFootnotes: result.deliverability_analysis.dpv_footnotes,
        } : undefined,
        lobAddressId: result.id,
      },
    };
  } catch (error: any) {
    console.error('[DirectMailService] Address verification failed:', error);
    
    const errorMessage = error.message || 'Address verification failed';
    
    return {
      isValid: false,
      deliverability: 'undeliverable',
      details: {},
      errorMessage,
    };
  }
}

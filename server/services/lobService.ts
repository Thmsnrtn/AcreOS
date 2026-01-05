import Lob from 'lob';

export type LobErrorType = 
  | 'address_invalid'
  | 'address_undeliverable'
  | 'insufficient_funds'
  | 'rate_limited'
  | 'unauthorized'
  | 'not_found'
  | 'validation_error'
  | 'server_error'
  | 'network_error'
  | 'unknown';

export interface LobAddress {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
}

export interface LobLetterOptions {
  to: LobAddress;
  from: LobAddress;
  file: string;
  color?: boolean;
  doubleSided?: boolean;
  description?: string;
}

export interface LobPostcardOptions {
  to: LobAddress;
  from: LobAddress;
  front: string;
  back: string;
  size?: '4x6' | '6x9' | '6x11';
  description?: string;
}

export interface LobSendResult {
  success: boolean;
  lobMailingId?: string;
  expectedDeliveryDate?: string;
  trackingUrl?: string;
  carrier?: string;
  isTestMode: boolean;
  error?: string;
  errorType?: LobErrorType;
  rawError?: any;
}

function classifyLobError(error: any): { type: LobErrorType; message: string } {
  const errorMessage = error?.message || error?.error?.message || String(error);
  const statusCode = error?.statusCode || error?.status;
  
  if (statusCode === 401 || errorMessage.includes('unauthorized') || errorMessage.includes('Invalid API Key')) {
    return { type: 'unauthorized', message: 'Invalid Lob API key' };
  }
  
  if (statusCode === 403 || errorMessage.includes('insufficient_funds') || errorMessage.includes('insufficient funds')) {
    return { type: 'insufficient_funds', message: 'Insufficient funds in Lob account' };
  }
  
  if (statusCode === 429 || errorMessage.includes('rate') || errorMessage.includes('too many requests')) {
    return { type: 'rate_limited', message: 'Lob API rate limit exceeded' };
  }
  
  if (statusCode === 404 || errorMessage.includes('not found')) {
    return { type: 'not_found', message: 'Resource not found' };
  }
  
  if (errorMessage.includes('address') && (errorMessage.includes('invalid') || errorMessage.includes('undeliverable'))) {
    return { type: 'address_invalid', message: 'Invalid or undeliverable address' };
  }
  
  if (errorMessage.includes('undeliverable')) {
    return { type: 'address_undeliverable', message: 'Address is undeliverable' };
  }
  
  if (statusCode === 422 || errorMessage.includes('validation')) {
    return { type: 'validation_error', message: errorMessage };
  }
  
  if (statusCode >= 500) {
    return { type: 'server_error', message: 'Lob server error - please retry' };
  }
  
  if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ETIMEDOUT') || errorMessage.includes('network')) {
    return { type: 'network_error', message: 'Network error connecting to Lob' };
  }
  
  return { type: 'unknown', message: errorMessage };
}

export class LobService {
  private testLob: InstanceType<typeof Lob> | null = null;
  private liveLob: InstanceType<typeof Lob> | null = null;
  
  constructor() {
    const testKey = process.env.LOB_TEST_API_KEY;
    const liveKey = process.env.LOB_LIVE_API_KEY;
    const genericKey = process.env.LOB_API_KEY;
    
    if (testKey) {
      this.testLob = new Lob({ apiKey: testKey });
    } else if (genericKey?.startsWith('test_')) {
      this.testLob = new Lob({ apiKey: genericKey });
    }
    
    if (liveKey) {
      this.liveLob = new Lob({ apiKey: liveKey });
    } else if (genericKey && !genericKey.startsWith('test_')) {
      this.liveLob = new Lob({ apiKey: genericKey });
    }
  }
  
  isConfigured(): boolean {
    return this.testLob !== null || this.liveLob !== null;
  }
  
  hasTestMode(): boolean {
    return this.testLob !== null;
  }
  
  hasLiveMode(): boolean {
    return this.liveLob !== null;
  }
  
  private getClient(mode: 'test' | 'live'): InstanceType<typeof Lob> {
    if (mode === 'test') {
      if (!this.testLob) {
        throw new Error('Lob test mode not configured - LOB_TEST_API_KEY required');
      }
      return this.testLob;
    }
    
    if (!this.liveLob) {
      throw new Error('Lob live mode not configured - LOB_LIVE_API_KEY required');
    }
    return this.liveLob;
  }
  
  async sendLetter(options: LobLetterOptions, mode: 'test' | 'live' = 'live'): Promise<LobSendResult> {
    try {
      const client = this.getClient(mode);
      
      console.log(`[LobService] Sending letter via ${mode} mode to ${options.to.name}`);
      
      const result = await client.letters.create({
        to: {
          name: options.to.name,
          address_line1: options.to.addressLine1,
          address_line2: options.to.addressLine2,
          address_city: options.to.city,
          address_state: options.to.state,
          address_zip: options.to.zip,
        },
        from: {
          name: options.from.name,
          address_line1: options.from.addressLine1,
          address_line2: options.from.addressLine2,
          address_city: options.from.city,
          address_state: options.from.state,
          address_zip: options.from.zip,
        },
        file: options.file,
        color: options.color ?? false,
        double_sided: options.doubleSided ?? false,
      });
      
      console.log(`[LobService] Letter sent successfully: ${result.id}, expected delivery: ${result.expected_delivery_date}`);
      
      return {
        success: true,
        lobMailingId: result.id,
        expectedDeliveryDate: result.expected_delivery_date,
        isTestMode: mode === 'test',
      };
    } catch (error: any) {
      const classified = classifyLobError(error);
      
      console.error(`[LobService] Letter send failed:`, {
        errorType: classified.type,
        message: classified.message,
        recipient: options.to.name,
        mode,
      });
      
      return {
        success: false,
        isTestMode: mode === 'test',
        error: classified.message,
        errorType: classified.type,
        rawError: error,
      };
    }
  }
  
  async sendPostcard(options: LobPostcardOptions, mode: 'test' | 'live' = 'live'): Promise<LobSendResult> {
    try {
      const client = this.getClient(mode);
      
      console.log(`[LobService] Sending postcard via ${mode} mode to ${options.to.name}`);
      
      const result = await client.postcards.create({
        to: {
          name: options.to.name,
          address_line1: options.to.addressLine1,
          address_line2: options.to.addressLine2,
          address_city: options.to.city,
          address_state: options.to.state,
          address_zip: options.to.zip,
        },
        from: {
          name: options.from.name,
          address_line1: options.from.addressLine1,
          address_line2: options.from.addressLine2,
          address_city: options.from.city,
          address_state: options.from.state,
          address_zip: options.from.zip,
        },
        front: options.front,
        back: options.back,
        size: options.size || '4x6',
      });
      
      console.log(`[LobService] Postcard sent successfully: ${result.id}, expected delivery: ${result.expected_delivery_date}`);
      
      return {
        success: true,
        lobMailingId: result.id,
        expectedDeliveryDate: result.expected_delivery_date,
        isTestMode: mode === 'test',
      };
    } catch (error: any) {
      const classified = classifyLobError(error);
      
      console.error(`[LobService] Postcard send failed:`, {
        errorType: classified.type,
        message: classified.message,
        recipient: options.to.name,
        mode,
      });
      
      return {
        success: false,
        isTestMode: mode === 'test',
        error: classified.message,
        errorType: classified.type,
        rawError: error,
      };
    }
  }
  
  isRetryableError(errorType: LobErrorType): boolean {
    return ['rate_limited', 'server_error', 'network_error'].includes(errorType);
  }
}

export const lobService = new LobService();

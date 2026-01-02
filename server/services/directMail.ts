import Lob from 'lob';

// Cost structure (in cents) - our pricing to users
export const DIRECT_MAIL_COSTS = {
  postcard_4x6: 75,    // $0.75 - small postcard
  postcard_6x9: 95,    // $0.95 - standard postcard
  postcard_6x11: 115,  // $1.15 - large postcard
  letter_1_page: 125,  // $1.25 - single page letter
  letter_2_page: 145,  // $1.45 - 2 page letter
  letter_extra_page: 15, // $0.15 per additional page
} as const;

export type MailPieceType = keyof typeof DIRECT_MAIL_COSTS;

export interface DirectMailRecipient {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
}

export interface PostcardOptions {
  size: '4x6' | '6x9' | '6x11';
  front: string; // HTML or URL
  back: string;  // HTML or URL
  to: DirectMailRecipient;
  from: DirectMailRecipient;
}

export interface LetterOptions {
  file: string; // HTML or PDF URL
  to: DirectMailRecipient;
  from: DirectMailRecipient;
  color?: boolean;
  doubleSided?: boolean;
  pageCount?: number;
}

export class DirectMailService {
  private lob: any;
  private isConfigured: boolean = false;

  constructor() {
    const apiKey = process.env.LOB_API_KEY;
    if (apiKey) {
      this.lob = new Lob({ apiKey });
      this.isConfigured = true;
    }
  }

  isAvailable(): boolean {
    return this.isConfigured;
  }

  async sendPostcard(options: PostcardOptions): Promise<{ id: string; expectedDeliveryDate: string }> {
    if (!this.isConfigured) {
      throw new Error('Lob API key not configured');
    }
    
    const result = await this.lob.postcards.create({
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
      size: options.size,
    });
    
    return {
      id: result.id,
      expectedDeliveryDate: result.expected_delivery_date,
    };
  }

  async sendLetter(options: LetterOptions): Promise<{ id: string; expectedDeliveryDate: string }> {
    if (!this.isConfigured) {
      throw new Error('Lob API key not configured');
    }
    
    const result = await this.lob.letters.create({
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
    
    return {
      id: result.id,
      expectedDeliveryDate: result.expected_delivery_date,
    };
  }

  calculateCost(type: MailPieceType, quantity: number = 1): number {
    return DIRECT_MAIL_COSTS[type] * quantity;
  }
  
  estimateBatchCost(
    pieceType: 'postcard_4x6' | 'postcard_6x9' | 'postcard_6x11' | 'letter_1_page',
    recipientCount: number
  ): { perPiece: number; total: number } {
    const perPiece = DIRECT_MAIL_COSTS[pieceType];
    return {
      perPiece,
      total: perPiece * recipientCount,
    };
  }
}

export const directMailService = new DirectMailService();

declare module 'lob' {
  interface LobAddress {
    name: string;
    address_line1: string;
    address_line2?: string;
    address_city: string;
    address_state: string;
    address_zip: string;
  }

  interface PostcardCreateParams {
    to: LobAddress;
    from: LobAddress;
    front: string;
    back: string;
    size: '4x6' | '6x9' | '6x11';
  }

  interface LetterCreateParams {
    to: LobAddress;
    from: LobAddress;
    file: string;
    color?: boolean;
    double_sided?: boolean;
  }

  interface LobResult {
    id: string;
    expected_delivery_date: string;
    url?: string;
  }

  interface Postcards {
    create(params: PostcardCreateParams): Promise<LobResult>;
  }

  interface Letters {
    create(params: LetterCreateParams): Promise<LobResult>;
  }

  interface USVerificationParams {
    primary_line: string;
    secondary_line?: string;
    city: string;
    state: string;
    zip_code: string;
  }

  interface USVerificationComponents {
    primary_number?: string;
    street_predirection?: string;
    street_name?: string;
    street_suffix?: string;
    city?: string;
    state?: string;
    zip_code?: string;
    zip_code_plus_4?: string;
  }

  interface USVerificationDeliverabilityAnalysis {
    dpv_confirmation?: string;
    dpv_cmra?: string;
    dpv_vacant?: string;
    dpv_footnotes?: string[];
  }

  interface USVerificationResult {
    id: string;
    deliverability: string;
    components?: USVerificationComponents;
    deliverability_analysis?: USVerificationDeliverabilityAnalysis;
  }

  interface USVerifications {
    verify(params: USVerificationParams): Promise<USVerificationResult>;
  }

  interface LobInstance {
    postcards: Postcards;
    letters: Letters;
    usVerifications: USVerifications;
  }

  interface LobOptions {
    apiKey: string;
  }

  class Lob {
    constructor(options: LobOptions);
    postcards: Postcards;
    letters: Letters;
    usVerifications: USVerifications;
  }

  export = Lob;
}

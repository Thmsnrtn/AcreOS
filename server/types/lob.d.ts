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
  }

  interface Postcards {
    create(params: PostcardCreateParams): Promise<LobResult>;
  }

  interface Letters {
    create(params: LetterCreateParams): Promise<LobResult>;
  }

  interface LobInstance {
    postcards: Postcards;
    letters: Letters;
  }

  interface LobOptions {
    apiKey: string;
  }

  class Lob {
    constructor(options: LobOptions);
    postcards: Postcards;
    letters: Letters;
  }

  export = Lob;
}

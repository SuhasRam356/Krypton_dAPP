declare module 'crystals-kyber' {
  export function KeyGen768(): [Buffer | Uint8Array, Buffer | Uint8Array];
  export function Encrypt768(pk: Buffer | Uint8Array): [Buffer | Uint8Array, Buffer | Uint8Array];
  export function Decrypt768(c: Buffer | Uint8Array, sk: Buffer | Uint8Array): Buffer | Uint8Array;
}

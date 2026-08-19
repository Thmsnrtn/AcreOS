export function priceParcel(parcel: { acreage?: number | null }, perAcre: number) {
  return perAcre * (parcel.acreage || 5);
}

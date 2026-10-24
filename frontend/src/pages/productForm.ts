export interface ProductDraft {
  name: string; price: string; mrpPrice: string; costPrice: string; category: string;
  regionalName: string; discount: string; shortName: string; taxIndex: string;
  hsnCode: string; unitId: string; weighable: boolean; stockable: boolean;
  wholeSaleAmount?: string; onlinePrice?: string;
}
export function productFormErrors(draft: ProductDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.name.trim()) errors.name = 'Product Name is required.';
  if (!draft.category) errors.category = 'Select a category.';
  for (const key of ['price', 'mrpPrice', 'costPrice', 'discount'] as const) {
    const value = Number(draft[key]);
    if (!draft[key].trim() || !Number.isFinite(value) || value < 0) errors[key] = 'Enter a finite number of zero or more.';
  }
  if (Number(draft.discount) > 100) errors.discount = 'Discount must be between 0 and 100.';
  for (const key of ['wholeSaleAmount', 'onlinePrice'] as const) {
    if (draft[key] !== undefined && (!draft[key]!.trim() || !Number.isFinite(Number(draft[key])) || Number(draft[key]) < 0)) {
      errors[key] = 'Enter a finite number of zero or more.';
    }
  }
  for (const key of ['taxIndex', 'unitId'] as const) {
    if (!draft[key] || !Number.isSafeInteger(Number(draft[key]))) errors[key] = 'Select a configured option.';
  }
  return errors;
}
export function productFormPayload(draft: ProductDraft, code: number, requestId: string) {
  return { ...draft, name: draft.name.trim(), regionalName: draft.regionalName.trim(),
    shortName: draft.shortName.trim(), hsnCode: draft.hsnCode.trim(), code, requestId,
    price: Number(draft.price), mrpPrice: Number(draft.mrpPrice), costPrice: Number(draft.costPrice),
    discount: Number(draft.discount), taxIndex: Number(draft.taxIndex), unitId: Number(draft.unitId),
    ...(draft.wholeSaleAmount === undefined ? {} : { wholeSaleAmount: Number(draft.wholeSaleAmount) }),
    ...(draft.onlinePrice === undefined ? {} : { onlinePrice: Number(draft.onlinePrice) }) };
}

export function productDraftFromFields(fields: Record<string, unknown>): ProductDraft {
  const text = (key: string) => typeof fields[key] === 'number' || typeof fields[key] === 'string' ? String(fields[key]) : '';
  return { name: text('name'), price: text('price'), mrpPrice: text('mrpPrice'), costPrice: text('costPrice'),
    category: text('category'), regionalName: text('regionalName'), discount: text('discount'), shortName: text('shortName'),
    taxIndex: text('taxIndex'), hsnCode: text('hsnCode'), unitId: text('unitId'),
    weighable: fields.weighable === true, stockable: fields.stockable === true,
    ...(typeof fields.wholeSaleAmount === 'number' ? { wholeSaleAmount: text('wholeSaleAmount') } : {}),
    ...(typeof fields.onlinePrice === 'number' ? { onlinePrice: text('onlinePrice') } : {}) };
}

export function productUpdatePayload(draft: ProductDraft, original: ProductDraft) {
  const fields = productFormPayload(draft, 0, '');
  const baseline = productFormPayload(original, 0, '');
  return Object.fromEntries(Object.entries(fields).filter(([key, value]) => key !== 'code' && key !== 'requestId'
    && value !== baseline[key as keyof typeof baseline]));
}

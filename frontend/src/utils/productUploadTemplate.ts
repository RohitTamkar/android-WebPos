import { PREMISES_TEMPLATE_COLUMNS, PRODUCT_COLUMNS, type ProductUploadMode } from '../pages/productCsvPreview.ts';

export const productTemplateFilename = (mode: ProductUploadMode) => mode === 'premises'
  ? 'Premises_Wise_Product_Upload_Demo.xlsx' : 'Product_Upload_Demo.xlsx';

export async function createProductUploadTemplate(mode: ProductUploadMode) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Products');
  const headers = mode === 'premises' ? PREMISES_TEMPLATE_COLUMNS : PRODUCT_COLUMNS;
  sheet.addRow([...headers]);
  sheet.getRow(1).font = { bold: true };
  headers.forEach((header, index) => { sheet.getColumn(index + 1).width = Math.max(16, header.length + 2); });
  return workbook;
}

export async function downloadProductUploadTemplate(mode: ProductUploadMode) {
  const workbook = await createProductUploadTemplate(mode);
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([new Uint8Array(buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = productTemplateFilename(mode);
    anchor.click();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

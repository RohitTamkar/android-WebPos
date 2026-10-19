import { fileSelectionError, MAX_FILE_BYTES, MAX_PRODUCT_ROWS, parseProductCsv, type ProductUploadMode } from './productCsvPreview.ts';

// Only premises preview accepts XLSX. Standard import keeps its existing CSV/TSV contract.
export async function readProductUploadFile(file: File, mode: ProductUploadMode = 'standard') {
  const selectionError = fileSelectionError(file.name, file.size, mode);
  if (selectionError) throw new Error(selectionError);
  const bytes = await file.arrayBuffer();
  let source: string;
  if (mode === 'premises' && /\.xlsx$/i.test(file.name)) {
    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    const sheets = workbook.worksheets.filter(sheet => sheet.actualRowCount > 0);
    if (sheets.length !== 1) throw new Error('Use exactly one nonempty worksheet for premises preview.');
    const sheet = sheets[0]!;
    if (sheet.rowCount > MAX_PRODUCT_ROWS + 1001 || sheet.columnCount > 100) throw new Error('The worksheet exceeds the upload row or column limits.');
    const records: string[] = [];
    let sourceBytes = 0;
    for (let row = 1; row <= sheet.rowCount; row++) {
      const cells: string[] = [];
      for (let column = 1; column <= sheet.columnCount; column++) {
        const value = sheet.getCell(row, column).value;
        if (value != null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
          throw new Error(`Row ${row}, column ${column}: use plain text or numbers; formulas and other Excel cell objects are not supported.`);
        }
        const text = String(value ?? '');
        if (text.length > 20000) throw new Error(`Row ${row}, column ${column}: cell exceeds the 20,000-character limit.`);
        cells.push(`"${text.replaceAll('"', '""')}"`);
      }
      const record = cells.join(',');
      sourceBytes += new TextEncoder().encode(record).length + 1;
      if (sourceBytes > MAX_FILE_BYTES) throw new Error('The expanded worksheet exceeds the 5 MB limit.');
      records.push(record);
    }
    source = records.join('\n');
  } else {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  return { source, preview: parseProductCsv(source, mode) };
}

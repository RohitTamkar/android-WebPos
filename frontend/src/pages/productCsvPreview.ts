export const PRODUCT_COLUMNS = [
  'Product Name', 'Regional Name', 'Default Price', 'Price 1', 'MRP Price',
  'Purchase Price', 'Category Name', 'Category No', 'Tax', 'Barcode',
  'Unit Type', 'Stock', 'Weightable', 'Search Code',
] as const;

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_PRODUCT_ROWS = 10000;
const MAX_CELL_LENGTH = 20000;
const NUMERIC_COLUMNS = [2, 3, 4, 5, 7, 8, 11];
const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const PROHIBITED_CELL_CHARACTERS = new Set("!@#$%^&*()/]'.,");
const NAME_COLUMNS = [0, 1, 6];

export interface RowIssue {
  column: string;
  message: string;
}

export interface PreviewRow {
  rowNumber: number;
  cells: string[];
  errors: RowIssue[];
  warnings: RowIssue[];
}

export interface CsvPreview {
  headers: string[];
  headerRow: number;
  headerErrors: string[];
  delimiter: string;
  blankRows: number;
  rows: PreviewRow[];
}

export function fileSelectionError(name: string, size: number): string | null {
  if (!/\.(csv|tsv)$/i.test(name)) return 'Select a CSV (.csv) or tab-separated (.tsv) file. XLS and XLSX are not supported in this phase.';
  if (size > MAX_FILE_BYTES) return 'The file exceeds the 5 MB limit.';
  if (size === 0) return 'The selected file is empty.';
  return null;
}

function detectDelimiter(text: string): string {
  const candidates = [',', '\t', ';'];
  const counts = candidates.map(() => 0);
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { index++; continue; }
      quoted = !quoted;
    } else if (!quoted) {
      if (char === '\r' || char === '\n') {
        if (counts.some(count => count > 0)) break;
        continue;
      }
      const candidate = candidates.indexOf(char);
      if (candidate >= 0) counts[candidate] = (counts[candidate] ?? 0) + 1;
    }
  }
  const exact = counts.indexOf(PRODUCT_COLUMNS.length - 1);
  const index = exact >= 0 ? exact : counts.indexOf(Math.max(...counts));
  return candidates[index] ?? ',';
}

function readRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;
  let afterQuote = false;
  let touched = false;

  const finishCell = () => {
    record.push(cell);
    if (record.length > 100) throw new Error('The file contains more than 100 columns. Use the 14-column product format.');
    cell = '';
    afterQuote = false;
  };
  const finishRecord = () => {
    finishCell();
    records.push(record);
    if (records.length > MAX_PRODUCT_ROWS + 1001) throw new Error('Too many spreadsheet rows. Limit the file to 10,000 product rows.');
    record = [];
    touched = false;
  };

  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    const code = char.charCodeAt(0);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      throw new Error('The file contains binary or unsupported control characters. Select a UTF-8 CSV or TSV file.');
    }
    touched = true;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { cell += '"'; index++; }
        else { quoted = false; afterQuote = true; }
      } else cell += char;
    } else if (char === delimiter) finishCell();
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      finishRecord();
    } else if (char === '"') {
      if (cell.length || afterQuote) throw new Error(`Malformed CSV at spreadsheet row ${records.length + 1}, column ${record.length + 1}: unexpected quote.`);
      quoted = true;
    } else {
      if (afterQuote && char !== ' ' && char !== '\t') throw new Error(`Malformed CSV at spreadsheet row ${records.length + 1}, column ${record.length + 1}: unexpected text after a closing quote.`);
      cell += char;
    }
    if (cell.length > MAX_CELL_LENGTH) throw new Error('A spreadsheet cell exceeds the 20,000-character limit.');
  }
  if (quoted) throw new Error(`Malformed CSV at spreadsheet row ${records.length + 1}: an opening quote was not closed.`);
  if (touched || record.length || cell.length) finishRecord();
  return records;
}

export function parseProductCsv(source: string): CsvPreview {
  const text = source.replace(/^\uFEFF/, '');
  if (!text) throw new Error('The selected file is empty or contains only blank rows.');
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw new Error('The file exceeds the 5 MB limit.');
  const delimiter = detectDelimiter(text);
  const records = readRecords(text, delimiter);
  const first = records.findIndex(record => record.some(cell => cell.trim()));
  const headers = first >= 0 ? records[first]! : [];
  // Check original parsed data before trimming, skipping blank rows or validating.
  // Required header labels are exempt; separators and CSV quoting are already parsed.
  for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
    if (recordIndex === first) continue;
    const cells = records[recordIndex]!;
    for (let columnIndex = 0; columnIndex < cells.length; columnIndex++) {
      const cell = cells[columnIndex]!;
      for (let characterIndex = 0; characterIndex < cell.length; characterIndex++) {
        const character = cell[characterIndex]!;
        const whitespace = /\s/u.test(character);
        // Ordinary internal spaces are part of names, not prohibited content.
        // Keep the original value; edge spaces and other whitespace stay restricted.
        if (character === ' ' && NAME_COLUMNS.includes(columnIndex) && characterIndex > 0 && characterIndex < cell.length - 1) continue;
        if (!whitespace && !PROHIBITED_CELL_CHARACTERS.has(character)) continue;
        const codePoint = `U+${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
        const label = whitespace ? `whitespace (${codePoint})` : `prohibited character ${JSON.stringify(character)}`;
        const column = headers[columnIndex]?.trim() || `Column ${columnIndex + 1}`;
        throw new Error(`Warning: preview blocked. Spreadsheet row ${recordIndex + 1}, column ${columnIndex + 1} (${column}) contains ${label} at character ${characterIndex + 1}. No data preview is shown; cell values have not been changed.`);
      }
    }
  }
  if (first < 0) throw new Error('The selected file contains only blank rows.');
  const trimmed = headers.map(header => header.trim());
  const headerErrors: string[] = [];
  const missing = PRODUCT_COLUMNS.filter(column => !trimmed.includes(column));
  const unexpected = trimmed.filter(header => !PRODUCT_COLUMNS.some(column => column === header));
  const duplicate = [...new Set(trimmed.filter((header, index) => trimmed.indexOf(header) !== index))];
  if (missing.length) headerErrors.push(`Missing headers: ${missing.join(', ')}.`);
  if (unexpected.length) headerErrors.push(`Unexpected headers: ${unexpected.map(header => header || '(blank)').join(', ')}.`);
  if (duplicate.length) headerErrors.push(`Duplicate headers: ${duplicate.map(header => header || '(blank)').join(', ')}.`);
  if (trimmed.length !== PRODUCT_COLUMNS.length) headerErrors.push(`Expected 14 headers; found ${trimmed.length}.`);
  if (!missing.length && !unexpected.length && !duplicate.length && trimmed.some((header, index) => header !== PRODUCT_COLUMNS[index])) {
    headerErrors.push('Headers are reordered. Use the exact 14-column order shown in Excel Sheet Instructions.');
  }

  let blankRows = first;
  const rows: PreviewRow[] = [];
  for (let index = first + 1; index < records.length; index++) {
    const cells = records[index]!;
    if (cells.every(cell => !cell.trim())) { blankRows++; continue; }
    if (rows.length >= MAX_PRODUCT_ROWS) throw new Error('The file exceeds the 10,000 product-row limit.');
    const row: PreviewRow = { rowNumber: index + 1, cells, errors: [], warnings: [] };
    if (headerErrors.length) {
      row.errors.push({ column: 'Headers', message: 'Fix the header errors before column validation can run. Original cells are shown without remapping.' });
    } else {
      if (cells.length !== PRODUCT_COLUMNS.length) row.errors.push({ column: 'Row structure', message: `Expected 14 cells; found ${cells.length}.` });
      if (!cells[0]?.trim()) row.errors.push({ column: 'Product Name', message: 'Product Name must not be blank.' });
      for (const columnIndex of NUMERIC_COLUMNS) {
        const value = cells[columnIndex]?.trim() ?? '';
        const column = PRODUCT_COLUMNS[columnIndex]!;
        if (!value) row.warnings.push({ column, message: 'Blank numeric cell; its required-value rule is not confirmed.' });
        else if (!NUMBER_PATTERN.test(value) || !Number.isFinite(Number(value))) {
          row.errors.push({ column, message: 'Enter a finite decimal number; invalid values are not converted to zero.' });
        }
      }
      const weightable = cells[12]?.trim().toLowerCase() ?? '';
      if (weightable && weightable !== 'yes' && weightable !== 'no') row.errors.push({ column: 'Weightable', message: 'Use the source yes/no format.' });
      cells.forEach((value, columnIndex) => {
        if (/^[=+@]/.test(value.trim()) && !NUMERIC_COLUMNS.includes(columnIndex)) {
          row.warnings.push({ column: PRODUCT_COLUMNS[columnIndex] ?? `Extra column ${columnIndex + 1}`, message: 'Formula-like content is displayed as text and is never evaluated.' });
        }
      });
    }
    rows.push(row);
  }

  const repetitions = new Map<string, PreviewRow[]>();
  for (const row of rows) {
    const signature = JSON.stringify(row.cells.map(cell => cell.trim()));
    const group = repetitions.get(signature) ?? [];
    group.push(row);
    repetitions.set(signature, group);
  }
  for (const group of repetitions.values()) {
    if (group.length < 2) continue;
    const locations = group.slice(0, 10).map(entry => entry.rowNumber).join(', ');
    const message = `Possible duplicate in uploaded file (rows ${locations}${group.length > 10 ? ` and ${group.length - 10} more` : ''}). No rows have been merged or removed.`;
    for (const row of group) row.warnings.push({ column: 'Entire row', message });
  }
  return { headers, headerRow: first + 1, headerErrors, delimiter, blankRows, rows };
}

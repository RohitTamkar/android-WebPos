import { ChevronDown, FileSpreadsheet } from 'lucide-react';
import { PRODUCT_COLUMNS } from './productCsvPreview.ts';
import './ExcelSheetInstructions.css';

// Illustrations only. Nothing in this component reads outlet data or performs uploads.
const examples = [
  ['Basmati Rice', 'बासमती तांदूळ', 120, 120, 140, 95, 'Groceries', 1, 0, '8901000000001', 'number', 0, 'YES', 101],
  ['Wheat Flour', 'गव्हाचे पीठ', 55, 55, 65, 42, 'Groceries', 1, 5, '8901000000002', 'number', 0, 'YES', 102],
  ['Sugar', 'साखर', 45, 45, 50, 38, 'Groceries', 1, 5, '8901000000003', 'number', 0, 'YES', 103],
  ['Cooking Oil', 'खाद्यतेल', 160, 160, 180, 135, 'Groceries', 1, 5, '8901000000004', 'number', 0, 'NO', 104],
  ['Table Salt', 'मीठ', 25, 25, 30, 18, 'Groceries', 1, 0, '8901000000005', 'number', 0, 'NO', 105],
  ['Red Chilli Powder', 'लाल तिखट', 75, 75, 85, 58, 'Spices', 2, 5, '8901000000006', 'number', 0, 'NO', 106],
  ['Turmeric Powder', 'हळद', 50, 50, 60, 36, 'Spices', 2, 5, '8901000000007', 'number', 0, 'NO', 107],
  ['Black Pepper', 'काळी मिरी', 110, 110, 125, 85, 'Spices', 2, 5, '8901000000008', 'number', 0, 'YES', 108],
  ['Tea Powder', 'चहा पावडर', 140, 140, 160, 112, 'Beverages', 3, 5, '8901000000009', 'number', 0, 'NO', 109],
  ['Coffee Powder', 'कॉफी पावडर', 180, 180, 200, 145, 'Beverages', 3, 5, '8901000000010', 'number', 0, 'NO', 110],
  ['Biscuits', 'बिस्किटे', 20, 20, 25, 15, 'Snacks', 4, 18, '8901000000011', 'number', 0, 'NO', 111],
  ['Noodles', 'नूडल्स', 40, 40, 45, 30, 'Snacks', 4, 12, '8901000000012', 'number', 0, 'NO', 112],
  ['Soft Drink', 'शीतपेय', 45, 45, 50, 34, 'Beverages', 3, 18, '8901000000013', 'number', 0, 'NO', 113],
  ['Ice Cream', 'आइसक्रीम', 60, 60, 70, 44, 'Dairy', 5, 18, '8901000000014', 'number', 0, 'NO', 114],
  ['Toor Dal', 'तूर डाळ', 150, 150, 170, 125, 'Groceries', 1, 5, '8901000000015', 'number', 0, 'YES', 115],
  ['Moong Dal', 'मूग डाळ', 130, 130, 150, 105, 'Groceries', 1, 5, '8901000000016', 'number', 0, 'YES', 116],
  ['Poha', 'पोहे', 65, 65, 75, 48, 'Groceries', 1, 0, '8901000000017', 'number', 0, 'YES', 117],
  ['Semolina', 'रवा', 60, 60, 70, 45, 'Groceries', 1, 5, '8901000000018', 'number', 0, 'YES', 118],
  ['Milk', 'दूध', 30, 30, 32, 25, 'Dairy', 5, 0, '8901000000019', 'number', 0, 'NO', 119],
  ['Butter', 'लोणी', 55, 55, 60, 43, 'Dairy', 5, 12, '8901000000020', 'number', 0, 'NO', 120],
];
const widths = [190, 180, 120, 110, 110, 130, 170, 115, 80, 150, 105, 80, 120, 115];
const numericColumns = new Set([2, 3, 4, 5, 7, 8, 11, 13]);
const instructions = [
  { title: 'Keep all 14 columns', text: 'Use the exact headers and order shown, from Product Name to Search Code. Keep the header in the first nonblank row.' },
  { title: 'Save as CSV', text: 'Use UTF-8 CSV (.csv); TSV is also accepted. Maximum 5 MB and 10,000 product rows. XLS and XLSX files are not supported.' },
  { title: 'Match the category name', text: 'Category Name must exactly match an existing category in the selected outlet. The example categories are illustrative, not your POS records.' },
  { title: 'Use its category number', text: 'Category No must be the number of that same existing category in Category Master. Do not use the spreadsheet row number.' },
  { title: 'Check prices and cell values', text: 'Default Price and Price 1 must match. Fill numeric cells, using zero where applicable. Current CSV checks reject decimal points, prohibited punctuation and extra whitespace; ordinary internal spaces are allowed in names.' },
  { title: 'Start with zero stock', text: 'Stock must be numeric. This uploader currently accepts only 0 opening stock. Unit Type must be number.' },
  { title: 'Use YES or NO', text: 'Weightable accepts YES or NO, in either letter case. Do not use true, false or a tick mark in the file.' },
  { title: 'Use a configured GST rate', text: 'Tax is the numeric GST percentage configured in the POS, without a % sign. Use 0 only when configured. The example tax rates do not define your tax configuration.' },
  { title: 'Review assigned Search Codes', text: 'Keep the Search Code column. File codes are ignored; the server assigns codes after the outlet’s highest existing numeric code. Preview the final codes before uploading.' },
  { title: 'Premises are a separate workflow', text: 'Premises 1–5 belong to Upload with Premises, which is currently unavailable. Do not append premise 1 or premise 2: no optional premise columns, naming/order rules or premise-price JSON are accepted by this 14-column uploader.' },
  { title: 'Resolve repeated products', text: 'Names alone do not identify duplicates. Otherwise identical product rows are rejected even if their Search Codes differ. Existing matching products are not overwritten.' },
];

export function ExcelSheetInstructions() {
  return <div className="excel-sheet-instructions">
    <div className="sheet-instructions-layout">
      <section className="sheet-workbook" aria-labelledby="sheet-preview-title">
        <div className="sheet-workbook-heading"><span><FileSpreadsheet size={17} aria-hidden="true" /><strong id="sheet-preview-title">Products.csv</strong></span><span className="sheet-sample-badge">Illustrative sample</span></div>
        <div className="sheet-formula-bar" aria-label="Example selected cell A2: Basmati Rice">
          <span className="sheet-name-box">A2<ChevronDown size={12} aria-hidden="true" /></span><span className="sheet-formula-symbol" aria-hidden="true">fx</span><span>Basmati Rice</span>
        </div>
        <div className="sheet-grid-scroll" role="region" aria-label="Illustrative product spreadsheet, scroll to see all 14 columns" tabIndex={0}>
          <table className="sheet-grid" style={{ width: 44 + widths.reduce((sum, width) => sum + width, 0) }}>
            <caption className="sheet-accessible-caption">20 illustrative product rows. Sample categories, numbers, barcodes and tax rates are not loaded from the database.</caption>
            <colgroup><col style={{ width: 44 }} />{widths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
            <thead>
              <tr className="sheet-column-letters"><td aria-hidden="true" />{PRODUCT_COLUMNS.map((column, index) => <td key={column} aria-hidden="true" className={index === 0 ? 'sheet-selected-heading' : undefined}>{String.fromCharCode(65 + index)}</td>)}</tr>
              <tr className="sheet-column-headers"><th scope="row" className="sheet-row-number">1</th>{PRODUCT_COLUMNS.map(column => <th key={column} scope="col">{column}</th>)}</tr>
            </thead>
            <tbody>{examples.map((cells, rowIndex) => <tr key={rowIndex}>
              <th scope="row" className={`sheet-row-number${rowIndex === 0 ? ' sheet-selected-heading' : ''}`}>{rowIndex + 2}</th>
              {cells.map((cell, columnIndex) => <td key={columnIndex} className={`${numericColumns.has(columnIndex) ? 'sheet-number' : ''}${rowIndex === 0 && columnIndex === 0 ? ' sheet-selected-cell' : ''}`}>{cell}</td>)}
            </tr>)}</tbody>
          </table>
        </div>
        <div className="sheet-bottom-bar"><span className="sheet-tab"><FileSpreadsheet size={14} aria-hidden="true" />Products</span><span>20 sample products · 14 columns</span></div>
        <p className="sheet-sample-note">Preview only — all values are illustrative. Use your outlet’s existing categories and configured tax rates. Stock is 0 to match the current upload rules.</p>
      </section>
      <aside className="sheet-instruction-panel" aria-labelledby="sheet-rules-title">
        <div className="sheet-rules-heading"><span className="sheet-rules-label" aria-hidden="true">01—11</span><h3 id="sheet-rules-title">Sheet instructions</h3></div>
        <ol className="sheet-rules-list" tabIndex={0} aria-label="Product sheet rules">
          {instructions.map((instruction, index) => <li key={instruction.title}><span className="sheet-rule-number" aria-hidden="true">{index + 1}</span><div><h4>{instruction.title}</h4><p>{instruction.text}</p></div></li>)}
        </ol>
      </aside>
    </div>
    <section className="sheet-required-columns" aria-labelledby="sheet-required-title">
      <h3 id="sheet-required-title">Required columns <span>Keep this exact order</span></h3>
      <ol>{PRODUCT_COLUMNS.map((column, index) => <li key={column}><span>{index + 1}.</span> {column}</li>)}</ol>
    </section>
  </div>;
}

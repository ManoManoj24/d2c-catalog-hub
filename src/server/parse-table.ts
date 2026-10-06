import ExcelJS from "exceljs";
import Papa from "papaparse";
import { duplicateHeaders } from "@/domain/import/mapping";

export type ParsedTable = {
  headers: string[];
  rows: { rowNumber: number; raw: Record<string, string>; formulaCells: string[] }[];
  errors: string[];
};

function cellText(value: ExcelJS.CellValue): { text: string; formula: boolean } {
  if (value == null) return { text: "", formula: false };
  if (typeof value === "object" && "formula" in value) {
    const result = "result" in value ? value.result : "";
    return { text: result == null ? "" : String(result), formula: true };
  }
  if (typeof value === "object" && "text" in value && value.text) return { text: String(value.text), formula: false };
  if (value instanceof Date) return { text: value.toISOString().slice(0, 10), formula: false };
  return { text: String(value), formula: false };
}

export function parseCsv(text: string, limits: { maxRows: number; maxCellLength: number }): ParsedTable {
  const errors: string[] = [];
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  const matrix = parsed.data.filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
  if (matrix.length === 0) return { headers: [], rows: [], errors: ["The file has no rows."] };
  const headers = matrix[0].map((cell) => String(cell ?? "").trim());
  if (headers.some((header) => !header)) errors.push("The header row has an empty column.");
  const dupes = duplicateHeaders(headers);
  if (dupes.length) errors.push(`Duplicate columns: ${dupes.join(", ")}.`);
  const rows = matrix.slice(1, limits.maxRows + 1).map((cells, index) => {
    const raw: Record<string, string> = {};
    const formulaCells: string[] = [];
    headers.forEach((header, cellIndex) => {
      let value = String(cells[cellIndex] ?? "").trim();
      if (value.length > limits.maxCellLength) {
        errors.push(`Row ${index + 2} column ${header} exceeds ${limits.maxCellLength} characters.`);
        value = value.slice(0, limits.maxCellLength);
      }
      if (/^[=+\-@]/.test(value)) formulaCells.push(header);
      raw[header] = value;
    });
    return { rowNumber: index + 2, raw, formulaCells };
  });
  if (matrix.length - 1 > limits.maxRows) errors.push(`Row limit is ${limits.maxRows}. Extra rows were ignored.`);
  return { headers, rows, errors };
}

export async function parseXlsx(buffer: Buffer, limits: { maxRows: number; maxCellLength: number }): Promise<ParsedTable> {
  const errors: string[] = [];
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [], errors: ["The workbook has no sheets."] };
  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    headers[col - 1] = cellText(cell.value).text.trim();
  });
  const compactHeaders = headers.filter(Boolean);
  if (compactHeaders.length === 0) return { headers: [], rows: [], errors: ["The first row has no headers."] };
  if (duplicateHeaders(compactHeaders).length) errors.push(`Duplicate columns: ${duplicateHeaders(compactHeaders).join(", ")}.`);
  const rows: ParsedTable["rows"] = [];
  const last = Math.min(sheet.rowCount, limits.maxRows + 1);
  for (let rowNumber = 2; rowNumber <= last; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const raw: Record<string, string> = {};
    const formulaCells: string[] = [];
    let any = false;
    headers.forEach((header, index) => {
      if (!header) return;
      const parsed = cellText(row.getCell(index + 1).value);
      let text = parsed.text.trim();
      if (text) any = true;
      if (text.length > limits.maxCellLength) {
        errors.push(`Row ${rowNumber} column ${header} exceeds ${limits.maxCellLength} characters.`);
        text = text.slice(0, limits.maxCellLength);
      }
      if (parsed.formula) formulaCells.push(header);
      raw[header] = text;
    });
    if (any) rows.push({ rowNumber, raw, formulaCells });
  }
  if (sheet.rowCount > limits.maxRows + 1) errors.push(`Row limit is ${limits.maxRows}. Extra rows were ignored.`);
  return { headers: compactHeaders, rows, errors };
}

export async function parseTabular(fileName: string, buffer: Buffer, limits: { maxRows: number; maxCellLength: number }): Promise<ParsedTable> {
  if (fileName.toLowerCase().endsWith(".csv")) return parseCsv(buffer.toString("utf8"), limits);
  if (fileName.toLowerCase().endsWith(".xlsx")) return parseXlsx(buffer, limits);
  return { headers: [], rows: [], errors: ["Upload a CSV or XLSX file."] };
}

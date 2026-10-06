import ExcelJS from "exceljs";
import type { ChannelSpec } from "@/domain/types";

export async function buildPristineTemplate(headers: string[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const notes = workbook.addWorksheet("Instructions");
  notes.getCell("A1").value = "PIM-lite generic kidswear channel template";
  notes.getCell("A2").value = "version=generic-kidswear-v1";
  notes.getCell("A3").value = "Do not remove this sheet or edit rows 1-3 of Data.";
  const data = workbook.addWorksheet("Data");
  data.getCell("A1").value = "template=generic-kidswear-v1";
  data.getCell("B1").value = "locale=en-IN";
  data.getCell("C1").value = "category=kidswear";
  data.getCell("A2").value = "protected=metadata";
  data.getCell("B2").value = "insertionRow=4";
  headers.forEach((header, index) => {
    data.getRow(3).getCell(index + 1).value = header;
  });
  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}

function textOf(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "object" && "text" in value) return String(value.text ?? "");
  return String(value);
}

export async function injectChannelRows(template: Buffer, channel: ChannelSpec, matrix: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(template as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet(channel.dataSheet);
  if (!sheet) throw new Error(`Template is missing the ${channel.dataSheet} sheet.`);
  const headers = channel.columns.map((column) => column.header);
  headers.forEach((header, index) => {
    const found = textOf(sheet.getRow(channel.headerRow).getCell(index + 1).value);
    if (found !== header) {
      throw new Error(`Template header “${found}” does not match “${header}”. Refusing to inject.`);
    }
  });
  matrix.forEach((row, rowIndex) => {
    const target = sheet.getRow(channel.insertionRow + rowIndex);
    row.forEach((value, columnIndex) => {
      target.getCell(columnIndex + 1).value = value;
    });
    target.commit();
  });
  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}

export function snapshotInvariant(workbook: ExcelJS.Workbook, channel: ChannelSpec): string[] {
  const notes = workbook.getWorksheet("Instructions");
  const data = workbook.getWorksheet(channel.dataSheet);
  const cells: string[] = [];
  if (notes) {
    notes.eachRow((row) => {
      row.eachCell((cell) => cells.push(`I:${cell.address}=${textOf(cell.value)}`));
    });
  }
  if (data) {
    for (let rowNumber = 1; rowNumber < channel.insertionRow; rowNumber += 1) {
      const row = data.getRow(rowNumber);
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        if (col <= channel.columns.length) cells.push(`D:${cell.address}=${textOf(cell.value)}`);
      });
    }
  }
  return cells;
}

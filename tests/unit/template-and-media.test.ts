import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { loadKidswearPack } from "@/domain/pack/load";
import { buildChannelMatrix } from "@/domain/publishing/rows";
import { checkImageUrl } from "@/domain/media/check";
import { isPrivateHost } from "@/domain/media/url-safety";
import { buildPristineTemplate, injectChannelRows, snapshotInvariant } from "@/server/template-inject";

describe("template injection", () => {
  it("writes data from row 4 and leaves the shell alone", async () => {
    const channel = loadKidswearPack().pack.channels[0];
    const headers = channel.columns.map((column) => column.header);
    const pristine = await buildPristineTemplate(headers);
    const beforeBook = new ExcelJS.Workbook();
    await beforeBook.xlsx.load(pristine as unknown as ExcelJS.Buffer);
    const before = snapshotInvariant(beforeBook, channel);
    const matrix = buildChannelMatrix(channel, [{
      sku: "KW-1",
      channelReady: true,
      channelMessages: [],
      values: {
        style_code: "KW-1",
        style_name: "Romper",
        brand: "Tiny Nest",
        color: "Sky Blue",
        size: "0-3M",
        sku: "KW-1",
        mrp: 799,
        hsn_code: "6111",
        gst_rate: 5,
        age_range: "0-3M",
        net_quantity: "1 N",
        country_of_origin: "India",
        mfg_pack_month_year: "2026-03",
        main_image_url: "https://cdn.example/a.png",
        fabric: "Cotton",
      },
    }]);
    const injected = await injectChannelRows(pristine, channel, matrix.matrix);
    const afterBook = new ExcelJS.Workbook();
    await afterBook.xlsx.load(injected as unknown as ExcelJS.Buffer);
    expect(snapshotInvariant(afterBook, channel)).toEqual(before);
    expect(String(afterBook.getWorksheet("Data")?.getRow(4).getCell(1).value)).toBe("Parent");
    expect(String(afterBook.getWorksheet("Data")?.getRow(5).getCell(1).value)).toBe("Child");
    expect(matrix.blocked).toEqual([]);
  });
});

describe("media checks", () => {
  it("accepts a 200 image and rejects metadata hosts", async () => {
    expect(isPrivateHost("169.254.169.254")).toBe(true);
    const ok = await checkImageUrl("https://cdn.example/a.png", (async () => new Response(null, {
      status: 200,
      headers: { "content-type": "image/png" },
    })) as typeof fetch);
    expect(ok.ok).toBe(true);
    const bad = await checkImageUrl("https://cdn.example/a.png", (async () => new Response(null, {
      status: 200,
      headers: { "content-type": "text/html" },
    })) as typeof fetch);
    expect(bad.ok).toBe(false);
    const blocked = await checkImageUrl("http://169.254.169.254/latest/meta-data");
    expect(blocked.ok).toBe(false);
  });
});

import type { TaxSchedule } from "../types";

export type GstResolution =
  | { ok: true; ratePercent: number; scheduleId: string; note: string }
  | { ok: false; scheduleId: string; message: string; proposedFix?: string };

function orderedRules(schedule: TaxSchedule, code: string) {
  const entry = schedule.hsn.find((item) => item.code === code);
  if (!entry) return null;
  const rules = [...entry.rateRules].sort((a, b) => {
    if (a.maxSaleValueInrInclusive == null) return 1;
    if (b.maxSaleValueInrInclusive == null) return -1;
    return a.maxSaleValueInrInclusive - b.maxSaleValueInrInclusive;
  });
  return { entry, rules };
}

export function resolveGstRate(schedule: TaxSchedule, hsnCode: string, saleValue: number): GstResolution {
  const found = orderedRules(schedule, hsnCode);
  if (!found) {
    const known = schedule.hsn.map((item) => item.code).join(", ");
    return {
      ok: false,
      scheduleId: schedule.id,
      message: `HSN ${hsnCode || "(blank)"} is not in tax schedule ${schedule.id}.`,
      proposedFix: known ? `Use one of: ${known}.` : undefined,
    };
  }
  for (const rule of found.rules) {
    if (rule.maxSaleValueInrInclusive == null || saleValue <= rule.maxSaleValueInrInclusive) {
      return {
        ok: true,
        ratePercent: rule.ratePercent,
        scheduleId: schedule.id,
        note: rule.note ?? found.entry.label,
      };
    }
  }
  return {
    ok: false,
    scheduleId: schedule.id,
    message: `Tax schedule ${schedule.id} has no rate rule for HSN ${hsnCode} at sale value ${saleValue}.`,
  };
}

export function activeTaxSchedule(schedules: TaxSchedule[]): TaxSchedule {
  const active = schedules.filter((item) => item.activation === "active");
  if (active.length !== 1) {
    throw new Error(`Expected one active tax schedule, found ${active.length}.`);
  }
  return active[0];
}

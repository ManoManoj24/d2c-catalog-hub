"use client";

import { useEffect } from "react";

export function RefreshWhile({ active }: { active: boolean }) {
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => window.location.reload(), 1200);
    return () => window.clearInterval(id);
  }, [active]);
  return active ? <p className="pulse">Working through the queue…</p> : null;
}

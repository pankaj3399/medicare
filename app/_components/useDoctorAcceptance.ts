"use client";

import { useEffect, useState } from "react";

export type AcceptanceStatus = {
  inNetwork: "yes" | "no" | "unknown";
  reason?: string | null;
};

const cache = new Map<string, AcceptanceStatus>();
const inflight = new Map<string, Promise<AcceptanceStatus>>();

function key(npi: string, planKey: string): string {
  return `${npi}::${planKey}`;
}

async function fetchOne(npi: string, planKey: string): Promise<AcceptanceStatus> {
  const k = key(npi, planKey);
  if (cache.has(k)) return cache.get(k)!;
  if (inflight.has(k)) return inflight.get(k)!;

  const p = (async () => {
    try {
      const res = await fetch(`/api/doctors/${npi}/accepts/${planKey}`);
      if (!res.ok) return { inNetwork: "unknown" as const, reason: `HTTP ${res.status}` };
      const data = await res.json();
      const status: AcceptanceStatus = {
        inNetwork: data.inNetwork ?? "unknown",
        reason: data.reason ?? null,
      };
      cache.set(k, status);
      return status;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "fetch failed";
      cache.set(k, { inNetwork: "unknown" as const, reason: msg });
      return { inNetwork: "unknown" as const, reason: msg };
    } finally {
      inflight.delete(k);
    }
  })();

  inflight.set(k, p);
  return p;
}

export function useDoctorAcceptance(
  doctors: { id: string; npi?: string }[],
  planKey: string,
): Record<string, AcceptanceStatus> {
  const [statuses, setStatuses] = useState<Record<string, AcceptanceStatus>>({});

  useEffect(() => {
    let cancelled = false;
    const npis = doctors.map((d) => d.npi).filter((n): n is string => !!n);
    if (npis.length === 0 || !planKey) return;

    Promise.all(
      npis.map(async (npi) => [npi, await fetchOne(npi, planKey)] as const),
    ).then((results) => {
      if (cancelled) return;
      setStatuses((prev) => {
        const next = { ...prev };
        for (const [npi, status] of results) next[npi] = status;
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [doctors.map((d) => d.npi).join(","), planKey]);

  return statuses;
}

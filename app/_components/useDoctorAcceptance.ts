"use client";

import { useEffect, useState } from "react";

export type AcceptanceStatus = {
  inNetwork: "yes" | "no" | "unknown";
  reason?: string | null;
  acceptingPatients?: "yes" | "no" | "existing" | "unknown" | null;
  practiceLocations?: string[];
};

const cache = new Map<string, AcceptanceStatus>();
const inflight = new Map<string, Promise<AcceptanceStatus>>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

function key(npi: string, planKey: string): string {
  return `${npi}::${planKey}`;
}

export function getCachedAcceptance(npi: string, planKey: string): AcceptanceStatus | undefined {
  return cache.get(key(npi, planKey));
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
        acceptingPatients: data.acceptingPatients ?? null,
        practiceLocations: Array.isArray(data.practiceLocations)
          ? data.practiceLocations
          : [],
      };
      cache.set(k, status);
      notify();
      return status;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "fetch failed";
      cache.set(k, { inNetwork: "unknown" as const, reason: msg });
      notify();
      return { inNetwork: "unknown" as const, reason: msg };
    } finally {
      inflight.delete(k);
    }
  })();

  inflight.set(k, p);
  return p;
}

export function prefetchAcceptance(npi: string, planKey: string): void {
  if (!/^\d{10}$/.test(npi) || !planKey) return;
  void fetchOne(npi, planKey);
}

/**
 * Subscribes to all cache updates and bumps a render tick. Components that
 * read from the module-level cache via `getCachedAcceptance` should call this
 * once at the top so they re-render when new acceptance results arrive.
 */
export function useAcceptanceCacheTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return tick;
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

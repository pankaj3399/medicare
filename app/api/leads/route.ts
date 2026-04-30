import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  first: z.string().min(1).max(80),
  last: z.string().min(1).max(80),
  phone: z.string().min(7).max(40),
  email: z.string().email().max(200).optional().or(z.literal("")),
  bestTime: z.string().max(80).optional(),
  selectedPlanId: z.string().min(1).max(80),
  snapshot: z.record(z.any()).optional(),
});

const HITS = new Map<string, { count: number; ts: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;

function ipKey(req: Request): string {
  const f = req.headers.get("x-forwarded-for") ?? "";
  return f.split(",")[0].trim() || "unknown";
}

function rateLimited(req: Request): boolean {
  const key = ipKey(req);
  const now = Date.now();
  const cur = HITS.get(key);
  if (!cur || now - cur.ts > WINDOW_MS) {
    HITS.set(key, { count: 1, ts: now });
    return false;
  }
  cur.count++;
  return cur.count > MAX_PER_WINDOW;
}

export async function POST(request: Request) {
  if (rateLimited(request)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (e) {
    return NextResponse.json(
      { error: "invalid_body", details: e instanceof Error ? e.message : "" },
      { status: 400 },
    );
  }

  const ref = `P4M-${Date.now().toString(36).toUpperCase()}`;
  const broker = {
    name: process.env.NEXT_PUBLIC_BROKER_NAME ?? "Plan4me",
    npn: process.env.NEXT_PUBLIC_BROKER_NPN ?? "PENDING",
  };

  console.log(
    JSON.stringify({
      event: "lead.received",
      ref,
      planId: body.selectedPlanId,
      zip: body.snapshot?.zip,
      state: body.snapshot?.state,
      medicaid: body.snapshot?.medicaid,
    }),
  );

  const key = process.env.WEB3FORMS_KEY;
  if (key) {
    const message = `New Plan4me Lead (${ref})

NAME: ${body.first} ${body.last}
PHONE: ${body.phone}
EMAIL: ${body.email || "(not provided)"}
BEST TIME: ${body.bestTime || "(any)"}

PLAN: ${body.snapshot?.planName ?? "(unknown)"}
CARRIER: ${body.snapshot?.carrier ?? "(unknown)"}
PREMIUM: ${body.snapshot?.premium ?? "(unknown)"}
TYPE: ${body.snapshot?.type ?? "(unknown)"}

ZIP: ${body.snapshot?.zip ?? "?"} (${body.snapshot?.state ?? "?"})
MEDICAID: ${body.snapshot?.medicaid === true ? "Yes" : body.snapshot?.medicaid === false ? "No" : "Unknown"}
DOCTORS: ${(body.snapshot?.doctors ?? []).map((d: { name?: string }) => d?.name).filter(Boolean).join(", ") || "None"}
DRUGS: ${(body.snapshot?.drugs ?? []).map((d: { name?: string }) => d?.name).filter(Boolean).join(", ") || "None"}
PRIORITIES: ${(body.snapshot?.priorities ?? []).join(", ") || "None"}

BROKER: ${broker.name}
BROKER NPN: ${broker.npn}`;

    try {
      await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_key: key,
          subject: `New Plan4me Lead — ${body.first} ${body.last}`,
          from_name: "Plan4me",
          message,
        }),
      });
    } catch (err) {
      console.error("[/api/leads] web3forms forward failed:", err);
    }
  }

  return NextResponse.json({ ref, ok: true });
}

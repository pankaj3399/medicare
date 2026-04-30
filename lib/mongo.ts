import { MongoClient, type Db, type Collection } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || "plan4me";

if (!MONGODB_URI) {
  console.warn("[mongo] MONGODB_URI is not set — Mongo-backed routes will fail until it is.");
}

declare global {
  var __mongoClient: MongoClient | undefined;
  var __mongoClientPromise: Promise<MongoClient> | undefined;
}

function getClient(): Promise<MongoClient> {
  if (!MONGODB_URI) throw new Error("MONGODB_URI is not configured");
  if (!global.__mongoClientPromise) {
    global.__mongoClient = new MongoClient(MONGODB_URI);
    global.__mongoClientPromise = global.__mongoClient.connect();
  }
  return global.__mongoClientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  return client.db(MONGODB_DB);
}

export type PlanDoc = {
  year: number;
  state: string;
  stateName?: string | null;
  countyName?: string | null;
  contractCategory: string;
  contractId: string;
  planId: string;
  segmentId: string;
  contractPlanId?: string | null;
  contractPlanSegmentId?: string | null;
  parentOrg?: string | null;
  contractName?: string | null;
  carrier?: string | null;
  orgType?: string | null;
  name?: string | null;
  planType?: string | null;
  snpIndicator?: string | null;
  snpType?: string | null;
  dsnpIntegrationStatus?: string | null;
  isSnp: boolean;
  isDsnp: boolean;
  partDCoverage?: boolean | null;
  drugBenefitCategory?: string | null;
  drugBenefitType?: string | null;
  deductibleAnnual?: number | null;
  partDPremium?: number | null;
  partDTotalPremium?: number | null;
  partCPremium?: number | null;
  consolidatedPremium?: number | null;
  moop?: number | null;
  starPartC?: number | null;
  starPartD?: number | null;
  starOverall?: number | null;
};

export async function plansCol(): Promise<Collection<PlanDoc>> {
  const db = await getDb();
  return db.collection<PlanDoc>("plans");
}

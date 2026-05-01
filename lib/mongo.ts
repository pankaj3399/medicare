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

export type PlanFormularyMapDoc = {
  year: number;
  contractId: string;
  planId: string;
  segmentId: string;
  formularyId: string;
  premium?: number | null;
  deductible?: number | null;
  icl?: number | null;
};

export type FormularyDrugDoc = {
  year: number;
  formularyId: string;
  rxcui: number;
  ndc?: string | null;
  tier: number | null;
  quantityLimit: boolean;
  quantityAmount: number | null;
  quantityDays: number | null;
  priorAuth: boolean;
  stepTherapy: boolean;
};

export type TierCostDoc = {
  year: number;
  contractId: string;
  planId: string;
  segmentId: string;
  coverageLevel: number;
  tier: number;
  daysSupply: number;
  prefType: number | null;
  prefAmt: number | null;
  prefMin: number | null;
  prefMax: number | null;
  stdType: number | null;
  stdAmt: number | null;
  mailPrefType: number | null;
  mailPrefAmt: number | null;
  specialty: boolean;
  dedApplies: boolean;
};

export async function planFormularyMapCol(): Promise<Collection<PlanFormularyMapDoc>> {
  const db = await getDb();
  return db.collection<PlanFormularyMapDoc>("planFormularyMap");
}

export async function formularyDrugsCol(): Promise<Collection<FormularyDrugDoc>> {
  const db = await getDb();
  return db.collection<FormularyDrugDoc>("formularyDrugs");
}

export async function tierCostsCol(): Promise<Collection<TierCostDoc>> {
  const db = await getDb();
  return db.collection<TierCostDoc>("tierCosts");
}

export type CarrierFhirEndpointDoc = {
  parentOrg: string;
  fhirBase: string;
  notes?: string | null;
  enabled: boolean;
};

export type PlanNetworkMapDoc = {
  year: number;
  contractId: string;
  planId: string;
  segmentId: string;
  parentOrg: string;
  networkIds: string[];
  networkRefKind?: "Network" | "Organization" | null;
  networkName?: string | null;
  lastSyncedAt: Date;
};

export type DoctorPlanAcceptanceDoc = {
  npi: string;
  contractId: string;
  planId: string;
  segmentId: string;
  inNetwork: "yes" | "no" | "unknown";
  source: "fhir" | "manual";
  reason?: string | null;
  acceptingPatients?: "yes" | "no" | "existing" | "unknown" | null;
  practiceLocations?: string[];
  checkedAt: Date;
  ttlExpiresAt: Date;
};

export async function carrierFhirEndpointsCol(): Promise<Collection<CarrierFhirEndpointDoc>> {
  const db = await getDb();
  return db.collection<CarrierFhirEndpointDoc>("carrierFhirEndpoints");
}

export async function planNetworkMapCol(): Promise<Collection<PlanNetworkMapDoc>> {
  const db = await getDb();
  return db.collection<PlanNetworkMapDoc>("planNetworkMap");
}

export async function doctorPlanAcceptanceCol(): Promise<Collection<DoctorPlanAcceptanceDoc>> {
  const db = await getDb();
  return db.collection<DoctorPlanAcceptanceDoc>("doctorPlanAcceptance");
}

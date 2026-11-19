export type Carrier = 'capable' | 'none' | 'unknown';
export interface EvidenceItem {
  source?: string;
  source_ref?: string;
  kind?: string;
  confidence_impact?: string;
  [key: string]: unknown;
}
export interface CensusRecord {
  id: string;
  name: string;
  type: string;
  slice: string;
  carrier: Carrier;
  evidence: EvidenceItem[];
  declarationId?: string | null;
  file?: string;
  path?: string;
  family?: string;
  supportingEvidence?: EvidenceItem[];
  origin?: 'declared' | 'derived' | 'unknown';
  witnesses?: unknown[];
  certainty?: string | null;
  discoveryStage?: string | null;
  codeRefCount?: number;
  open?: boolean | null;
}
export interface CensusScope {
  project: string;
  modelState: string;
  schemaVersion: string | null;
  fileSetIdentity: string;
  selection: {
    slice: string | null;
    type: string | null;
    family: string | null;
    file: string | null;
    files: string[] | null;
    entityIds: string[] | null;
  };
  evaluatedAt: string;
  exclusions: { file: string; reason: string }[];
}
export interface GraphCensusInput {
  contractVersion: 1;
  scope: CensusScope;
  entities: CensusRecord[];
  relations: CensusRecord[];
}
export interface CensusShare {
  numerator: number;
  denominator: number;
  value: number | null;
  label: string;
}
export interface CensusCounts {
  total: number;
  carrierCapable: number;
  cannotState: number;
  carrierUnknown: number;
  withEvidence: number;
  eligibleWithEvidence: number;
  withTraceableSource: number;
  directEvidenceItems: number;
  noItems: number;
  sources: Record<string, number>;
  certaintyWithoutEvidence: number;
  stageWithoutEvidence: number;
  confirmedWithoutEvidence: number;
  evidenceKinds: Record<string, number>;
  confidenceImpacts: Record<string, number>;
  discoveryStages: Record<string, number>;
  certainties: Record<string, number>;
  weakeningItems: number;
  invalidatingItems: number;
  origins: Record<string, number>;
  evidenceStates: Record<string, number>;
  allObjectShare: CensusShare;
  carrierEligibleShare: CensusShare;
}
export interface CensusPopulation extends CensusCounts {
  byType: (CensusCounts & { key: string })[];
  bySlice: (CensusCounts & { key: string })[];
  byFamily?: (CensusCounts & { key: string })[];
}
export interface EvidenceCensus {
  contractVersion: 1;
  scope: CensusScope;
  definitions: Record<string, string>;
  raw: { entities: CensusPopulation; relations: CensusPopulation };
  graph: { status: 'available'; entities: CensusPopulation; relations: CensusPopulation }
    | { status: 'unavailable'; reason: string; entities: null; relations: null };
  fieldCompleteness: unknown[];
  openKnowledge: { type: string; total: number; open: number; unknown: number }[];
  codeReferences: { status: 'not-checked'; references: number };
  validationRuns: Record<string, { status: 'not-checked' }>;
  registeredReferences: { status: 'available' | 'unavailable' };
}
export const CENSUS_VERSION: 1;
export const CARRIERS: Carrier[];
export const RELATION_STATES: string[];
export function evidenceItems(record: Record<string, unknown> | null | undefined): EvidenceItem[];
export function share(numerator: number, denominator: number): CensusShare;
export function relationState(record: CensusRecord): string;
export function validateGraphInput(input: GraphCensusInput, scope: CensusScope): void;
export function measureEvidence(input: {
  scope: CensusScope;
  declarations: CensusRecord[];
  relationDeclarations?: CensusRecord[];
  graphInput?: GraphCensusInput;
  sourceRegistry?: { id: string }[];
  fieldCompleteness?: unknown[];
}): EvidenceCensus;

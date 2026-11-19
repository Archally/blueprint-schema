export interface ProductRecord { id: string; name?: string; source?: string; parentIds?: string[]; products?: unknown; tags?: unknown }
export interface ProductDiagnostic { code: string; id?: string; source?: string; message: string }
export interface ProductResolution {
  products: string[] | undefined; names: string[];
  origin: 'stated' | 'inherited' | 'legacy' | 'not stated' | 'unresolved';
  from: string[]; unresolved: string[]; diagnostics: ProductDiagnostic[];
}
export function resolveCapabilityProducts(records: readonly ProductRecord[], registry?: unknown): {
  resolutions: Map<string, ProductResolution>; diagnostics: ProductDiagnostic[]; fieldBearing: boolean;
};

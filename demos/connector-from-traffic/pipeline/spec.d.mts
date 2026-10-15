export function includePaths(specText: string, include: string[]): string;
export function deepMerge(base: unknown, overlay: unknown): any;
export function applyOverlay(specText: string, overlay: Record<string, unknown>): string;
export function coverageProblems(har: { log: { entries: any[] } }, specText: string, decisions: { apiPath: string; include: string[] }): string[];
export function listOperations(specText: string): { method: string; path: string; operationId?: string; readOnly: boolean }[];
export function exposeOperations(specText: string, operationIds: string[], options?: { allowWrites?: boolean }): string;
export function tokenEnvFor(specText: string): string;

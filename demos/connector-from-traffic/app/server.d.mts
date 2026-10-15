export const DEMO_USER: { username: string; password: string; token: string };
export function startApp(options?: { port?: number }): Promise<{
  url: string;
  events: unknown[];
  notes: { id: number; title: string; body: string; tags: string[]; updated: string }[];
  close(): Promise<void>;
}>;

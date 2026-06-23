export interface SessionOptions {
  username: string;
  password: string;
  baseUrl?: string;
}

export interface SpacemoltSession {
  client: unknown;
  readonly sessionId: string;
}

export async function createSession(_opts: SessionOptions): Promise<SpacemoltSession> {
  throw new Error('not implemented');
}

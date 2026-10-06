export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function appDatabaseUrl(): string {
  return process.env.APP_DATABASE_URL || requiredEnv("DATABASE_URL");
}

export function adminDatabaseUrl(): string {
  return requiredEnv("DATABASE_URL");
}

export function sessionSecret(): string {
  const secret = requiredEnv("SESSION_SECRET");
  if (secret.length < 16) throw new Error("SESSION_SECRET must be at least 16 characters.");
  return secret;
}

export function batchSize(): number {
  const parsed = Number(process.env.JOB_BATCH_SIZE ?? 250);
  if (!Number.isFinite(parsed)) return 250;
  return Math.min(500, Math.max(250, Math.round(parsed)));
}

export function appOrigin(): string {
  return process.env.APP_ORIGIN || "http://127.0.0.1:3000";
}

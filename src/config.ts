import fs from 'fs';
import path from 'path';
import * as toml from 'toml';
import { z } from 'zod';

export const configSchema = z.object({
  mqtt: z.object({
    server: z.string().url(),
    user: z.string(),
    password: z.string(),
    topicPrefix: z.string().default('dns'),
    clientId: z.string(),
  }),
  dns: z.object({
    domain: z.string(),
    ttl: z.number().int().min(1).default(300),
    interface: z.string().ip(),
    port: z.number().int().min(1).max(65535),
  }),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(configPath?: string) {
  const resolvedPath = configPath
    ? path.resolve(configPath)
    : path.join(process.cwd(), 'skeeterdns.toml');

  const rawToml = fs.readFileSync(resolvedPath, 'utf-8');
  const parsed = toml.parse(rawToml);

  return configSchema.parse(parsed);
}

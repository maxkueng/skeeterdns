import fs from 'fs';
import path from 'path';
import * as toml from 'toml';
import { z } from 'zod';

export const configSchema = z.object({
  debug: z.boolean().default(false),
  
  api: z.object({
    port: z.number().optional(),
    address: z.string().default('127.0.0.1'),
    ssl: z.boolean().default(false),
    keyFile: z.string().optional(),
    certFile: z.string().optional(),
  }).refine(
    (api) => !api.ssl || (api.keyFile && api.certFile),
    {
      message: 'keyFile and certFile are required when ssl is true',
      path: ['ssl'],
    }
  ),

  mqtt: z.object({
    server: z.string().url(),
    user: z.string().optional(),
    password: z.string().optional(),
    topicPrefix: z.string().default('dns'),
    clientId: z.string().optional(),
  }),

  dns: z.object({
    domain: z.string(),
    ttl: z.number().int().min(1).default(300),
    address: z.string().ip().default('127.0.0.1'),
    port: z.number().int().min(1).max(65535),
    fallbackDomains: z.array(z.string()).default([]),
    fallbackAddress: z.string().ip().default('127.0.0.1'),
  }),
});

export type Config = z.infer<typeof configSchema>;

type LoadConfigOptions = {
  defaults: Partial<Config>;
  configPath?: string;
};

export function loadConfig({
  configPath,
  defaults,
}: LoadConfigOptions) {
  const resolvedPath = configPath
    ? path.resolve(configPath)
    : path.join(process.cwd(), 'skeeterdns.toml');

  const rawToml = fs.readFileSync(resolvedPath, 'utf-8');
  const parsed = toml.parse(rawToml);

  const config = configSchema.parse(parsed);

  return {
    ...defaults,
    ...config,
  };
}

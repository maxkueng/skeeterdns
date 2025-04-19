import path from 'path';
import fs from 'fs';
import http from 'http';
import type { RequestListener } from 'http';
import https from 'https';
import express from 'express';
import type { Response } from 'express';
import cors from 'cors';
import validate from 'express-zod-safe';
import { StatusCodes } from 'http-status-codes';
import {
  Packet,
  createServer as createDnsServer,
} from 'dns2';
import type {
  DnsAnswer,
  DnsHandler,
} from 'dns2';
import { connect } from 'mqtt';
import { z } from 'zod';

import type { Config } from './config';

const recordSchema = z.object({
  type: z.enum(['A', 'CNAME', 'TXT']),
  value: z.string().min(1),
  ttl: z.number().int().positive().optional(),
});

type DnsRecord = z.infer<typeof recordSchema>;

type ErrorResponse = {
  error: string;
};

function getSubdomainFromTopic(baseTopic: string, topic: string) {
  if (topic.startsWith(`${baseTopic}/`)) {
    return topic.substring(`${baseTopic}/`.length);
  }
  
  return null;
}

function getHttpPort(config: Config) {
  if (config.api.port) {
    return config.api.port;
  }
  if (config.api.ssl) {
    return 443;
  }
  return 80;
}

function createHttpServer(config: Config, requestListener: RequestListener) {
  if (
    config.api.ssl
    && config.api.keyFile
    && config.api.certFile
  ) {
    const keyfilePath = path.resolve(config.api.keyFile);
    const certfilePath = path.resolve(config.api.certFile);

    return https.createServer({
      key: fs.readFileSync(keyfilePath, 'utf-8'),
      cert: fs.readFileSync(certfilePath, 'utf-8'),
    }, requestListener);
  }

  return http.createServer(requestListener);
}

export function startServer(config: Config) {
  const records = new Map<string, DnsAnswer>();
  const {
    fallbackDomains,
    fallbackAddress,
  } = config.dns;
  const mqttTopic = `${config.mqtt.topicPrefix}/${config.dns.domain}`;

  const mqttClient = connect(config.mqtt.server, {
    username: config.mqtt.user,
    password: config.mqtt.password,
    clientId: config.mqtt.clientId ?? `skeeterdns${Math.floor(Math.random() * 100000000)}`,
    clean: true,
    connectTimeout: 4000,
    reconnectPeriod: 1000,
  });

  mqttClient.on('connect', () => {
    console.info('MQTT connected');
    mqttClient.subscribe(`${mqttTopic}/+`);
  });
  
  mqttClient.on('reconnect', () => {
    if (config.debug) {
      console.log('Reconnecting to MQTT...');
    }
  });
  
  mqttClient.on('close', () => {
    if (config.debug) {
      console.log('MQTT connection closed');
    }
  });
  
  mqttClient.on('error', (err) => {
    console.error('MQTT error:', err);
  });
  
  mqttClient.on('offline', () => {
    if (config.debug) {
      console.warn('MQTT is offline');
    }
  });

  mqttClient.on('message', (topic: string, message: Buffer) => {
    const subdomain = getSubdomainFromTopic(mqttTopic, topic);
    if (!subdomain) {
      return;
    }

    const fqdn = `${subdomain}.${config.dns.domain}`;
    const messageString = message.toString();
    
    if (messageString === '') {
      records.delete(fqdn);
      if (config.debug) {
        console.log(`Delete record ${fqdn}`);
      }
      return;
    }

    try {
      const payload: DnsRecord = recordSchema.parse(JSON.parse(messageString));
      if (payload.type === 'CNAME') {
        records.set(fqdn, {
          name: fqdn,
          type: Packet.TYPE.CNAME,
          class: Packet.CLASS.IN,
          ttl: payload.ttl ?? config.dns.ttl,
          domain: payload.value,
        });
        if (config.debug) {
          console.log(`Set ${fqdn} -> CNAME ${payload.value}`);
        }
      }
    } catch (err) {
      console.error('Invalid JSON payload:', err);
    }
  });

  const handleDnsRequest: DnsHandler = (request, sendResponse) => {
    const response = Packet.createResponseFromRequest(request);
    const [question] = request.questions;
    const { name } = question;

    const record = records.get(name);
    if (record) {
      response.answers.push(record);
    } else {
      const matchedFallback = fallbackDomains.find((suffix) =>
        name.endsWith(suffix)
      );
      
      if (matchedFallback) {
        if (config.debug) {
          console.log(`Fallback for ${name} -> ${fallbackAddress}`);
        }
        response.answers.push({
          name,
          type: Packet.TYPE.A,
          class: Packet.CLASS.IN,
          ttl: config.dns.ttl,
          address: fallbackAddress,
        });
      }
    }
    sendResponse(response);
  };

  const dnsServer = createDnsServer({
    udp: true,
    handle: handleDnsRequest,
  });

  dnsServer.listen({
    udp: {
      port: config.dns.port,
      address: config.dns.address,
    },
  });
  
  const app = express();
  
  app.use(express.json());
  
  app.use(cors({
    origin: '*',
  }));

  app.get(
    '/records',
    (_req, res: Response<DnsAnswer[]>) => {
      const allRecords = [...records.values()];
      res.status(StatusCodes.OK).json(allRecords);
    },
  );
  
  app.post(
    '/records',
    validate({
      params: {
        subdomain: z.string(),
      },
      body: recordSchema.extend({
        subdomain: z.string(),
      }),
    }),
    (req, res) => {
      const payload = req.body;
      const { subdomain } = payload;
      const fqdn = `${subdomain}.${config.dns.domain}`;

      mqttClient.publish(
        `${mqttTopic}/${subdomain}`,
        JSON.stringify({
          type: payload.type,
          value: payload.value,
          ttl: payload.ttl,
        }),
        { retain: true },
      );
      if (config.debug) {
        console.log(`MQTT published: ${fqdn} -> CNAME ${payload.value}`);
      }
      res.status(StatusCodes.CREATED).send();
    },
  );

  app.get(
    '/records/:subdomain',
    validate({
      params: {
        subdomain: z.string(),
      },
    }),
    (req, res: Response<DnsAnswer>) => {
      const subdomain = req.params.subdomain;
      const fqdn = `${subdomain}.${config.dns.domain}`;
      const record = records.get(fqdn);
      if (!record) {
        throw new Error('Record not found');
      }
      res.status(StatusCodes.OK).json(record);
    },
  );
  
  app.put(
    '/records/:subdomain',
    validate({
      params: {
        subdomain: z.string(),
      },
      body: recordSchema,
    }),
    (req, res) => {
      const subdomain = req.params.subdomain;
      const payload = req.body;
      const fqdn = `${subdomain}.${config.dns.domain}`;

      mqttClient.publish(`${mqttTopic}/${subdomain}`, JSON.stringify(payload), { retain: true });
      if (config.debug) {
        console.log(`MQTT published: ${fqdn} -> CNAME ${payload.value}`);
      }
      res.status(StatusCodes.CREATED).send();
    },
  );
  
  app.delete(
    '/records/:subdomain',
    validate({
      params: {
        subdomain: z.string(),
      },
    }),
    (req, res) => {
    const subdomain = req.params.subdomain;
    const fqdn = `${subdomain}.${config.dns.domain}`;
    mqttClient.publish(`${mqttTopic}/${subdomain}`, '', { retain: true });
    if (config.debug) {
      console.log(`MQTT delete published: ${fqdn}`);
    }
    res.status(StatusCodes.NO_CONTENT).send();
    },
  );
  
  const httpPort = getHttpPort(config);
  const httpServer = createHttpServer(config, app);

  httpServer.listen(httpPort, config.api.address, () => {
    const protocol = config.api.ssl ? 'https' : 'http';
    const host = config.api.address;
    const apiUrl = `${protocol}://${host}:${httpPort}`;

    console.info('SkeeterDNS started');
    console.info(`API listening on ${apiUrl}`);
    console.info(`DNS listening on ${config.dns.address}:${config.dns.port} (UDP)`);
    console.info(`MQTT broker: ${config.mqtt.server}`);
    if (config.debug) {
      console.info('Debug mode is enabled');
    }
  });

  return (callback?: () => void) => {
    dnsServer.close();
    mqttClient.end(() => {
      httpServer.close(callback);
    });
  };
}

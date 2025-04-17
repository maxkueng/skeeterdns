import {
  Packet,
  createServer,
} from 'dns2';
import type {
  DnsAnswer,
  DnsHandler,
} from 'dns2';
import { connect } from 'mqtt';

import { loadConfig } from './config';

type RecordType = (
  | 'A'
  | 'CNAME'
  | 'TXT'
);

type DnsRecord = {
  type: RecordType;
  value: string;
  ttl?: number;
}

const args = process.argv.slice(2);
const configFlagIndex = args.findIndex(arg => arg === '-c' || arg === '--config');
const configPath = configFlagIndex !== -1 ? args[configFlagIndex + 1] : undefined;

const config = loadConfig(configPath);

function getSubdomainFromTopic(baseTopic: string, topic: string) {
  if (topic.startsWith(`${baseTopic}/`)) {
    return topic.substring(`${baseTopic}/`.length);
  }
  
  return null;
}

function start() {
  const records = new Map<string, DnsAnswer>();
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
    console.log('MQTT connected');
    mqttClient.subscribe(`${mqttTopic}/+`);
  });
  
  mqttClient.on('reconnect', () => {
    console.log('Reconnecting to MQTT...');
  });
  
  mqttClient.on('close', () => {
    console.log('MQTT connection closed');
  });
  
  mqttClient.on('error', (err) => {
    console.error('MQTT error:', err);
  });
  
  mqttClient.on('offline', () => {
    console.warn('MQTT is offline');
  });

  mqttClient.on('message', (topic: string, message: Buffer) => {
    const subdomain = getSubdomainFromTopic(mqttTopic, topic);
    if (!subdomain) {
      return;
    }

    const fqdn = `${subdomain}.${config.dns.domain}`;

    try {
      const payload: DnsRecord = JSON.parse(message.toString());
      if (payload.type === 'CNAME') {
        records.set(fqdn, {
          name: fqdn,
          type: Packet.TYPE.CNAME,
          class: Packet.CLASS.IN,
          ttl: payload.ttl ?? config.dns.ttl,
          domain: payload.value,
        });
        console.log(`Set ${fqdn} -> CNAME ${payload.value}`);
      }
    } catch (err) {
      console.error('Invalid JSON payload:', err);
    }
  });

  const handle: DnsHandler = (request, sendResponse) => {
    const response = Packet.createResponseFromRequest(request);
    const [question] = request.questions;
    const { name } = question;

    const record = records.get(name);
    if (record) {
      response.answers.push(record);
    }

    sendResponse(response);
  };

  const server = createServer({
    udp: true,
    handle,
  });

  server.listen({
    udp: {
      port: config.dns.port,
      address: config.dns.interface,
    }
  });
  
  return () => {
    mqttClient.end();
    return server.close();
  };
}

const shutdown = start();

process.on('SIGINT', () => {
  console.log('Caught SIGINT, shutting down...');
  shutdown();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Caught SIGTERM, shutting down...');
  shutdown();
  process.exit(0);
});

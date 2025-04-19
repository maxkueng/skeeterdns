import {
  Counter,
  Gauge,
  register,
} from 'prom-client';

import client from 'prom-client';

export { register };

export const startTimeGauge = new Gauge({
  name: 'skeeterdns_start_time_seconds',
  help: 'Start time of the server in seconds since epoch',
});

export const dnsRequestCounter = new Counter({
  name: 'skeeterdns_dns_requests_total',
  help: 'Total DNS requests',
});

export const dnsAnswerCounter = new Counter({
  name: 'skeeterdns_dns_answers_total',
  help: 'Total DNS answers',
  labelNames: ['type'],
});

export const dnsFallbackAnswerCounter = new Counter({
  name: 'skeeterdns_dns_fallback_answers_total',
  help: 'Total DNS fallback answers',
  labelNames: ['type'],
});

export const dnsNotFoundCounter = new Counter({
  name: 'skeeterdns_dns_not_found_total',
  help: 'Total DNS not found requests',
  labelNames: ['fqdn'],
});

export const mqttEventCounter = new Counter({
  name: 'skeeterdns_mqtt_events_total',
  help: 'Total MQTT events',
  labelNames: ['event'],
});

export const mqttPayloadErrorCounter = new Counter({
  name: 'skeeterdns_mqtt_payload_error_total',
  help: 'Total MQTT payload errors',
});

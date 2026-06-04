import type { Scanner, ScanResult } from './types.js';
import type { DiscoveryNode, NodeType } from '../types.js';
import { scanListeningPorts } from '../platform.js';

/** Well-known listening ports → node type + service name. */
const PORT_MAP: Record<number, { type: NodeType; service: string }> = {
  5432: { type: 'database_server', service: 'postgresql' },
  3306: { type: 'database_server', service: 'mysql' },
  1433: { type: 'database_server', service: 'sqlserver' },
  27017: { type: 'database_server', service: 'mongodb' },
  9200: { type: 'database_server', service: 'elasticsearch' },
  6379: { type: 'cache_server', service: 'redis' },
  11211: { type: 'cache_server', service: 'memcached' },
  9092: { type: 'message_broker', service: 'kafka' },
  5672: { type: 'message_broker', service: 'rabbitmq' },
  4222: { type: 'message_broker', service: 'nats' },
  9090: { type: 'web_service', service: 'prometheus' },
  3000: { type: 'web_service', service: 'http-app' },
  8080: { type: 'web_service', service: 'http-app' },
  8000: { type: 'web_service', service: 'http-app' },
  80: { type: 'web_service', service: 'http' },
  443: { type: 'web_service', service: 'https' },
  8200: { type: 'web_service', service: 'vault' },
  8500: { type: 'web_service', service: 'consul' },
  2379: { type: 'web_service', service: 'etcd' },
  5601: { type: 'web_service', service: 'kibana' },
  15672: { type: 'web_service', service: 'rabbitmq-management' },
};

/** Extract distinct listening port numbers from ss/lsof/PowerShell output. */
export function extractListeningPorts(raw: string): number[] {
  const ports = new Set<number>();
  for (const m of raw.matchAll(/[:.](\d{2,5})\b/g)) {
    const p = Number(m[1]);
    if (p in PORT_MAP) ports.add(p);
  }
  return [...ports];
}

export const portsScanner: Scanner = {
  id: 'local-ports',
  title: 'Local listening ports',
  platforms: 'all',
  allowedCommands: ['ss', 'lsof', 'Get-NetTCPConnection'],
  detect: () => true,
  async scan(): Promise<ScanResult> {
    const raw = scanListeningPorts();
    const nodes: DiscoveryNode[] = [];
    for (const port of extractListeningPorts(raw)) {
      const { type, service } = PORT_MAP[port]!;
      nodes.push({
        id: `${type}:localhost:${port}`,
        type,
        name: `${service} (:${port})`,
        discoveredVia: 'listening-port',
        confidence: 0.9,
        tags: ['local', service],
        metadata: { port, service, host: 'localhost' },
      });
    }
    return { nodes, edges: [] };
  },
};

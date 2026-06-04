import type { Scanner, ScanResult } from './types.js';
import type { DiscoveryNode } from '../types.js';
import { scanAllBookmarks } from '../bookmarks.js';

/** Hostname substrings that indicate a personal site — never catalogued. */
const PERSONAL = [
  'facebook.', 'instagram.', 'twitter.', 'x.com', 'tiktok.', 'reddit.', 'youtube.', 'netflix.',
  'spotify.', 'twitch.', 'pinterest.', 'snapchat.', 'whatsapp.', 'amazon.', 'ebay.', 'aliexpress.',
  'cnn.', 'bbc.', 'nytimes.', 'espn.', 'booking.', 'airbnb.', 'tripadvisor.', 'wikipedia.',
];

/** Well-known business/SaaS hostnames → catalogued as saas_tool. */
const BUSINESS = [
  'github.', 'gitlab.', 'bitbucket.', 'atlassian.', 'jira.', 'confluence.', 'notion.', 'linear.',
  'slack.', 'zoom.', 'figma.', 'miro.', 'vercel.', 'netlify.', 'heroku.', 'datadog', 'sentry.',
  'grafana.', 'pagerduty.', 'aws.amazon.', 'console.cloud.google', 'portal.azure', 'cloudflare.',
  'hubspot.', 'salesforce.', 'stripe.', 'twilio.', 'sendgrid.', 'mailchimp.', 'segment.', 'mixpanel.',
  'amplitude.', 'looker.', 'tableau.', 'snowflake.', 'databricks.', 'mongodb.', 'redis.', 'elastic.',
  'openai.', 'anthropic.', 'huggingface.', 'docker.', 'npmjs.', 'pypi.', 'circleci.', 'travis-ci.',
  'jenkins.', 'terraform.', 'hashicorp.', 'okta.', 'auth0.', '1password.', 'asana.', 'trello.', 'monday.',
];

function classify(hostname: string): { type: DiscoveryNode['type']; confidence: number } | null {
  const h = hostname.toLowerCase();
  if (PERSONAL.some((p) => h.includes(p))) return null;
  if (BUSINESS.some((b) => h.includes(b))) return { type: 'saas_tool', confidence: 0.7 };
  // Internal/custom hosts (IPs or *.company.tld with non-standard ports) → web_service
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || /\.(internal|local|corp|lan)\b/.test(h)) {
    return { type: 'web_service', confidence: 0.6 };
  }
  return null; // unknown public host — leave for LLM-driven classification
}

export const bookmarksScanner: Scanner = {
  id: 'bookmarks',
  title: 'Browser bookmarks',
  platforms: 'all',
  detect: () => true,
  async scan(): Promise<ScanResult> {
    const hosts = await scanAllBookmarks();
    const seen = new Set<string>();
    const nodes: DiscoveryNode[] = [];
    for (const host of hosts) {
      const klass = classify(host.hostname);
      if (!klass) continue;
      const id = `${klass.type}:${host.hostname}`;
      if (seen.has(id)) continue;
      seen.add(id);
      nodes.push({
        id, type: klass.type, name: host.hostname, discoveredVia: 'bookmark',
        confidence: klass.confidence, tags: ['bookmark'],
        metadata: { protocol: host.protocol, ...(host.port ? { port: host.port } : {}) },
      });
    }
    return { nodes, edges: [] };
  },
};

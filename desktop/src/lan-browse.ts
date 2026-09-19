/**
 * Browse LAN for TeamTracker offices advertised via mDNS (`_teamtracker._tcp`).
 */
import { Bonjour, type Browser, type Service } from 'bonjour-service';

export type DiscoveredOffice = {
  id: string;
  name: string;
  serverUrl: string;
  host: string;
  port: number;
};

type Listener = (offices: DiscoveredOffice[]) => void;

let bonjour: Bonjour | null = null;
let browser: Browser | null = null;
const offices = new Map<string, DiscoveredOffice>();
const listeners = new Set<Listener>();

function pickIPv4(service: Service): string | null {
  const addrs = (service.addresses || []).filter((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
  if (addrs.length) return addrs[0];
  const host = String(service.host || '').replace(/\.$/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
  // Fall back to hostname (may resolve via mDNS on the client)
  return host || null;
}

function officeFromService(service: Service): DiscoveredOffice | null {
  const host = pickIPv4(service);
  const port = Number(service.port) || 3001;
  if (!host) return null;
  const name = String(service.name || 'TeamTracker Office').trim() || 'TeamTracker Office';
  const serverUrl = `http://${host}:${port}`;
  const id = `${name}|${serverUrl}`.toLowerCase();
  return { id, name, serverUrl, host, port };
}

function emit(): void {
  const list = [...offices.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const fn of listeners) {
    try {
      fn(list);
    } catch {
      /* ignore listener errors */
    }
  }
}

export function listDiscoveredOffices(): DiscoveredOffice[] {
  return [...offices.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function onOfficesUpdated(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function startOfficeBrowse(): void {
  if (browser) return;
  try {
    bonjour = new Bonjour();
    browser = bonjour.find({ type: 'teamtracker', protocol: 'tcp' });
    browser.on('up', (service: Service) => {
      const office = officeFromService(service);
      if (!office) return;
      offices.set(office.id, office);
      emit();
    });
    browser.on('down', (service: Service) => {
      const office = officeFromService(service);
      if (!office) return;
      offices.delete(office.id);
      // Also remove by name+port variants
      for (const [key, val] of offices) {
        if (val.name === service.name && val.port === service.port) {
          offices.delete(key);
        }
      }
      emit();
    });
  } catch (err) {
    console.warn('[lan-browse] failed to start:', (err as Error).message);
  }
}

export function stopOfficeBrowse(): void {
  try {
    if (browser) {
      browser.stop();
      browser = null;
    }
    if (bonjour) {
      bonjour.destroy();
      bonjour = null;
    }
  } catch {
    /* ignore */
  }
  offices.clear();
  emit();
}

/**
 * Unit tests for LAN discovery helpers (no real mDNS).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import {
  buildLanUrls,
  isLanDiscoveryEnabled,
  listLanIPv4,
  sanitizeOfficeName,
  DEFAULT_OFFICE_NAME,
  getLanInfoSync,
} from '../lan-discovery.js';

describe('lan-discovery helpers', () => {
  it('isLanDiscoveryEnabled defaults to true', () => {
    assert.equal(isLanDiscoveryEnabled({}), true);
    assert.equal(isLanDiscoveryEnabled({ TEAMTRACKER_LAN_DISCOVERY: '' }), true);
  });

  it('isLanDiscoveryEnabled respects off flags', () => {
    assert.equal(isLanDiscoveryEnabled({ TEAMTRACKER_LAN_DISCOVERY: '0' }), false);
    assert.equal(isLanDiscoveryEnabled({ TEAMTRACKER_LAN_DISCOVERY: 'false' }), false);
    assert.equal(isLanDiscoveryEnabled({ TEAMTRACKER_LAN_DISCOVERY: 'OFF' }), false);
    assert.equal(isLanDiscoveryEnabled({ TEAMTRACKER_LAN_DISCOVERY: '1' }), true);
  });

  it('listLanIPv4 skips internal and link-local', () => {
    const fake: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      lo0: [
        {
          address: '127.0.0.1',
          netmask: '255.0.0.0',
          family: 'IPv4',
          mac: '00:00:00:00:00:00',
          internal: true,
          cidr: '127.0.0.1/8',
        },
      ],
      en0: [
        {
          address: '192.168.1.10',
          netmask: '255.255.255.0',
          family: 'IPv4',
          mac: 'aa:bb:cc:dd:ee:ff',
          internal: false,
          cidr: '192.168.1.10/24',
        },
        {
          address: '169.254.1.2',
          netmask: '255.255.0.0',
          family: 'IPv4',
          mac: 'aa:bb:cc:dd:ee:ff',
          internal: false,
          cidr: '169.254.1.2/16',
        },
      ],
    };
    assert.deepEqual(listLanIPv4(fake), ['192.168.1.10']);
  });

  it('buildLanUrls maps ips to http URLs', () => {
    assert.deepEqual(buildLanUrls(3001, ['10.0.0.5', '192.168.0.2']), [
      'http://10.0.0.5:3001',
      'http://192.168.0.2:3001',
    ]);
  });

  it('sanitizeOfficeName truncates and falls back', () => {
    assert.equal(sanitizeOfficeName('  Acme Corp  '), 'Acme Corp');
    assert.equal(sanitizeOfficeName('!!!'), DEFAULT_OFFICE_NAME);
    assert.equal(sanitizeOfficeName('a'.repeat(100)).length, 63);
  });

  it('getLanInfoSync returns primaryUrl from first lan url', () => {
    const info = getLanInfoSync(3001, 'Office A');
    assert.equal(info.officeName, 'Office A');
    assert.equal(info.port, 3001);
    assert.equal(typeof info.discovery, 'boolean');
    if (info.lanUrls.length > 0) {
      assert.equal(info.primaryUrl, info.lanUrls[0]);
    } else {
      assert.equal(info.primaryUrl, null);
    }
  });
});

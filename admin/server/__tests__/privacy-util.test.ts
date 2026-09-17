/**
 * Tests for privacy pattern normalization on the admin server.
 * Run: cd admin && npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPatternHost,
  isUrlPrivacyPattern,
  normalizePrivacyPattern,
} from '../privacy-util.js';

describe('privacy-util normalizePrivacyPattern', () => {
  it('stores WhatsApp URL as hostname', () => {
    const r = normalizePrivacyPattern('https://web.whatsapp.com/');
    assert.equal(r.stored, 'web.whatsapp.com');
    assert.equal(r.host, 'web.whatsapp.com');
  });

  it('normalizes subpaths and query to same host', () => {
    assert.equal(normalizePrivacyPattern('https://web.whatsapp.com/chat').stored, 'web.whatsapp.com');
    assert.equal(normalizePrivacyPattern('https://web.whatsapp.com/?foo=bar').stored, 'web.whatsapp.com');
  });

  it('strips www', () => {
    assert.equal(extractPatternHost('https://www.mail.google.com/'), 'mail.google.com');
  });

  it('keeps app names as-is', () => {
    const r = normalizePrivacyPattern('Slack');
    assert.equal(r.stored, 'Slack');
    assert.equal(r.host, null);
    assert.equal(isUrlPrivacyPattern('Slack'), false);
  });
});

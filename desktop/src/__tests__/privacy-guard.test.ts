/**
 * Unit tests for PrivacyGuard matching + decide matrix (no Electron).
 * Run: cd desktop && npx --yes tsx --test src/__tests__/privacy-guard.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyProbeError,
  decideFromProbe,
  isCaptureBlocked,
  isUrlPattern,
  matchUrlBlock,
  normalize,
  patternHost,
  urlMatchesHost,
  type CapturePrivacyBlock,
} from '../privacy-match.js';

const whatsappBlock: CapturePrivacyBlock = {
  appPattern: 'web.whatsapp.com',
  blockScreenshots: true,
  blockLiveView: true,
};

const slackBlock: CapturePrivacyBlock = {
  appPattern: 'Slack',
  blockScreenshots: true,
  blockLiveView: true,
};

describe('hostname normalization', () => {
  it('extracts host from full URL', () => {
    assert.equal(patternHost('https://web.whatsapp.com/'), 'web.whatsapp.com');
    assert.equal(patternHost('https://web.whatsapp.com/chat'), 'web.whatsapp.com');
    assert.equal(patternHost('https://web.whatsapp.com/?foo=bar'), 'web.whatsapp.com');
  });

  it('strips www and accepts bare host', () => {
    assert.equal(patternHost('www.web.whatsapp.com'), 'web.whatsapp.com');
    assert.equal(patternHost('web.whatsapp.com'), 'web.whatsapp.com');
  });

  it('detects URL patterns vs app names', () => {
    assert.equal(isUrlPattern('https://web.whatsapp.com/'), true);
    assert.equal(isUrlPattern('web.whatsapp.com'), true);
    assert.equal(isUrlPattern('Slack'), false);
  });
});

describe('urlMatchesHost', () => {
  it('matches subpaths and query params', () => {
    assert.equal(urlMatchesHost('https://web.whatsapp.com/chat', 'web.whatsapp.com'), true);
    assert.equal(urlMatchesHost('https://web.whatsapp.com/?foo=bar', 'web.whatsapp.com'), true);
  });

  it('matches subdomains of the protected host', () => {
    assert.equal(urlMatchesHost('https://foo.web.whatsapp.com/', 'web.whatsapp.com'), true);
  });

  it('does not match unrelated hosts', () => {
    assert.equal(urlMatchesHost('https://google.com/', 'web.whatsapp.com'), false);
    assert.equal(urlMatchesHost('https://whatsapp.com/', 'web.whatsapp.com'), false);
  });
});

describe('matchUrlBlock', () => {
  it('blocks when an active-tab URL matches', () => {
    const hit = matchUrlBlock(whatsappBlock, [
      'https://google.com/',
      'https://web.whatsapp.com/chat',
    ]);
    assert.ok(hit);
    assert.equal(hit.state, 'block');
    assert.equal(hit.matchedVia, 'web.whatsapp.com');
  });

  it('does not block when only a non-matching (e.g. foreground) URL is probed', () => {
    // PrivacyGuard now probes active tabs only; a background WhatsApp tab
    // never appears in this list, so capture stays allowed.
    assert.equal(matchUrlBlock(whatsappBlock, ['https://google.com/']), null);
  });
});

describe('decideFromProbe matrix', () => {
  it('allows when no blocks', () => {
    const d = decideFromProbe('screenshot', [], { ok: true, urls: [], browsers: [] });
    assert.equal(d.state, 'allow');
    assert.equal(isCaptureBlocked(d), false);
  });

  it('blocks on WhatsApp match for screenshot and liveView', () => {
    const probe = {
      ok: true as const,
      urls: ['https://web.whatsapp.com/'],
      browsers: ['Brave Browser'],
    };
    const shot = decideFromProbe('screenshot', [whatsappBlock], probe);
    const live = decideFromProbe('liveView', [whatsappBlock], probe);
    assert.equal(shot.state, 'block');
    assert.equal(live.state, 'block');
    assert.equal(isCaptureBlocked(shot), true);
  });

  it('allows google when whatsapp rule present but not open', () => {
    const d = decideFromProbe(
      'screenshot',
      [whatsappBlock],
      { ok: true, urls: ['https://google.com/'], browsers: ['Brave Browser'] }
    );
    assert.equal(d.state, 'allow');
  });

  it('returns unknown (fail-closed) when URL rules exist and probe fails', () => {
    const d = decideFromProbe('screenshot', [whatsappBlock], {
      ok: false,
      reason: 'automation_permission',
    });
    assert.equal(d.state, 'unknown');
    if (d.state === 'unknown') assert.equal(d.reason, 'automation_permission');
    assert.equal(isCaptureBlocked(d), true);
  });

  it('returns unknown on unsupported platform reason', () => {
    const d = decideFromProbe('liveView', [whatsappBlock], {
      ok: false,
      reason: 'url_probe_unsupported_platform',
    });
    assert.equal(d.state, 'unknown');
    assert.equal(isCaptureBlocked(d), true);
  });

  it('does not force-block when only app rules exist and probe is null', () => {
    const d = decideFromProbe('screenshot', [slackBlock], null, ['Slack', 'Channel']);
    assert.equal(d.state, 'block');
    if (d.state === 'block') assert.equal(d.matchedVia, 'slack');
  });

  it('allows app-only org when labels do not match even if probe is null', () => {
    const d = decideFromProbe('screenshot', [slackBlock], null, ['Finder']);
    assert.equal(d.state, 'allow');
  });

  it('respects purpose flags', () => {
    const liveOnly: CapturePrivacyBlock = {
      appPattern: 'web.whatsapp.com',
      blockScreenshots: false,
      blockLiveView: true,
    };
    const probe = {
      ok: true as const,
      urls: ['https://web.whatsapp.com/'],
      browsers: ['Brave Browser'],
    };
    assert.equal(decideFromProbe('screenshot', [liveOnly], probe).state, 'allow');
    assert.equal(decideFromProbe('liveView', [liveOnly], probe).state, 'block');
  });

  it('allowlist blocks sites not on the list', () => {
    const allowed: CapturePrivacyBlock = {
      appPattern: 'github.com',
      blockScreenshots: true,
      blockLiveView: true,
    };
    const d = decideFromProbe(
      'screenshot',
      [allowed],
      { ok: true, urls: ['https://web.whatsapp.com/'], browsers: ['Brave Browser'] },
      [],
      'allowlist'
    );
    assert.equal(d.state, 'block');
    if (d.state === 'block') assert.equal(d.pattern, '(not on allowlist)');
  });

  it('allowlist allows listed host', () => {
    const allowed: CapturePrivacyBlock = {
      appPattern: 'github.com',
      blockScreenshots: true,
      blockLiveView: true,
    };
    const d = decideFromProbe(
      'liveView',
      [allowed],
      { ok: true, urls: ['https://github.com/org/repo'], browsers: ['Brave Browser'] },
      [],
      'allowlist'
    );
    assert.equal(d.state, 'allow');
  });

  it('allowlist with empty list blocks any website', () => {
    const d = decideFromProbe(
      'screenshot',
      [],
      { ok: true, urls: ['https://google.com/'], browsers: ['Brave Browser'] },
      [],
      'allowlist'
    );
    assert.equal(d.state, 'block');
  });

  it('allowlist allows when no browser URLs (desktop app)', () => {
    const d = decideFromProbe(
      'screenshot',
      [{ appPattern: 'github.com', blockScreenshots: true, blockLiveView: true }],
      { ok: true, urls: [], browsers: [] },
      [],
      'allowlist'
    );
    assert.equal(d.state, 'allow');
  });
});

describe('classifyProbeError', () => {
  it('detects automation permission', () => {
    assert.equal(
      classifyProbeError(new Error('Not authorized to send Apple events (-1743)')),
      'automation_permission'
    );
  });

  it('detects timeout', () => {
    const err = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
    assert.equal(classifyProbeError(err), 'automation_timeout');
  });
});

describe('normalize', () => {
  it('lowercases and strips bidi marks', () => {
    assert.equal(normalize('  Foo\u200E '), 'foo');
  });
});

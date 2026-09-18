// Activity Classification System for TeamTracker Desktop
// Types, identical constants and utility functions are imported from the
// canonical shared dist.  Desktop-specific overrides (thresholds, rules and
// the classifyActivity implementation) live below the import block.
//
// NOTE: imports resolve via .js → sibling .d.ts (type-only, no rootDir issue)
//       and via .js → sibling .js at tsx/Node runtime.

// ---------------------------------------------------------------------------
// Re-import shared items from canonical dist — then re-export unchanged ones
// ---------------------------------------------------------------------------
import type {
  ActivityCategory,
  ActivityClassification,
  ProductivityLevel,
  SuspiciousPattern,
} from '../../shared/dist/classification.js';

import {
  PRODUCTIVITY_SCORES,
  CATEGORY_NAMES,
  PRODUCTIVITY_LEVELS,
  calculateTrueProductivity,
  detectGamingAttempts,
  generateDailySummary,
} from '../../shared/dist/classification.js';

export type { ActivityCategory, ActivityClassification, ProductivityLevel, SuspiciousPattern };
export { PRODUCTIVITY_SCORES, CATEGORY_NAMES, PRODUCTIVITY_LEVELS, calculateTrueProductivity, detectGamingAttempts, generateDailySummary };

// ---------------------------------------------------------------------------
// Desktop-specific additions and overrides
// ---------------------------------------------------------------------------

// FIX: System processes that should NEVER be tracked as suspicious
export const SYSTEM_PROCESSES_TO_IGNORE = [
  'loginwindow', 'window server', 'kernel', 'system', 'login window',
  'screen saver', 'screensaver', 'lockscreen', 'lock screen',
  'securityagent', 'authorizationhost'
];

// Universal app classification - works for ANY employee type
interface AppRule {
  patterns: string[];
  category: ActivityCategory;
  exceptions?: string[];
}

export const APP_CLASSIFICATION_RULES: AppRule[] = [
  // System/Break - Always mark as idle, never suspicious
  {
    patterns: [
      'loginwindow', 'window server', 'kernel', 'system', 'login window',
      'screen saver', 'screensaver', 'lockscreen', 'lock screen',
      'securityagent', 'authorizationhost'
    ],
    category: 'break_idle'
  },
  // Core Work Tools
  {
    patterns: [
      'microsoft excel', 'excel', 'google sheets', 'spreadsheet',
      'microsoft word', 'word', 'google docs',
      'microsoft powerpoint', 'powerpoint', 'google slides',
      'pdf', 'acrobat', 'preview - pdf',
      'autocad', 'cad', 'revit', 'sketchup', 'solidworks', 'catia',
      'figma', 'sketch', 'adobe illustrator', 'adobe photoshop', 'photoshop',
      'vscode', 'visual studio code', 'code -', 'cursor', 'intellij',
      'machinery', 'cnc', 'scada', 'plc', 'hmi',
      'quickbooks', 'sap', 'oracle', 'salesforce',
      'epic', 'cerner', 'allscripts',
    ],
    category: 'core_work'
  },
  // Communication
  {
    patterns: ['slack', 'microsoft teams', 'teams -', 'zoom', 'google meet', 'webex', 'skype', 'discord', 'telegram', 'whatsapp'],
    category: 'communication'
  },
  // Email
  {
    patterns: ['outlook', 'gmail', 'mail', 'thunderbird', 'apple mail'],
    category: 'communication'
  },
  // Research & Learning
  {
    patterns: [
      'stackoverflow', 'github', 'gitlab', 'documentation', 'docs.',
      'wikipedia', 'wikis', 'confluence', 'notion', 'obsidian',
      'udemy', 'coursera', 'linkedin learning', 'pluralsight',
    ],
    category: 'research_learning',
    exceptions: ['facebook', 'instagram', 'twitter', 'reddit']
  },
  // OpenClaw - Core Work
  {
    patterns: [
      'openclaw', 'claw', 'mohltbot', 'mission-control', 'teamtracker', 'arch-track',
    ],
    category: 'core_work'
  },
  // Planning & Documentation
  {
    patterns: [
      'jira', 'asana', 'trello', 'monday.com', 'clickup', 'notion',
      'microsoft project', 'smartsheet', 'airtable',
    ],
    category: 'planning_docs'
  },
  // Entertainment
  {
    patterns: [
      'youtube', 'netflix', 'hulu', 'disney+', 'amazon prime video',
      'spotify', 'apple music', 'pandora', 'tidal',
      'twitch', 'tiktok',
    ],
    category: 'entertainment',
    exceptions: ['tutorial', 'course', 'lecture', 'how to', 'documentation', 'workshop', 'training']
  },
  // Social Media (desktop includes x.com — shared removed it after a false-positive incident)
  {
    patterns: [
      'facebook', 'instagram', 'twitter', 'x.com', 'linkedin', 'reddit',
      'pinterest', 'snapchat', 'tumblr',
    ],
    category: 'social_media'
  },
  // Shopping/Personal
  {
    patterns: [
      'amazon', 'ebay', 'etsy', 'walmart', 'target', 'best buy',
      'bank', 'credit card', 'paypal', 'venmo',
    ],
    category: 'shopping_personal'
  },
  // System apps (neutral)
  {
    patterns: [
      'finder', 'explorer', 'desktop', 'system preferences', 'settings',
      'new tab', 'google search',
    ],
    category: 'other'
  }
];

// Desktop-specific thresholds — more lenient than shared to avoid false
// positives on a developer/writer's focused session.
export const SUSPICIOUS_THRESHOLDS = {
  videoIdleMinutes: 15,
  communicationGhostMinutes: 10,
  rapidSwitchSeconds: 3,
  idleThresholdMinutes: 15,  // shared uses 5 min; desktop uses 15 min (focused work)
  sameWindowMinutes: 60,     // shared uses 30 min; desktop uses 60 min (reading docs)
};

// Main classification function — desktop variant with system-process guard
export function classifyActivity(
  appName: string,
  windowTitle: string,
  context?: {
    durationMinutes?: number;
    hasInputActivity?: boolean;
    windowChangeCount?: number;
    lastInputMinutesAgo?: number;
    isVideoPlaying?: boolean;
    isFullscreen?: boolean;
  }
): ActivityClassification {
  const appLower = appName.toLowerCase();
  const titleLower = windowTitle.toLowerCase();

  let category: ActivityCategory = 'other';
  let isIdle = false;

  // Never track system idle states as suspicious
  const systemIdleApps = ['idle', 'loginwindow', 'lockscreen', 'screensaver', 'window server'];
  const isSystemIdle = systemIdleApps.some(app => appLower.includes(app) || titleLower.includes(app));

  if (isSystemIdle) {
    return {
      category: 'break_idle',
      categoryName: CATEGORY_NAMES['break_idle'],
      productivityScore: 0,
      productivityLevel: 'idle',
      isSuspicious: false,
      suspiciousReason: undefined,
      isIdle: true
    };
  }

  // Browser: check window title for work indicators first
  const browserApps = ['chrome', 'safari', 'firefox', 'edge', 'brave', 'opera'];
  const isBrowser = browserApps.some(b => appLower.includes(b));

  if (isBrowser) {
    const workIndicators = [
      'openclaw', 'mission-control', 'debug', 'debugger', 'codex',
      'github', 'gitlab', 'bitbucket', 'stackoverflow',
      'docker', 'kubernetes', 'terminal', 'console',
      'api', 'endpoint', 'webhook', 'integration',
      'architecture', 'system design', 'workflow', 'automation',
      'vscode', 'cursor', 'intellij', 'sublime', 'atom',
      'pull request', 'issues', 'bug', 'fix', 'deploy', 'build'
    ];
    if (workIndicators.some(i => titleLower.includes(i))) {
      category = 'core_work';
    } else {
      const researchIndicators = [
        'documentation', 'docs.', 'readme', 'tutorial', 'how to',
        'wikipedia', 'confluence', 'notion', 'obsidian',
        'stackoverflow', 'github.com', 'gitlab.com'
      ];
      if (researchIndicators.some(i => titleLower.includes(i))) {
        category = 'research_learning';
      }
    }
  }

  if (category === 'other') {
    for (const rule of APP_CLASSIFICATION_RULES) {
      const matchesPattern = rule.patterns.some(p => appLower.includes(p) || titleLower.includes(p));
      if (matchesPattern) {
        if (rule.exceptions) {
          const hasException = rule.exceptions.some(ex => titleLower.includes(ex));
          if (hasException) {
            if (rule.category === 'entertainment') category = 'research_learning';
            continue;
          }
        }
        category = rule.category;
        break;
      }
    }
  }

  let isSuspicious = false;
  let suspiciousReason: string | undefined;

  const isSystemProcess = SYSTEM_PROCESSES_TO_IGNORE.some(proc =>
    appLower.includes(proc) || titleLower.includes(proc)
  );

  if (context && !isSystemProcess) {
    if (category === 'entertainment' && context.isVideoPlaying) {
      if (!context.hasInputActivity || (context.lastInputMinutesAgo && context.lastInputMinutesAgo > 5)) {
        isSuspicious = true;
        suspiciousReason = `Video playing (${appName}) with no interaction for ${context.lastInputMinutesAgo ?? 'unknown'} min`;
        category = 'break_idle';
        isIdle = true;
      }
    }

    if (category === 'communication') {
      const noInput = !context.hasInputActivity || (context.lastInputMinutesAgo && context.lastInputMinutesAgo > SUSPICIOUS_THRESHOLDS.communicationGhostMinutes);
      const longDuration = context.durationMinutes && context.durationMinutes > SUSPICIOUS_THRESHOLDS.communicationGhostMinutes;
      if (noInput && longDuration) {
        isSuspicious = true;
        suspiciousReason = `${appName} "active" but no input for ${context.lastInputMinutesAgo ?? context.durationMinutes} min - ghost presence`;
        category = 'break_idle';
        isIdle = true;
      }
    }

    if (context.lastInputMinutesAgo && context.lastInputMinutesAgo > SUSPICIOUS_THRESHOLDS.idleThresholdMinutes) {
      if (!isSuspicious) {
        isSuspicious = true;
        suspiciousReason = `No input activity for ${context.lastInputMinutesAgo} min - likely away from desk`;
        category = 'break_idle';
        isIdle = true;
      }
    }

    if (context.durationMinutes && context.durationMinutes > SUSPICIOUS_THRESHOLDS.sameWindowMinutes) {
      if (!context.hasInputActivity && !isSuspicious) {
        isSuspicious = true;
        suspiciousReason = `Same window (${appName}) for ${context.durationMinutes} min with no interaction`;
        category = 'break_idle';
        isIdle = true;
      }
    }

    if (context.windowChangeCount && context.durationMinutes) {
      const switchesPerMinute = context.windowChangeCount / context.durationMinutes;
      if (switchesPerMinute > 10) {
        isSuspicious = true;
        suspiciousReason = `Rapid window switching (${switchesPerMinute.toFixed(1)}/min) - distracted`;
      }
    }
  }

  return {
    category,
    categoryName: CATEGORY_NAMES[category],
    productivityScore: isIdle ? 0 : PRODUCTIVITY_SCORES[category],
    productivityLevel: isIdle ? 'idle' : PRODUCTIVITY_LEVELS[category],
    isSuspicious,
    suspiciousReason,
    isIdle
  };
}

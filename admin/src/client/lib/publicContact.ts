/** Public contact + registration helpers for marketing / auth screens. */

export type RegistrationPolicy = {
  allowed: boolean;
  bootstrap: boolean;
  reason: string | null;
  contactEmail: string | null;
  contactUrl: string | null;
};

/** Hardcoded sales contact (landing + closed signup). */
const HARDCODED_CONTACT_EMAIL = 'mohameddhamdy407@gmail.com';
const HARDCODED_CONTACT_URL = 'https://wa.me/201278859768';

export function clientContactEmail(): string {
  return HARDCODED_CONTACT_EMAIL;
}

export function clientContactUrl(): string {
  return HARDCODED_CONTACT_URL;
}

/** Prefer mailto when an email is configured; otherwise open contact URL. */
export function contactHref(email?: string | null, url?: string | null): string {
  const mail = (email || clientContactEmail()).trim();
  if (mail) {
    return `mailto:${mail}?subject=${encodeURIComponent('TeamTracker — access request')}`;
  }
  return (url || clientContactUrl()).trim() || HARDCODED_CONTACT_URL;
}

export async function fetchRegistrationPolicy(): Promise<RegistrationPolicy> {
  try {
    const res = await fetch('/api/auth/registration-policy', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('policy_http');
    const json = await res.json();
    const data = json.data || json;
    return {
      allowed: !!data.allowed,
      bootstrap: !!data.bootstrap,
      reason: data.reason || null,
      contactEmail: data.contactEmail || clientContactEmail(),
      contactUrl: data.contactUrl || clientContactUrl(),
    };
  } catch {
    return {
      allowed: false,
      bootstrap: false,
      reason: null,
      contactEmail: clientContactEmail(),
      contactUrl: clientContactUrl(),
    };
  }
}

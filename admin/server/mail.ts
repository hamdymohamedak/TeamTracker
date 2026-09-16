/**
 * Optional email helpers. Core TeamTracker works without email configured.
 */

import { logger } from './logger.js';

export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
  name?: string
): Promise<boolean> {
  const subject = 'TeamTracker password reset';
  const text = `Hi ${name || 'there'},\n\nReset your password using this link (expires in 1 hour):\n${resetUrl}\n\nIf you did not request this, ignore this email.\n`;
  const html = `<p>Hi ${name || 'there'},</p><p><a href="${resetUrl}">Reset your password</a> (expires in 1 hour).</p><p>If you did not request this, ignore this email.</p>`;
  return sendMail({ to, subject, text, html });
}

export async function sendInviteEmail(
  to: string,
  inviteUrl: string,
  orgName: string,
  inviterName?: string
): Promise<boolean> {
  const subject = `You're invited to ${orgName} on TeamTracker`;
  const text = `${inviterName || 'An admin'} invited you to join ${orgName} on TeamTracker.\n\nAccept: ${inviteUrl}\n\nThis link expires in 7 days.\n`;
  const html = `<p>${inviterName || 'An admin'} invited you to <strong>${orgName}</strong> on TeamTracker.</p><p><a href="${inviteUrl}">Accept invitation</a> (expires in 7 days).</p>`;
  return sendMail({ to, subject, text, html });
}

async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<boolean> {
  const resendKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM || process.env.RESEND_FROM || 'TeamTracker <onboarding@resend.dev>';

  if (resendKey) {
    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: opts.to,
          subject: opts.subject,
          text: opts.text,
          html: opts.html,
        }),
      });
      if (!resp.ok) {
        logger.warn('Resend send failed', { status: resp.status });
        return false;
      }
      return true;
    } catch (e) {
      logger.warn('Resend send error', { error: String(e) });
      return false;
    }
  }

  if (process.env.SMTP_HOST) {
    try {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === '1',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      });
      await transporter.sendMail({
        from,
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
      });
      return true;
    } catch (e) {
      logger.warn('SMTP send error', { error: String(e) });
      return false;
    }
  }

  return false;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() || process.env.SMTP_HOST);
}

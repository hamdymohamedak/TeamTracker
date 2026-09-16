# TeamTracker Privacy Policy

**Last updated:** September 16, 2026

**Privacy Policy URL:**  
https://github.com/hamdymohamedak/TeamTracker/blob/main/PRIVACY_POLICY.md

This Privacy Policy explains how TeamTracker (“we”, “the software”, or “the project”) handles information when you use the TeamTracker admin dashboard and desktop tracker applications.

TeamTracker is primarily designed for **self-hosted** deployments. The organization that installs and operates TeamTracker (the “Operator”) controls the server, database, and collected workplace data. This policy describes the software’s intended behavior; Operators are responsible for their own legal notices, employee consent, and compliance with applicable laws.

This document is **not legal advice**.

---

## 1. Who this applies to

- **Operators** — people or companies who deploy TeamTracker on their own servers
- **Administrators** — users of the admin dashboard for an organization
- **Employees / tracked users** — people whose devices run the TeamTracker desktop tracker enrolled to an organization

---

## 2. Information the software can collect

Depending on how an Operator configures TeamTracker, the desktop tracker and server may process:

| Category | Examples |
|----------|----------|
| Account data | Admin name, email, password (hashed), recovery codes, organization name |
| Employee records | Name, email, department, job role, hourly rate, working hours |
| Device enrollment | Setup tokens, device tokens used to authenticate the tracker |
| Activity data | Foreground application name, window title, timestamps, productivity/category scores |
| Screenshots | Periodic images of the display when the Operator enables screenshots |
| Live view | Short-lived screen frames when an admin starts a live session |
| Settings | Organization preferences (e.g. screenshot enablement, retention, privacy blocks) |

Optional features may send limited data to third-party services **only when configured by the Operator** (for example email delivery or an AI assistant API). Core tracking does not require a third-party analytics cloud.

---

## 3. How information is used

Collected data is intended to help organizations:

- Understand work activity and productivity trends
- Review reports, summaries, and (if enabled) screenshots
- Manage employees, devices, and organization settings
- Operate optional features such as email or AI assistance

TeamTracker’s open-source maintainers do **not** automatically receive your self-hosted instance data. Data stays on the Operator’s infrastructure unless the Operator configures outbound integrations.

---

## 4. Screenshots and sensitive content

Screenshots are **off by default** at the organization level until an administrator enables them. When enabled, captures may include anything visible on screen (documents, messages, personal browsing).

Administrators can configure **privacy blocks** (patterns matching app names or window titles) to suppress screenshots and/or live-view frames for matching windows. Privacy blocks reduce risk but do not guarantee that sensitive text never appears in window titles, activity logs, or residual captures.

---

## 5. Stealth / background operation

The desktop tracker may run with limited or no visible UI (including “stealth” configurations). This does not remove an Operator’s duty to disclose workplace monitoring where required by law, and it does not bypass operating-system permission prompts (for example macOS Screen Recording or Accessibility).

---

## 6. Where data is stored (self-hosted)

On a typical self-hosted deployment, data lives on the Operator’s server, for example:

- SQLite database (accounts, employees, activity, settings)
- Upload directory (logos, screenshots)
- Backup directory (database snapshots)
- Environment configuration (secrets such as JWT keys)

Operators (and anyone with server or filesystem access) can access this data. Multi-tenant deployments are designed to isolate organization data in the application schema; the host Operator still controls the underlying machine.

---

## 7. Retention and deletion

Retention depends on Operator configuration and tools, including:

- Organization screenshot retention settings / environment variables
- Database backup retention
- Manual deletion of screenshots, employees, or files by administrators or Operators

There is no automatic guarantee of complete erasure across backups, logs, or database recovery files. Operators should include backups when fulfilling deletion or access requests under applicable law.

---

## 8. Sharing and third parties

The software does not sell personal data.

Data may be shared or transmitted when:

- An Operator’s administrators access it through the dashboard
- An enrolled device uploads activity or screenshots to the Operator’s server
- The Operator enables optional integrations (email provider, LLM provider, etc.)
- Required by law or necessary to protect the Operator’s rights and security

---

## 9. Security

Operators should protect servers, credentials, TLS, backups, and access controls. TeamTracker provides authentication and access controls in the application, but security of a deployment depends primarily on how it is hosted and administered.

---

## 10. Children’s privacy

TeamTracker is intended for workplace / business use by adults. It is not directed at children.

---

## 11. International and employment law

Workplace monitoring laws vary by country and region. Operators must ensure lawful notice, consent, works-council consultation, data-protection obligations, and cross-border transfer rules as applicable. The software provides technical controls; it does not certify legal compliance.

For additional product-oriented detail, see [docs/PRIVACY.md](./docs/PRIVACY.md).

---

## 12. Open-source project contact

- **Source repository:** https://github.com/hamdymohamedak/TeamTracker
- **Issues:** https://github.com/hamdymohamedak/TeamTracker/issues

For questions about data on a specific deployment, contact that organization’s administrator or Operator—not the open-source repository—unless your question is about the software itself.

---

## 13. Changes to this policy

We may update this Privacy Policy by changing this file in the repository. The “Last updated” date at the top will be revised when material changes are made. Continued use of updated software after publication constitutes notice of the revised policy for the open-source project; Operators should update their own employee-facing notices as needed.

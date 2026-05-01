# Project Phoenix

> exported from Notion 2026-04-29

[Cover image](https://example.com/x.png)

Built by: Sam, Priya
Status: 🟡 In review
Last updated: April 29, 2026

# # # let's gooo 🚀

OK so basically we want to ship a thing. The thing is a small SaaS that helps freelancers bill clients. We've been brainstorming for two weeks. The team is Sam (backend) and Priya (frontend).

## what we're building, sort of

Freelancers waste 4-6 hours/month on invoicing. Existing tools (Bonsai, FreshBooks) are heavy and expensive. We want lightweight, self-hostable, with a small monthly fee. MVP scope:

- create clients
- track time per client
- generate invoice (PDF)
- mark paid / unpaid
- email reminders

## stuff we definitely don't want

no payroll. no expense tracking. no team accounts (single-user only for v1). no mobile app for v1 — responsive web is enough.

## tech ideas (still arguing)

We were torn between:
- Laravel + Filament v3 for the admin panel (Sam's preference)
- NestJS + a custom admin (Priya's preference)

Sam won. So: Laravel 11 + Filament v3 + Tailwind + PostgreSQL + Redis for queues. Self-host on a small DigitalOcean box for v1, maybe Render later.

## who uses it

Solo freelancers. Indie consultants. Small one-person agencies. People who currently invoice via Word + Stripe links and want something a little less embarrassing.

## what success looks like

Probably:
- 50 paid users in the first 3 months
- Invoice PDF gen takes < 2s
- Monthly recurring cost < $30 (so we can charge $9/mo and still have margin)

## things to be careful about

- GDPR — EU customers expected
- Stripe webhooks need idempotency
- PDF generation has historically been a memory hog; cap worker memory to 256MB

## random links

- [Stripe webhook docs](https://stripe.com/docs/webhooks)
- [Filament tables](https://filamentphp.com/docs/3.x/tables)
- [Notion page on competitor analysis](https://notion.so/...)

ok thats it for now.

# Static Invoice and Payment Page

A lightweight, serverless invoice payment page designed for free hosting on GitHub Pages. It displays payment details (PayPal, ACH bank via a Payoneer receiving account) with one-click copy functionality and supports dynamic invoice generation using URL parameters.

## Features

- **Dynamic invoicing** – customize client name, invoice number, line items, and total amount through URL parameters.
- **One-click copy** – copy buttons on every payment field so clients can transfer without retyping.
- **URL generator included** – `admin.html` builds formatted invoice links visually.
- **Free hosting** – plain HTML/CSS/JS, no build step, works on GitHub Pages.
- **Print / Save as PDF** – print-friendly layout.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The invoice + payment page clients see |
| `admin.html` | Link generator |
| `config.js` | **Your** business and payment details (edit this) |
| `invoice.js` | Shared helpers |
| `style.css` | Styles |

## Setup

1. Edit `config.js` with your real PayPal email and the US ACH details from your Payoneer receiving account (Payoneer → Receive → Receiving accounts). Set `enabled: false` on any method you don't want to show.
2. Push to GitHub, then go to **Settings → Pages**, choose **Deploy from a branch**, select `main` / root, and save.
3. Your site will be at `https://<username>.github.io/<repo>/`.

> Payment details are read only from `config.js`, never from the URL, so nobody can craft a link on your domain that shows a different account.

## Generator page

Open `admin.html` to build shareable links without typing URL parameters manually. Fill in the form fields and click **Generate Link** to get a ready-to-send invoice URL.

## URL parameters

| Param | Example | Notes |
| --- | --- | --- |
| `inv` | `INV-001` | Invoice number; also used as the payment reference |
| `client` | `Acme Corp` | Bill-to name |
| `client_email` | `billing@acme.com` | Optional |
| `date` | `2026-10-01` | Invoice date (YYYY-MM-DD) |
| `due` | `2026-10-15` | Due date (YYYY-MM-DD) |
| `cur` | `USD` | ISO currency code; defaults to `config.js` |
| `items` | `[["Design",1,500],["Hosting",12,10]]` | JSON array of `[description, qty, unit price]` (URL-encoded) |
| `total` | `620` | Optional; overrides the total calculated from items |
| `notes` | `Thanks!` | Optional note shown on the invoice |

Example:

```
index.html?inv=INV-001&client=Acme%20Corp&due=2026-10-15&items=%5B%5B%22Design%22%2C1%2C500%5D%5D
```

## Privacy note

GitHub Pages sites are public, and `config.js` (including your account numbers) is visible to anyone who opens the site or the repository. The page sets `noindex`, but that only keeps it out of search engines. Only share details here that you would normally put on an invoice. You can keep the repository private and still publish Pages on paid GitHub plans.

Run locally by opening `index.html` directly, or with `python -m http.server`.

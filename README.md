# Weekly Invoice and Payment Page

A lightweight invoice page for weekly billing, hosted for free on GitHub Pages, with a free Google Apps Script backend.

- **Admin page** (`admin.html`, protected by a secret key): write up the week's work, choose **PayPal only**, **ACH (Payoneer receiving account) only**, or **split across both**, and generate a link.
- **Invoice page** (`index.html#<id>`): the client sees the work summary and only the payment method(s) on that invoice, with one-click copy buttons. They confirm each payment with an **"I've sent this payment"** button.
- **Notifications:** you get an email (and optionally a phone push via [ntfy](https://ntfy.sh)) every time the client confirms a payment.
- **Link control:** reset payments to unpaid, disable or re-enable a link, issue a new link (the old one stops working), or delete the invoice.
- **Download PDF:** the client can save a clean PDF that contains only the invoice: work, amounts and payment details, with no buttons and no browser header or footer.
- **Next week:** copy an invoice forward one week, with the invoice number incremented.

Links are random 24-character IDs, so they contain no invoice data. Your payment details are stored in the backend, not in this public repository.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Invoice page the client sees |
| `admin.html` | Create and manage invoices, edit payment details |
| `backend/Code.gs` | Google Apps Script backend (paste into Apps Script) |
| `config.js` | The backend URL |
| `invoice.js`, `style.css` | Shared helpers and styles |

## Setup

### 1. Backend (Google Apps Script, about 5 minutes)

1. Create a new Google Sheet, e.g. "Invoices". It stores your invoices.
2. In the sheet, open **Extensions → Apps Script**. Delete the sample code, paste in all of `backend/Code.gs`, and save.
3. Pick **`setup`** in the function dropdown and click **Run**. Approve the permissions; Google will warn that the app isn't verified, because you wrote it yourself, so choose **Advanced → Go to project**.
4. Open **Execution log** and copy the **Admin key**. You'll use it to sign in to `admin.html`. Keep it private.
5. Click **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Click **Deploy** and copy the **Web app URL** (ends in `/exec`).

> If you change `Code.gs` later, use **Deploy → Manage deployments → Edit → New version**. That keeps the same URL.

### 2. Frontend

1. Paste the Web app URL into `config.js`:
   ```js
   window.INVOICE_CONFIG = { apiUrl: "https://script.google.com/macros/s/XXXX/exec" };
   ```
2. Commit and push, then enable **Settings → Pages → Deploy from a branch → `main` / root**.
3. Open `https://<username>.github.io/<repo>/admin.html`, sign in with the admin key, and fill in **Payment settings**: your name, PayPal email, and the US ACH details from Payoneer (**Receive → Receiving accounts**).

## Weekly use

1. **New invoice:** invoice number, client, week dates, what you did, payment type and amount(s). Click **Generate Link** and send the link to the client.
2. The client pays and clicks **I've sent this … payment**. With a split invoice they confirm each transfer separately, and you get an email for each one.
3. **Invoices** tab: check status (Unpaid, Partly paid, Paid, Link disabled), and use **Next week** to start the following invoice.

Client confirmations are only what the client reports. Always check PayPal or Payoneer to make sure the money has actually arrived.

## Phone push notifications (optional)

Install the ntfy app, subscribe to a hard-to-guess topic name (e.g. `invoices-k38fj2x9`), and put the same name in **Payment settings → ntfy.sh topic**. Anyone who knows the topic name can read the notifications, so make it unguessable.

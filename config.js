// Your business and payment details. Edit this file once; every invoice link uses it.
// Payment details live here (not in the URL) so a crafted link can't swap in someone else's account.
window.INVOICE_CONFIG = {
  business: {
    name: "David Lee",
    email: "180researchinc@gmail.com",
    address: "",
  },

  defaultCurrency: "USD",

  paypal: {
    enabled: true,
    email: "your-paypal@example.com",
    // Optional: e.g. "https://paypal.me/yourname". The amount is appended automatically.
    meLink: "",
  },

  // US ACH details from your Payoneer receiving account (Payoneer > Receive > Receiving accounts).
  ach: {
    enabled: true,
    accountHolder: "David Lee",
    bankName: "Your Payoneer partner bank",
    routingNumber: "000000000",
    accountNumber: "0000000000",
    accountType: "Checking",
    bankAddress: "",
  },
};

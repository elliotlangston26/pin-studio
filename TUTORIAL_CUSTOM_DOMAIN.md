# Tutorial: Deploying Pin Studio to a Custom Domain

Connect your registered domain (e.g. `pinstudio.com`) to your DigitalOcean App Platform deployment, with HTTPS provisioned automatically.

**Time required:** ~20–30 minutes (plus up to 48 hours for DNS to propagate worldwide)
**Cost:** $10–20/year for the domain (varies by registrar and TLD)
**Prerequisite:** Your app must already be live on App Platform — see [DEPLOY_DIGITALOCEAN.md](DEPLOY_DIGITALOCEAN.md)

---

## Overview

```
User types pinstudio.com
      ↓
DNS (at your registrar) → points to DigitalOcean App Platform
      ↓
App Platform → serves Pin Studio + handles HTTPS automatically
```

You don't need to manage certificates or web servers — DigitalOcean handles all of that.

---

## Part 1 — Register a Domain (if you don't have one yet)

If you already own a domain, skip to Part 2.

### Recommended registrars

| Registrar | Notes |
|---|---|
| **Namecheap** | Cheap `.com` renewals (~$10/yr), good UI |
| **Cloudflare Registrar** | At-cost pricing, excellent DNS tools |
| **Google Domains / Squarespace Domains** | Simple, but slightly pricier |
| **DigitalOcean Domains** | Free DNS management but you still buy the domain elsewhere |

### What to look for in a domain name

- Keep it short: `pinstudio.com`, `mypins.app`, `pinvault.io`
- `.com` is the most recognisable; `.app` and `.io` are popular for web apps
- Avoid hyphens if possible

### How to buy (example: Namecheap)

1. Go to [namecheap.com](https://www.namecheap.com)
2. Search for your domain name
3. Add it to cart and check out
4. After purchase, go to **Domain List** → your domain → **Manage**
5. You'll change DNS settings here in Part 3

---

## Part 2 — Add Your Domain in App Platform

1. Log in to [cloud.digitalocean.com](https://cloud.digitalocean.com)
2. Go to **App Platform** → click your Pin Studio app
3. Click the **Settings** tab
4. Scroll to **Domains** and click **Add Domain**
5. Enter your domain — type exactly: `pinstudio.com` (or whatever yours is)
6. Click **Add Domain**

DigitalOcean will show you one of two options:

**Option A — You use DigitalOcean's nameservers (recommended if you want DO to manage DNS):**
DigitalOcean gives you nameserver addresses like:
```
ns1.digitalocean.com
ns2.digitalocean.com
ns3.digitalocean.com
```
You'll point your registrar to these. DigitalOcean then handles your entire DNS zone.

**Option B — You keep your registrar's DNS and add a CNAME record:**
DigitalOcean gives you a CNAME target like:
```
pin-studio-abc12.ondigitalocean.app
```
You add this CNAME at your registrar. This is simpler but `@` (root domain) CNAMEs don't work everywhere — see the note in Part 3.

---

## Part 3 — Configure DNS

Choose the path that matches Option A or B from Part 2.

---

### Option A — Point nameservers to DigitalOcean (recommended)

This gives DigitalOcean full DNS control, which means automatic SSL and easy future changes.

#### Step 1: Set nameservers at your registrar

**Namecheap:**
1. Log in → **Domain List** → your domain → **Manage**
2. Under **Nameservers**, select **Custom DNS**
3. Enter all three DigitalOcean nameservers:
   - `ns1.digitalocean.com`
   - `ns2.digitalocean.com`
   - `ns3.digitalocean.com`
4. Click the green checkmark to save

**Google Domains / Squarespace:**
1. Go to your domain → **DNS** → **Custom name servers**
2. Enter the same three nameservers above

**Cloudflare Registrar:**
1. Domains → your domain → **Configuration** → **Nameservers**
2. Switch to **Custom nameservers** and enter the three DO nameservers

#### Step 2: Add the domain in DigitalOcean Networking

1. In DigitalOcean, go to **Networking** → **Domains**
2. Click **Add Domain** and enter your domain name
3. DigitalOcean creates the DNS zone. App Platform automatically adds the required A/CNAME records.

Wait 10–60 minutes for nameserver changes to take effect. You can check propagation at [dnschecker.org](https://dnschecker.org).

---

### Option B — Add a CNAME record at your registrar

Use this if you want to keep managing DNS at your registrar (e.g. you have email or other services set up there).

**Important limitation:** The root domain (`pinstudio.com` with no www) cannot technically use a CNAME record. You have two choices:
- Use `www.pinstudio.com` as your main URL and redirect the root
- Or use Option A above (DigitalOcean nameservers support ALIAS/ANAME at the root)

#### For `www.pinstudio.com`:

In your registrar's DNS settings, add:

| Type | Host | Value | TTL |
|---|---|---|---|
| CNAME | `www` | `pin-studio-abc12.ondigitalocean.app` | Automatic |

Then set up a redirect from `pinstudio.com` → `www.pinstudio.com` (most registrars offer this under "URL Redirect" or "Forwarding").

#### For root `pinstudio.com` (Cloudflare only):

Cloudflare supports a special CNAME flattening at the root. In Cloudflare DNS:

| Type | Name | Content | Proxy |
|---|---|---|---|
| CNAME | `@` | `pin-studio-abc12.ondigitalocean.app` | Proxied (orange cloud) |

---

## Part 4 — HTTPS / SSL Certificate

You don't need to do anything for this. DigitalOcean App Platform:

1. Detects your domain is pointing at it
2. Automatically requests a free **Let's Encrypt** certificate
3. Renews it automatically every 90 days

The status in App Platform → Settings → Domains will show:

- **Pending** — waiting for DNS to propagate
- **Active** — certificate issued, HTTPS is live

This typically completes within 5–30 minutes after DNS propagates.

---

## Part 5 — Verify everything works

1. Open `https://yourdomain.com` in a browser
2. Check the address bar shows the padlock (HTTPS)
3. Click **Add Pin Badge** and make sure the app works fully
4. Try uploading a photo — the upload should still go to Spaces

If you see a certificate warning instead of the padlock, DNS hasn't fully propagated yet — wait another 30–60 minutes and try again.

---

## Part 6 — Redirect www ↔ root (optional cleanup)

By default, only the domain you configured will work. If you want both `pinstudio.com` and `www.pinstudio.com` to reach your app:

1. In App Platform → Settings → Domains, click **Add Domain** again
2. Add the other version (e.g. if you added `pinstudio.com`, now add `www.pinstudio.com`)
3. App Platform provisions a second certificate and both work

Or set one as the **primary** and configure the other to redirect to it at the DNS level (cleaner for SEO).

---

## Troubleshooting

### Domain shows "This site can't be reached"

DNS hasn't propagated yet. Check at [dnschecker.org](https://dnschecker.org) — search for your domain and look for the green checkmarks to appear in most regions. It can take up to 48 hours in rare cases.

### App Platform shows domain as "Pending" for over an hour

DNS is not yet pointing to DigitalOcean. Double-check:
- Nameservers are set correctly at your registrar (Option A)
- Or the CNAME value matches exactly what DigitalOcean showed (Option B)

Use this command to check where your domain points:
```bash
dig yourdomain.com +short
```

### HTTPS works but images don't load

Your Spaces bucket is in a separate subdomain — images load from `pin-studio-images.nyc3.digitaloceanspaces.com` regardless of your custom domain. This is expected and correct.

### I want to use Cloudflare for DNS (extra performance + security)

You can use Cloudflare as your DNS provider even if your domain is registered elsewhere:

1. Sign up at [cloudflare.com](https://cloudflare.com) → **Add a site** → enter your domain
2. Cloudflare scans your existing DNS records
3. Cloudflare gives you two nameservers — set these at your registrar
4. In Cloudflare, add the CNAME record pointing to your App Platform URL
5. Keep the proxy status **DNS only** (grey cloud) — App Platform handles SSL, not Cloudflare

---

## Summary of DNS record types used

| Record | Used for | Example |
|---|---|---|
| `A` | Points domain to an IP address | `@` → `104.16.x.x` |
| `CNAME` | Points subdomain to another hostname | `www` → `pin-studio.ondigitalocean.app` |
| `NS` | Delegates DNS control to a provider | `@` → `ns1.digitalocean.com` |

For App Platform, DigitalOcean manages the A records for you once nameservers are delegated.

---

## After your domain is live

- Update any hardcoded `localhost` references in your code to use relative paths (you should already be using `/api/upload` etc., not full URLs)
- If you add the user system (see [TUTORIAL_USER_SYSTEM.md](TUTORIAL_USER_SYSTEM.md)), your JWT tokens will be scoped to `https://yourdomain.com` automatically — no extra config needed
- Set up email for your domain (e.g. Google Workspace or Zoho Mail) if you plan to send password reset emails to users

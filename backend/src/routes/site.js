// Public contact and policy pages, rendered on the server as plain HTML (no login, no JavaScript needed). The customer app
// (/user/, open to guests) shows the restaurants, menus and prices; these pages carry the address, phone, e-mail and policies.
import { Router } from 'express';

// business details shown on every page (must match the payment-gateway KYC)
export const BUSINESS = {
  name: 'Pakka Local',
  phone: '+91 89771 02457',
  phoneHref: '+918977102457',
  email: 'care@pakkalocal.online',
  address: '',      // full postal address with PIN code
  instagram: 'https://www.instagram.com/pakkalocalfooddelivery/',
};

const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const YEAR = () => new Date().getFullYear();

const NAV = [['/user/', 'Home'], ['/contact', 'Contact'], ['/user/', 'Order now']];
const POLICIES = [['/terms', 'Terms & conditions'], ['/privacy', 'Privacy policy'], ['/refund-policy', 'Refund & cancellation'], ['/delivery-policy', 'Delivery policy']];

function page({ title, desc, path, body }) {
  const b = BUSINESS;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(title)}</title><meta name="description" content="${e(desc)}"><link rel="canonical" href="https://pakkalocal.online${e(path)}">
<meta property="og:site_name" content="${e(b.name)}"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(desc)}"><meta property="og:image" content="https://pakkalocal.online/assets/icon-512.png">
<meta name="theme-color" content="#d4500f"><link rel="icon" type="image/png" href="/assets/icon-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/site/site.css"></head><body>
<header class="top"><div class="wrap"><a class="brand" href="/user/"><img src="/assets/logo.png" alt="" width="36" height="36"><b>${e(b.name)}</b></a>
<nav>${NAV.map(([h, t]) => `<a href="${h}"${h === '/user/' ? ' class="cta"' : ''}>${t}</a>`).join('')}</nav></div></header>
<main>${body}</main>
<footer class="foot"><div class="wrap cols">
<div><div class="brand"><img src="/assets/logo.png" alt="" width="32" height="32"><b>${e(b.name)}</b></div><p>Food delivery from local kitchens to your PG, hostel or college.</p></div>
<div><h4>Contact us</h4><address>${b.address ? `<span>${e(b.address)}</span>` : ''}
<span>Phone: <a href="tel:${b.phoneHref}">${e(b.phone)}</a></span><span>Email: <a href="mailto:${e(b.email)}">${e(b.email)}</a></span>
<span>Instagram: <a href="${e(b.instagram)}" rel="noopener noreferrer" target="_blank">@pakkalocalfooddelivery</a></span></address></div>
<div><h4>Policies</h4>${POLICIES.map(([h, t]) => `<a href="${h}">${t}</a>`).join('')}</div>
</div><p class="copy wrap">© ${YEAR()} ${e(b.name)}. All rights reserved.</p></footer></body></html>`;
}

const doc = (path, title, desc, html) => page({ title: `${title} – Pakka Local`, desc, path, body: `<article class="wrap doc"><h1>${title}</h1><p class="upd">Last updated: 26 November 2026</p>${html}</article>` });
const contactLines = () => `<ul class="contact">${BUSINESS.address ? `<li><b>Address</b>${e(BUSINESS.address)}</li>` : ''}<li><b>Phone</b><a href="tel:${BUSINESS.phoneHref}">${e(BUSINESS.phone)}</a></li><li><b>Email</b><a href="mailto:${e(BUSINESS.email)}">${e(BUSINESS.email)}</a></li></ul>`;

const PAGES = {
  '/contact': () => doc('/contact', 'Contact us', 'Contact Pakka Local: address, phone and email.', `<p>We’re happy to help with orders, payments, refunds and partnerships.</p>${contactLines()}
<p>Customers with an order can also use <b>Help &amp; support</b> in the app for the fastest answer.</p>`),
  '/terms': () => doc('/terms', 'Terms &amp; conditions', 'Terms and conditions for using Pakka Local.', `
<p>These terms apply when you use the ${e(BUSINESS.name)} website and app (pakkalocal.online). By placing an order you agree to them.</p>
<h2>Our service</h2><p>${e(BUSINESS.name)} lets you order food from partner restaurants (kitchens) near you and have it delivered by our delivery partners. The food is prepared by the restaurant.</p>
<h2>Accounts</h2><p>You sign in with your mobile number and a one-time code. Keep your phone secure; you are responsible for orders placed from your account.</p>
<h2>Prices and payment</h2><p>Dish prices are shown on the menu in Indian Rupees. Your bill shows the dish prices, the delivery charge (based on distance) and any discount before you pay. We accept online payment only (UPI, cards and other methods offered at checkout); cash on delivery is not available. An order is confirmed only after the payment succeeds.</p>
<h2>Delivery</h2><p>We deliver only inside our service area. Delivery times are estimates. See our <a href="/delivery-policy">Delivery policy</a>.</p>
<h2>Cancellations and refunds</h2><p>See our <a href="/refund-policy">Refund &amp; cancellation policy</a>.</p>
<h2>Your conduct</h2><p>Please give a correct address and phone number, be available to receive the order, and treat restaurant and delivery staff with respect. We may suspend accounts that misuse the service.</p>
<h2>Liability</h2><p>Restaurants are responsible for the food they prepare, including ingredients and allergens. If something is wrong with your order, contact us and we will help resolve it.</p>
<h2>Changes</h2><p>We may update these terms; the latest version is always on this page.</p>
<h2>Contact</h2>${contactLines()}`),
  '/privacy': () => doc('/privacy', 'Privacy policy', 'How Pakka Local collects and uses your information.', `
<p>This policy explains what information ${e(BUSINESS.name)} collects and how we use it.</p>
<h2>What we collect</h2><ul><li>Your name and mobile number (to sign you in and contact you about orders).</li><li>Delivery addresses and, if you allow it, your location (to deliver your order and calculate the delivery charge).</li><li>Order and payment status (we do not store your card or UPI PIN; payments are handled by the payment provider).</li><li>Messages you send to our support team.</li></ul>
<h2>How we use it</h2><p>To take and deliver your orders, share the needed details with the restaurant and delivery partner for your order, send order updates, process refunds, provide support and keep the service secure.</p>
<h2>Sharing</h2><p>We share only what is needed with the restaurant and delivery partner handling your order, and with service providers (payments, SMS, e-mail, hosting). We do not sell your personal information.</p>
<h2>Your choices</h2><p>You can update your name and addresses in the app, turn off promotional notifications, or ask us to delete your account by writing to <a href="mailto:${e(BUSINESS.email)}">${e(BUSINESS.email)}</a>.</p>
<h2>Security</h2><p>We use secure connections (HTTPS) and limit access to personal data to people who need it.</p>
<h2>Contact</h2>${contactLines()}`),
  '/refund-policy': () => doc('/refund-policy', 'Refund &amp; cancellation policy', 'Refund and cancellation policy of Pakka Local.', `
<h2>Cancellations</h2><p>Because restaurants start preparing food as soon as an order is paid, customers cannot cancel an order themselves. If you have a problem, contact us right away through Help &amp; support in the app, by phone or by e-mail, and we will review it.</p>
<p>An order may be cancelled by the restaurant (for example, if an item is unavailable) or by ${e(BUSINESS.name)} (for example, if it cannot be delivered).</p>
<h2>Refunds</h2><ul><li>If an order is rejected by the restaurant or cancelled by us, you get a <b>full refund</b> of the amount paid.</li><li>If a payment was taken but the order was not created, the full amount is refunded.</li><li>For missing, wrong or damaged items, contact us within 24 hours with your order number; after review we refund the affected amount.</li></ul>
<p>Refunds are sent to the UPI ID you give in the app or to the original payment method, usually within <b>5–7 working days</b> of approval.</p>
<h2>Contact</h2>${contactLines()}`),
  '/delivery-policy': () => doc('/delivery-policy', 'Delivery policy', 'Delivery area, charges and times of Pakka Local.', `
<h2>Where we deliver</h2><p>We deliver to PGs, hostels, colleges and homes inside our service area. If an address is outside it, the app tells you before you pay.</p>
<h2>Delivery charge</h2><p>The delivery charge depends on the distance between the restaurant and your address. It is shown in your bill before payment. Any discount or free-delivery offer is applied in the same bill.</p>
<h2>Delivery time</h2><p>The app shows an estimated delivery time for your order before you pay, and you can track the rider live. Times can be longer in bad weather or at peak hours.</p>
<h2>Receiving your order</h2><p>Please keep your phone reachable. The rider may ask for the delivery code shown in your app to hand over the order.</p>
<h2>Contact</h2>${contactLines()}`),
};

export function siteRoutes() {
  const r = Router();
  const send = (res, html) => res.set('Cache-Control', 'public, max-age=300').type('html').send(html);
  for (const [p, fn] of Object.entries(PAGES)) r.get(p, (req, res) => send(res, fn()));
  return r;
}

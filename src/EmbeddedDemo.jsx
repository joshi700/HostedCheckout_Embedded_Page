import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Storefront, { cartTotal, money } from './techgear/Storefront.jsx';
import { CheckoutLayout, Step, PayPanel, Busy, Alert, Receipt } from './techgear/Checkout.jsx';
import DevDrawer from './techgear/DevDrawer.jsx';
import { load, save, tracked, upsertCall } from './techgear/store.js';

// Hosted Checkout — Embedded demo in the TechGear storefront.
//
// Flow: the backend creates a checkout session for the cart (INITIATE_CHECKOUT),
// checkout.min.js renders the gateway's payment form inside the TechGear Payment
// step (Checkout.showEmbeddedPage), and after paying the gateway sends the shopper
// to /ReceiptPage with a resultIndicator. The payment succeeded only if that
// resultIndicator equals the successIndicator returned when the session was created.

const API_URL = (process.env.REACT_APP_API_BASE || 'https://hosted-checkout-embedded-page-backe.vercel.app').replace(/\/+$/, '') + '/';
const CHECKOUT_JS = 'https://mtf.gateway.mastercard.com/static/checkout/checkout.min.js';
const CURRENCY = 'USD';
const EMBED_TARGET = 'embed-target';

// sessionStorage keys — 3-D Secure and the return to /ReceiptPage reload the page.
const CART_KEY = 'tg.cart';
const ORDER_KEY = 'tg.order';   // snapshot of the order being paid
const CALLS_KEY = 'tg.calls';   // API log for the Developer view

const DEMO = {
  steps: ['Pick a product', 'Add it to your cart', 'Pay in the secure form at checkout'],
  hint: 'Test card 5123 4500 0000 0008 · 01/39 · CVV 100',
};
const CTA = { mark: '→', title: 'Proceed to Checkout', sub: 'Pay in a secure Mastercard form on this site' };

const FLOW = [
  { title: 'Create a checkout session', body: 'The merchant backend calls INITIATE_CHECKOUT with the order (items, amount, currency) and a returnUrl. The gateway returns a session id and a successIndicator.' },
  { title: 'Embed the payment form', body: "The browser loads checkout.min.js, calls Checkout.configure({ session }) and then Checkout.showEmbeddedPage('#embed-target'). The gateway's form appears inside the merchant's checkout page — the shopper never leaves the site." },
  { title: 'Shopper pays', body: 'The shopper picks a payment method and pays. Card payments may go through 3-D Secure; in MTF the ACS emulator appears instead of a real bank.' },
  { title: 'Return and verify', body: 'The gateway redirects to the returnUrl with a resultIndicator. The merchant compares it with the successIndicator: a match means the payment succeeded.' },
];

// Load checkout.min.js fresh for each attempt so a previous session's
// configuration can't linger in window.Checkout.
function loadCheckoutJs() {
  return new Promise((resolve, reject) => {
    document.querySelectorAll(`script[src="${CHECKOUT_JS}"]`).forEach((s) => s.remove());
    delete window.Checkout;
    const s = document.createElement('script');
    s.src = CHECKOUT_JS;
    s.async = true;
    s.onload = () => (window.Checkout ? resolve() : reject(new Error('Checkout not defined after loading checkout.min.js')));
    s.onerror = () => reject(new Error('Could not load checkout.min.js'));
    document.head.appendChild(s);
  });
}

export default function EmbeddedDemo() {
  const location = useLocation();
  const navigate = useNavigate();
  const onReceipt = location.pathname.toLowerCase() === '/receiptpage';

  const [view, setView] = useState({ page: 'home' });
  const [cart, setCart] = useState(() => load(CART_KEY, []));
  const [order, setOrder] = useState(() => load(ORDER_KEY, null));
  const [calls, setCalls] = useState(() => load(CALLS_KEY, []));
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [embedded, setEmbedded] = useState(false);  // gateway form is showing
  const [devOpen, setDevOpen] = useState(false);

  useEffect(() => save(CART_KEY, cart), [cart]);
  useEffect(() => save(CALLS_KEY, calls), [calls]);

  const record = (call) => setCalls((c) => upsertCall(c, call));

  // Once the target div is on screen, hand it to the gateway.
  useEffect(() => {
    if (!embedded || !window.Checkout) return;
    window.Checkout.showEmbeddedPage(`#${EMBED_TARGET}`);
    record({ id: `js-embed-${Date.now()}`, method: 'JS', url: 'checkout.min.js', label: `Checkout.showEmbeddedPage('#${EMBED_TARGET}')`, request: { target: `#${EMBED_TARGET}` }, status: 200, response: { rendered: 'gateway payment form inside the Payment step' } });
    setBusy(null);
  }, [embedded]);  // eslint-disable-line react-hooks/exhaustive-deps

  function go(next) {
    if (onReceipt) navigate('/');
    setError(null);
    setBusy(null);
    setEmbedded(false);
    setView(next);
    window.scrollTo({ top: 0 });
  }

  function startCheckout() {
    const lines = cart.map((l) => ({ ...l }));
    setOrder({ lines, amount: cartTotal(cart).toFixed(2) });
    setCalls([]);
    setError(null);
    setEmbedded(false);
    setView({ page: 'checkout' });
    window.scrollTo({ top: 0 });
  }

  async function showSecureForm() {
    setError(null);
    try {
      setBusy('Creating checkout session…');
      const request = {
        items: order.lines.map(({ id, qty }) => ({ id, qty })),
        returnUrl: `${window.location.origin}/ReceiptPage`,
        responseFormat: 'json',
      };
      const res = await tracked(record, { method: 'POST', url: API_URL, label: 'Create checkout session (INITIATE_CHECKOUT)', request }, async () => {
        const r = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(request) });
        const text = await r.text();
        let body;
        try { body = JSON.parse(text); } catch { body = { sessionId: text.trim() }; }  // older backend: bare session id
        if (!r.ok) throw Object.assign(new Error(body.error || `HTTP ${r.status}`), { status: r.status });
        return { status: r.status, body };
      });

      // Snapshot what the receipt needs: 3-D Secure and the return reload the page.
      const placed = { ...order, ...res, amount: res.amount || order.amount };
      setOrder(placed);
      save(ORDER_KEY, placed);

      setBusy('Loading the secure payment form…');
      await loadCheckoutJs();
      const config = { session: { id: res.sessionId } };
      window.Checkout.configure(config);
      record({ id: `js-${Date.now()}`, method: 'JS', url: 'checkout.min.js', label: 'Checkout.configure()', request: config, status: 200, response: { configured: true } });
      setEmbedded(true);  // renders the target div; the effect above embeds the form
    } catch (e) {
      console.error(e);
      setBusy(null);
      setError(e.message);
    }
  }

  // ── Receipt (gateway redirected back) ──
  let page = null;
  if (onReceipt) {
    const params = new URLSearchParams(location.search);
    const resultIndicator = params.get('resultIndicator') || '';
    const placed = order || { lines: [], amount: null };
    // Without a stored successIndicator (e.g. storage blocked) fall back to the
    // presence of a resultIndicator, as the original demo did.
    const ok = placed.successIndicator ? resultIndicator === placed.successIndicator : Boolean(resultIndicator);
    page = (
      <Receipt
        ok={ok}
        message={ok
          ? 'Your payment was completed in the secure Mastercard form.'
          : 'The payment form did not report a successful payment. Your cart is still saved, so you can try again.'}
        details={[
          ['Order number', placed.orderId && <span className="tg-mono">{placed.orderId}</span>],
          ['Date', new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })],
          ['Payment', 'Hosted Checkout · Embedded'],
          ['Result', <span className="tg-pill">{ok ? 'SUCCESS' : 'NOT VERIFIED'}</span>],
          ['Result indicator', resultIndicator && <span className="tg-mono">{resultIndicator}</span>],
        ]}
        lines={placed.lines}
        amount={placed.amount}
        currency={placed.currency || CURRENCY}
        onContinue={() => go({ page: 'home' })}
        onRetry={() => {
          // Put the unpaid items back if the cart was emptied in the meantime.
          if (!cart.length && placed.lines.length) setCart(placed.lines);
          go({ page: 'cart' });
        }}
        onOpenDev={() => setDevOpen(true)}
      />
    );
  } else if (view.page === 'checkout' && order) {
    page = (
      <CheckoutLayout lines={order.lines} amount={order.amount} currency={CURRENCY} onBack={() => go({ page: 'cart' })}>
        <Step num="01" title="Payment">
          <PayPanel mark="→" title="Mastercard Hosted Checkout" sub="Embedded — a secure Mastercard form on this page" brands="Cards · Wallets · 3-D Secure">
            <div className="tg-c2p-body">
              {busy && <Busy label={busy} />}
              {!busy && !embedded && (
                <>
                  <p className="tg-help">
                    Pay {money(Number(order.amount), CURRENCY)} in Mastercard's secure form, shown right here. Your card details go straight to Mastercard, not to TechGear.
                  </p>
                  <div className="tg-testcard">
                    <span className="tg-label">MTF test card</span>
                    <span className="tg-mono">5123 4500 0000 0008 · 01/39 · CVV 100</span>
                  </div>
                  <button className="tg-btn tg-btn--block" onClick={showSecureForm}>Show secure payment form</button>
                </>
              )}
              {embedded && (
                <div className="tg-testcard">
                  <span className="tg-label">MTF test card</span>
                  <span className="tg-mono">5123 4500 0000 0008 · 01/39 · CVV 100</span>
                </div>
              )}
              {error && <Alert title="We couldn't load the payment form." detail={error} onOpenDev={() => setDevOpen(true)} />}
            </div>
            {/* The gateway renders its form into this element. */}
            {embedded && <div id={EMBED_TARGET} className="tg-embed" />}
          </PayPanel>
        </Step>
      </CheckoutLayout>
    );
  }

  // Clear the cart once a verified payment lands on the receipt.
  const receiptOk = onReceipt && order?.successIndicator &&
    new URLSearchParams(location.search).get('resultIndicator') === order.successIndicator;
  useEffect(() => { if (receiptOk) setCart([]); }, [receiptOk]);

  const showDev = onReceipt || view.page === 'checkout';

  return (
    <Storefront
      view={onReceipt ? { page: 'receipt' } : view}
      go={go}
      cart={cart}
      setCart={setCart}
      currency={CURRENCY}
      onCheckout={startCheckout}
      demo={DEMO}
      checkoutCta={CTA}
    >
      {page && (
        <>
          {page}
          {showDev && (
            <DevDrawer
              open={devOpen}
              setOpen={setDevOpen}
              calls={calls}
              flow={FLOW}
              onClear={() => setCalls([])}
              info={[
                ['Amount', order?.amount && money(Number(order.amount), order.currency || CURRENCY)],
                ['Integration', 'Hosted Checkout · Embedded'],
                ['Order ID', order?.orderId],
                ['Session ID', order?.sessionId],
              ]}
            />
          )}
        </>
      )}
    </Storefront>
  );
}

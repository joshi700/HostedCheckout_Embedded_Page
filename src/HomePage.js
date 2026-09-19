// HomePage.js - Fixed for embedded checkout

import React, { useState, useEffect } from 'react';
import './App.css';

// Overridable per deployment, so a preview frontend can point at a preview
// backend. Falls back to the production backend.
const BACKEND_URL =
  process.env.REACT_APP_BACKEND_URL || 'https://hosted-checkout-embedded-page-backe.vercel.app/';

const money = (v) => `$${Number(v).toFixed(2)}`;

// In embedded mode Mastercard renders only the payment form, so the order
// summary is the merchant page's job. It is drawn from the order the backend
// actually sent to the gateway, so the two can never disagree.
function OrderSummary({ order }) {
  return (
    <aside className="order-summary">
      <h3>Order summary</h3>
      <p className="order-id">Order {order.id}</p>
      <ul className="order-items">
        {order.item.map((i) => (
          <li key={i.name}>
            <div className="order-item-main">
              <span className="order-item-name">{i.name}</span>
              <span>{money(Number(i.unitPrice) * Number(i.quantity))}</span>
            </div>
            <div className="order-item-meta">
              {i.description} · Qty {i.quantity}
            </div>
          </li>
        ))}
      </ul>
      <div className="order-row"><span>Subtotal</span><span>{money(order.itemAmount)}</span></div>
      <div className="order-row"><span>Tax</span><span>{money(order.taxAmount)}</span></div>
      <div className="order-row order-total">
        <span>Total</span><span>{order.currency} {money(order.amount)}</span>
      </div>
    </aside>
  );
}

function HomePage() {
  const [paymentSession, setPaymentSession] = useState(null);
  const [isCheckoutReady, setIsCheckoutReady] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [error, setError] = useState(null);
  const [scriptKey, setScriptKey] = useState(0); // Force script reload
  const [showEmbeddedCheckout, setShowEmbeddedCheckout] = useState(false);
  const [order, setOrder] = useState(null);

  // Load/reload Mastercard Checkout script - reload for each new session
  useEffect(() => {
    // Remove any existing checkout script first
    const existingScript = document.querySelector('script[src*="checkout.min.js"]');
    if (existingScript) {
      existingScript.remove();
      console.log('Removed existing checkout script');
      // Clear the global Checkout object
      delete window.Checkout;
    }

    const script = document.createElement('script');
    script.src = 'https://mtf.gateway.mastercard.com/static/checkout/checkout.min.js';
    script.async = true;
    script.onload = () => {
      console.log('Checkout script loaded successfully');
      setIsCheckoutReady(true);
    };
    script.onerror = () => {
      console.error('Failed to load checkout script');
      setError('Failed to load payment system. Please refresh and try again.');
    };
    document.head.appendChild(script);

    return () => {
      if (document.head.contains(script)) {
        document.head.removeChild(script);
      }
    };
  }, [scriptKey]); // Depend on scriptKey to force reload

  // Configure checkout when script is loaded and session is available
  useEffect(() => {
    if (isCheckoutReady && window.Checkout && paymentSession) {
      console.log('UI Configuring checkout with session:', paymentSession);
      console.log('UI Session length:', paymentSession.length);
      console.log('UI Session starts with SESSION:', paymentSession.startsWith('SESSION'));
      
      try {
        // IMPORTANT: Add delay to ensure script is fully ready
        setTimeout(() => {
          // Clear any existing checkout configuration first
          if (window.Checkout.configure) {
            console.log('Clearing previous checkout configuration...');
          }
          
          // Configure Checkout - version 67+ only allows session object
          const config = {
            session: {
              id: paymentSession
            }
          };
          
          console.log('Configuration object:', config);
          window.Checkout.configure(config);
          console.log('UIX Configuration completed successfully with session:', paymentSession);
        }, 100); // Small delay to ensure fresh script state
        
      } catch (configError) {
        console.error('Error configuring checkout:', configError);
        setError('Failed to configure payment system: ' + configError.message);
      }
    }
  }, [isCheckoutReady, paymentSession]);

  // Function to call the API and get session ID
  const getSessionId = async () => {
    setIsLoadingSession(true);
    setError(null);
    
    try {
      // Construct the return URL for the receipt page
      const baseUrl = window.location.origin;
      const returnUrl = `${baseUrl}/receipt`;
      
      const response = await fetch(BACKEND_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Ask for the order too, so this page can show the summary.
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          returnUrl: returnUrl,
          amount: '99.00',
          orderId: `ORDER_${Date.now()}` // Generate unique order ID
        })
      });
      console.log('Response to UI:', response);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // A backend that predates the order summary still answers in plain text;
      // accept both so this page works against either.
      if ((response.headers.get('content-type') || '').includes('application/json')) {
        const data = await response.json();
        return { sessionId: data.sessionId, order: data.order || null };
      }
      return { sessionId: await response.text(), order: null };
    } catch (error) {
      console.error('Error fetching session ID:', error);
      setError('Failed to get session ID. Please try again.');
      throw error;
    } finally {
      setIsLoadingSession(false);
    }
  };

  const openCheckoutPage = async () => {
    try {
      // STEP 1: Clear all previous state first
      console.log('UI Clearing all previous checkout state...');
      setPaymentSession(null);
      setError(null);
      setIsCheckoutReady(false);
      setShowEmbeddedCheckout(false);
      
      // STEP 2: Clear sessionStorage and any cached data
      if (typeof(Storage) !== "undefined") {
        sessionStorage.clear();
      }
      
      // STEP 3: Force complete script reload with new key
      setScriptKey(prev => prev + 1);
      
      // STEP 4: Wait a moment for cleanup to complete
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // STEP 5: Get new session ID from API
      const { sessionId, order: sentOrder } = await getSessionId();
      setOrder(sentOrder);
      // STEP 6: Set the new session ID - this will trigger configuration
      const trimmedSessionId = sessionId.trim();
      console.log('UI Setting NEW session ID:', trimmedSessionId);
      setPaymentSession(trimmedSessionId);
      
      // STEP 7: Wait for configuration to complete, then show embedded payment page
      setTimeout(() => {
        if (window.Checkout && isCheckoutReady) {
          try {
            console.log('About to call showEmbeddedPage with session:', trimmedSessionId);
            console.log('Checkout object available:', !!window.Checkout);
            
            // Show the embedded checkout container
            setShowEmbeddedCheckout(true);
            
            // Wait a bit for the DOM to update, then embed the checkout
            setTimeout(() => {
              window.Checkout.showEmbeddedPage('#embed-target');
              console.log('Embedded payment page displayed successfully');
            }, 100);
            
          } catch (showError) {
            console.error('Exception showing embedded payment page:', showError);
            setError('Failed to display payment page: ' + showError.message);
          }
        } else {
          setError('Checkout system not ready. Please try again.');
        }
      }, 600); // Wait for configuration to complete
      
    } catch (error) {
      console.error('Failed to open checkout page:', error);
    }
  };

  // Function to hide embedded checkout and return to main view
  const hideEmbeddedCheckout = () => {
    setShowEmbeddedCheckout(false);
    setPaymentSession(null);
    setOrder(null);
    setError(null);
  };

  return (
    <div className="App">
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <h1>Hosted Checkout</h1>
          <div className="security-badge">
            <span>🔒 Secure Payments</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {/* Error Message */}
        {error && (
          <div className="error-message">
            <p>⚠️ {error}</p>
          </div>
        )}

        {/* Show either the payment card or the embedded checkout */}
        {!showEmbeddedCheckout ? (
          /* Payment Card - Initial View */
          <div className="payment-card">
            <div className="payment-header">
              <div className="price-section">
                <div className="price">Hosted Checkout Demo - Embedded Page - $99</div>
              </div>
            </div>

            <button 
              onClick={openCheckoutPage} 
              className="payment-button"
              disabled={isLoadingSession}
            >
              {isLoadingSession ? (
                <>
                  <div className="button-spinner"></div>
                  <span>Getting Session...</span>
                </>
              ) : (
                <>
                  💳 <span>Proceed to Checkout</span>
                </>
              )}
            </button>

            {/* Debug information */}
            {paymentSession && (
              <div style={{marginTop: '10px', fontSize: '12px', color: '#666'}}>
                <strong>Debug:</strong> Session loaded: {paymentSession}
              </div>
            )}
          </div>
        ) : (
          /* Embedded Checkout View */
          <div className="embedded-checkout-container">
            <div className="checkout-header">
              <button 
                onClick={hideEmbeddedCheckout}
                className="back-button"
                style={{
                  background: 'none',
                  border: '1px solid #ddd',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  marginBottom: '20px'
                }}
              >
                ← Back to Product
              </button>
            </div>
            
            <div className="checkout-layout">
              {/* This is where the embedded checkout will be rendered */}
              <div
                id="embed-target"
                style={{
                  minHeight: '500px',
                  border: '1px solid #e0e0e0',
                  borderRadius: '8px',
                  backgroundColor: '#fff'
                }}
              >
                {/* Checkout form will be embedded here by Mastercard */}
              </div>
              {order && <OrderSummary order={order} />}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default HomePage;

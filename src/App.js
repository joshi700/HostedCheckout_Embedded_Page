import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import EmbeddedDemo from './EmbeddedDemo.jsx';
import './techgear/storefront.css';

// "/" is the TechGear store and checkout (with the embedded payment form); the
// gateway returns the shopper to "/ReceiptPage" (the returnUrl) after paying.
function App() {
  return (
    <Router>
      <Routes>
        <Route path="/ReceiptPage" element={<EmbeddedDemo />} />
        <Route path="*" element={<EmbeddedDemo />} />
      </Routes>
    </Router>
  );
}

export default App;

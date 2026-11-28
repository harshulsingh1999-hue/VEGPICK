import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { StoreProvider } from './context/StoreContext';
import { AuthProvider } from './context/AuthContext';
import { DeliveryProvider } from './context/DeliveryContext';
import { ToastProvider } from './context/ToastContext';
import { Navbar } from './components/Navbar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PageLoader } from './components/PageLoader';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PWAInstallPrompt } from './components/PWAInstallPrompt';
import { RealtimeNotifier } from './components/RealtimeNotifier';
import { RoleGuard } from './components/RoleGuard';

// Lazy load pages for performance optimization
const Welcome = lazy(() => import('./pages/Welcome').then(module => ({ default: module.Welcome })));
const Home = lazy(() => import('./pages/Home').then(module => ({ default: module.Home })));
const Browse = lazy(() => import('./pages/Browse').then(module => ({ default: module.Browse })));
const Cart = lazy(() => import('./pages/Cart').then(module => ({ default: module.Cart })));
const Checkout = lazy(() => import('./pages/Checkout').then(module => ({ default: module.Checkout })));
const OrderSuccess = lazy(() => import('./pages/OrderSuccess').then(module => ({ default: module.OrderSuccess })));
const Orders = lazy(() => import('./pages/Orders').then(module => ({ default: module.Orders })));
const OrderDetails = lazy(() => import('./pages/OrderDetails').then(module => ({ default: module.OrderDetails })));
const Profile = lazy(() => import('./pages/Profile').then(module => ({ default: module.Profile })));
const Coupons = lazy(() => import('./pages/Coupons').then(module => ({ default: module.Coupons })));
const ProductDetails = lazy(() => import('./pages/ProductDetails').then(module => ({ default: module.ProductDetails })));
const NotFound = lazy(() => import('./pages/NotFound').then(module => ({ default: module.NotFound })));

// Lazy load static pages
const Disclaimer = lazy(() => import('./pages/static/Disclaimer').then(module => ({ default: module.Disclaimer })));
const Terms = lazy(() => import('./pages/static/Terms').then(module => ({ default: module.Terms })));
const Policy = lazy(() => import('./pages/static/Policy').then(module => ({ default: module.Policy })));
const Contact = lazy(() => import('./pages/static/Contact').then(module => ({ default: module.Contact })));

// Lazy load delivery pages
const DeliveryLogin = lazy(() => import('./pages/delivery/DeliveryLogin').then(module => ({ default: module.DeliveryLogin })));
const DeliveryRegister = lazy(() => import('./pages/delivery/DeliveryRegister').then(module => ({ default: module.DeliveryRegister })));
const DeliveryDashboard = lazy(() => import('./pages/delivery/DeliveryDashboard').then(module => ({ default: module.DeliveryDashboard })));
const DeliveryEarnings = lazy(() => import('./pages/delivery/DeliveryEarnings').then(module => ({ default: module.DeliveryEarnings })));
const DeliveryPerformance = lazy(() => import('./pages/delivery/DeliveryPerformance').then(module => ({ default: module.DeliveryPerformance })));
const DeliveryOrderDetails = lazy(() => import('./pages/delivery/DeliveryOrderDetails').then(module => ({ default: module.DeliveryOrderDetails })));

// Lazy load admin pages
const AdminLogin = lazy(() => import('./pages/admin/AdminLogin').then(module => ({ default: module.AdminLogin })));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard').then(module => ({ default: module.AdminDashboard })));

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <DeliveryProvider>
          <ToastProvider>
            <StoreProvider>
              <Router>
                <RealtimeNotifier />
                <div className="min-h-screen bg-gray-50 text-gray-900 font-sans flex flex-col">
                  <PWAInstallPrompt />
                  <Navbar />
                  <div className="flex-1">
                    <Suspense fallback={<PageLoader />}>
                    <Routes>
                      <Route path="/" element={<Welcome />} />
                      <Route path="/home" element={<Home />} />
                      <Route path="/product/:id" element={<ProductDetails />} />
                      <Route path="/browse" element={<Browse />} />
                      <Route path="/cart" element={<Cart />} />
                      <Route path="/checkout" element={<Checkout />} />
                      <Route path="/order-success" element={<OrderSuccess />} />
                      <Route path="/orders" element={<Orders />} />
                      <Route path="/orders/:id" element={<OrderDetails />} />
                      <Route path="/profile" element={<Profile />} />
                      <Route path="/coupons" element={<Coupons />} />
                      
                      {/* Static Pages */}
                      <Route path="/disclaimer" element={<Disclaimer />} />
                      <Route path="/terms" element={<Terms />} />
                      <Route path="/policy" element={<Policy />} />
                      <Route path="/contact" element={<Contact />} />

                      {/* Delivery Routes */}
                      <Route path="/delivery/login" element={<DeliveryLogin />} />
                      <Route path="/delivery/register" element={<DeliveryRegister />} />
                      <Route
                        path="/delivery/dashboard"
                        element={
                          <RoleGuard allowedRole="delivery">
                            <DeliveryDashboard />
                          </RoleGuard>
                        }
                      />
                      <Route
                        path="/delivery/earnings"
                        element={
                          <RoleGuard allowedRole="delivery">
                            <DeliveryEarnings />
                          </RoleGuard>
                        }
                      />
                      <Route
                        path="/delivery/performance"
                        element={
                          <RoleGuard allowedRole="delivery">
                            <DeliveryPerformance />
                          </RoleGuard>
                        }
                      />
                      <Route
                        path="/delivery/order/:id"
                        element={
                          <RoleGuard allowedRole="delivery">
                            <DeliveryOrderDetails />
                          </RoleGuard>
                        }
                      />

                      {/* Admin Routes (Isolated from mobile standalone storefronts) */}
                      <Route
                        path="/admin/login"
                        element={
                          <RoleGuard allowedRole="admin-login">
                            <AdminLogin />
                          </RoleGuard>
                        }
                      />
                      <Route
                        path="/admin/dashboard"
                        element={
                          <RoleGuard allowedRole="admin">
                            <AdminDashboard />
                          </RoleGuard>
                        }
                      />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </Suspense>
                  </div>
                  <OfflineIndicator />
                </div>
              </Router>
            </StoreProvider>
          </ToastProvider>
        </DeliveryProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

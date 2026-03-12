import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, Users, Truck, ShoppingCart, Package, 
  CreditCard, Tag, BarChart3, MessageSquare, Settings, LogOut, Menu, X, Shield
} from 'lucide-react';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'customers', label: 'Customer Management', icon: Users },
  { id: 'delivery', label: 'Delivery Men Management', icon: Truck },
  { id: 'orders', label: 'Order Management', icon: ShoppingCart },
  { id: 'products', label: 'Product Management', icon: Package },
  { id: 'payments', label: 'Payment Management', icon: CreditCard },
  { id: 'offers', label: 'Offers & Coupons', icon: Tag },
  { id: 'reports', label: 'Reports & Analytics', icon: BarChart3 },
  { id: 'support', label: 'Complaint & Support', icon: MessageSquare },
  { id: 'settings', label: 'App Settings', icon: Settings },
];

export const AdminDashboard = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    const isAuth = localStorage.getItem('adminAuth');
    if (!isAuth) {
      navigate('/admin/login');
    }
  }, [navigate]);

  const handleLogout = () => {
    localStorage.removeItem('adminAuth');
    navigate('/admin/login');
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-800">Dashboard Overview</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <p className="text-gray-500 text-sm font-medium mb-1">Total Customers</p>
                <p className="text-3xl font-bold text-gray-800">1,248</p>
              </div>
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <p className="text-gray-500 text-sm font-medium mb-1">Total Orders</p>
                <p className="text-3xl font-bold text-gray-800">8,432</p>
              </div>
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <p className="text-gray-500 text-sm font-medium mb-1">Daily Sales</p>
                <p className="text-3xl font-bold text-gray-800">₹45,200</p>
              </div>
            </div>
          </div>
        );
      case 'customers':
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-800">Customer Management</h2>
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <h3 className="font-semibold mb-4">View Customers & Block/Unblock</h3>
              <p className="text-gray-500 text-sm">Customer list will be displayed here with options to view details and manage access.</p>
            </div>
          </div>
        );
      case 'delivery':
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-800">Delivery Men Management</h2>
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <h3 className="font-semibold mb-4">Add/Remove Delivery Boys & Assign Areas</h3>
              <p className="text-gray-500 text-sm">Manage delivery personnel, their assigned zones, and track their performance.</p>
            </div>
          </div>
        );
      case 'orders':
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-800">Order Management</h2>
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <h3 className="font-semibold mb-4">Track Orders & Assign to Delivery Men</h3>
              <p className="text-gray-500 text-sm">View all active and past orders, and manually or automatically assign them to delivery partners.</p>
            </div>
          </div>
        );
      case 'products':
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-800">Product Management</h2>
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <h3 className="font-semibold mb-4">Add/Edit/Remove Vegetables & Update Price/Stock</h3>
              <p className="text-gray-500 text-sm">Manage inventory, update prices, and add new products to the catalog.</p>
            </div>
          </div>
        );
      case 'payments':
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-800">Payment Management</h2>
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <h3 className="font-semibold mb-4">View Payments & Manage Delivery Charges</h3>
              <p className="text-gray-500 text-sm">Track incoming payments, refunds, and configure dynamic delivery fees.</p>
            </div>
          </div>
        );
      case 'offers':
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-800">Offers & Coupons</h2>
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <h3 className="font-semibold mb-4">Create Discount Offers</h3>
              <p className="text-gray-500 text-sm">Generate promo codes, set up seasonal discounts, and manage promotional campaigns.</p>
            </div>
          </div>
        );
      case 'reports':
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-800">Reports & Analytics</h2>
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <h3 className="font-semibold mb-4">Daily/Monthly Sales Reports</h3>
              <p className="text-gray-500 text-sm">View detailed charts and export data for sales, user growth, and product performance.</p>
            </div>
          </div>
        );
      case 'support':
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-800">Complaint & Support</h2>
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <h3 className="font-semibold mb-4">Handle Customer Complaints</h3>
              <p className="text-gray-500 text-sm">Respond to user tickets, resolve issues, and manage customer satisfaction.</p>
            </div>
          </div>
        );
      case 'settings':
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-800">App Settings</h2>
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <h3 className="font-semibold mb-4">Taxes, Delivery Charges, Notifications</h3>
              <p className="text-gray-500 text-sm">Configure global app settings, tax rates, base delivery fees, and push notifications.</p>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50 w-72 bg-gray-900 text-white transform transition-transform duration-300 ease-in-out
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        flex flex-col
      `}>
        <div className="p-6 flex items-center justify-between border-b border-gray-800">
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Shield className="text-blue-500" />
            Admin Control
          </h1>
          <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden text-gray-400 hover:text-white">
            <X size={24} />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto py-4">
          <nav className="space-y-1 px-3">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setIsSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                    isActive 
                      ? 'bg-blue-600 text-white' 
                      : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                  }`}
                >
                  <Icon size={20} className={isActive ? 'text-white' : 'text-gray-400'} />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-gray-800">
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <LogOut size={20} />
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile Header */}
        <header className="bg-white border-b border-gray-200 p-4 flex items-center gap-4 lg:hidden">
          <button onClick={() => setIsSidebarOpen(true)} className="text-gray-600 hover:text-gray-900">
            <Menu size={24} />
          </button>
          <h1 className="text-lg font-bold text-gray-800">Admin Panel</h1>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="max-w-6xl mx-auto">
            {renderContent()}
          </div>
        </div>
      </main>
    </div>
  );
};

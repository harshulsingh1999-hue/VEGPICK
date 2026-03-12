import React, { createContext, useContext, useState, useEffect } from 'react';
import { Order } from '../lib/data';

export interface DeliveryUser {
  id: string;
  name: string;
  phone: string;
  isOnline: boolean;
}

export interface DeliveryOrder extends Order {
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerGeo: { lat: number; lng: number }; // For maps
  paymentStatus: 'pending' | 'collected' | 'paid';
  deliveryStatus: 'assigned' | 'picked_up' | 'out_for_delivery' | 'delivered';
}

interface DeliveryContextType {
  deliveryUser: DeliveryUser | null;
  login: (id: string, pass: string) => boolean;
  logout: () => void;
  toggleOnline: () => void;
  assignedOrders: DeliveryOrder[];
  updateOrderStatus: (orderId: string, status: DeliveryOrder['deliveryStatus']) => void;
  collectPayment: (orderId: string) => void;
  stats: {
    completed: number;
    pending: number;
    cashCollected: number;
  };
}

const DeliveryContext = createContext<DeliveryContextType | undefined>(undefined);

export const DeliveryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [deliveryUser, setDeliveryUser] = useState<DeliveryUser | null>(() => {
    const saved = localStorage.getItem('deliveryUser');
    return saved ? JSON.parse(saved) : null;
  });

  const generateMockOrders = (): DeliveryOrder[] => {
    const names = ['Rahul Sharma', 'Priya Singh', 'Amit Kumar', 'Sneha Gupta', 'Vikram Singh', 'Pooja Patel', 'Rohan Desai', 'Neha Verma', 'Karan Malhotra', 'Anjali Rao'];
    const areas = ['Sector 14', 'Cyber City', 'Green Park', 'Vasant Kunj', 'Dwarka', 'Rohini', 'Lajpat Nagar', 'Karol Bagh', 'Pitampura', 'Janakpuri'];
    const statuses: DeliveryOrder['deliveryStatus'][] = ['assigned', 'assigned', 'assigned', 'picked_up', 'out_for_delivery', 'delivered', 'delivered'];

    const numOrders = Math.floor(Math.random() * (500 - 20 + 1)) + 20; // Random between 20 and 500
    const orders: DeliveryOrder[] = [];

    // Starting point (e.g., New Delhi Hub)
    let currentLat = 28.6139;
    let currentLng = 77.2090;

    for (let i = 0; i < numOrders; i++) {
      const isCOD = Math.random() > 0.4;
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      const paymentStatus = isCOD ? (status === 'delivered' ? 'collected' : 'pending') : 'paid';
      
      // Add a small random offset to simulate "nearest from last order"
      // 0.005 degrees is roughly 500 meters. This ensures the next order is close to the previous one.
      currentLat += (Math.random() * 0.01) - 0.005;
      currentLng += (Math.random() * 0.01) - 0.005;
      
      orders.push({
        id: `ORD-${1000 + i}`,
        items: [],
        total: Math.floor(Math.random() * 800) + 100,
        status: 'packed',
        date: new Date().toISOString(),
        deliverySlot: 'Today, 4 PM - 6 PM',
        address: { id: `a${i}`, label: 'Home', street: `${i + 15} Main St`, city: 'Veggie Town', zip: '12345' },
        paymentMethod: isCOD ? 'cod' : 'upi',
        customerName: names[i % names.length],
        customerPhone: `98765${Math.floor(10000 + Math.random() * 90000)}`,
        customerAddress: `${i + 15} Main St, ${areas[i % areas.length]}, 12345`,
        customerGeo: { lat: currentLat, lng: currentLng },
        paymentStatus,
        deliveryStatus: status
      });
    }
    
    return orders;
  };

  const [assignedOrders, setAssignedOrders] = useState<DeliveryOrder[]>(generateMockOrders());

  useEffect(() => {
    if (deliveryUser) {
      localStorage.setItem('deliveryUser', JSON.stringify(deliveryUser));
    } else {
      localStorage.removeItem('deliveryUser');
    }
  }, [deliveryUser]);

  const login = (id: string, pass: string) => {
    // Mock login
    if (id === 'DEL001' && pass === '123456') {
      setDeliveryUser({
        id: 'DEL001',
        name: 'Vikram Kumar',
        phone: '9000000000',
        isOnline: true
      });
      return true;
    }
    return false;
  };

  const logout = () => setDeliveryUser(null);

  const toggleOnline = () => {
    if (deliveryUser) {
      setDeliveryUser({ ...deliveryUser, isOnline: !deliveryUser.isOnline });
    }
  };

  const updateOrderStatus = (orderId: string, status: DeliveryOrder['deliveryStatus']) => {
    setAssignedOrders(prev => prev.map(o => 
      o.id === orderId ? { ...o, deliveryStatus: status } : o
    ));
  };

  const collectPayment = (orderId: string) => {
    setAssignedOrders(prev => prev.map(o => 
      o.id === orderId ? { ...o, paymentStatus: 'collected' } : o
    ));
  };

  const stats = {
    completed: assignedOrders.filter(o => o.deliveryStatus === 'delivered').length,
    pending: assignedOrders.filter(o => o.deliveryStatus !== 'delivered').length,
    cashCollected: assignedOrders
      .filter(o => o.paymentMethod === 'cod' && o.paymentStatus === 'collected')
      .reduce((acc, curr) => acc + curr.total, 0)
  };

  return (
    <DeliveryContext.Provider value={{ 
      deliveryUser, 
      login, 
      logout, 
      toggleOnline, 
      assignedOrders, 
      updateOrderStatus, 
      collectPayment,
      stats
    }}>
      {children}
    </DeliveryContext.Provider>
  );
};

export const useDelivery = () => {
  const context = useContext(DeliveryContext);
  if (!context) throw new Error("useDelivery must be used within DeliveryProvider");
  return context;
};

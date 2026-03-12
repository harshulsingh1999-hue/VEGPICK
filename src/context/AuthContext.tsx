import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, Order, Address } from '../lib/data';

interface AuthContextType {
  user: User | null;
  login: (phone: string) => boolean;
  register: (phone: string, name: string, email: string) => void;
  checkUserExists: (phone: string) => boolean;
  logout: () => void;
  updateProfile: (data: Partial<User>) => void;
  orders: Order[];
  placeOrder: (order: Order) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    const savedUser = localStorage.getItem('currentUser');
    return savedUser ? JSON.parse(savedUser) : null;
  });
  
  const [allOrders, setAllOrders] = useState<Order[]>(() => {
    const savedOrders = localStorage.getItem('orders');
    return savedOrders ? JSON.parse(savedOrders) : [];
  });

  // Filter orders for the current user
  const orders = user ? allOrders.filter(o => o.userId === user.id) : [];

  useEffect(() => {
    localStorage.setItem('orders', JSON.stringify(allOrders));
  }, [allOrders]);

  // Mock database in localStorage
  const getUsers = (): User[] => {
    const users = localStorage.getItem('users');
    return users ? JSON.parse(users) : [];
  };

  const saveUser = (user: User) => {
    const users = getUsers();
    const existingIndex = users.findIndex(u => u.phone === user.phone);
    if (existingIndex >= 0) {
      users[existingIndex] = user;
    } else {
      users.push(user);
    }
    localStorage.setItem('users', JSON.stringify(users));
    localStorage.setItem('currentUser', JSON.stringify(user));
    setUser(user);
  };

  const checkUserExists = (phone: string): boolean => {
    const users = getUsers();
    return users.some(u => u.phone === phone);
  };

  const login = (phone: string) => {
    const users = getUsers();
    const existingUser = users.find(u => u.phone === phone);
    if (existingUser) {
      localStorage.setItem('currentUser', JSON.stringify(existingUser));
      setUser(existingUser);
      return true;
    }
    return false;
  };

  const register = (phone: string, name: string, email: string) => {
    const newUser: User = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      phone,
      email,
      addresses: []
    };
    saveUser(newUser);
  };

  const logout = () => {
    localStorage.removeItem('currentUser');
    setUser(null);
  };

  const updateProfile = (data: Partial<User>) => {
    if (user) {
      const updatedUser = { ...user, ...data };
      saveUser(updatedUser);
    }
  };

  const placeOrder = (order: Order) => {
    if (user) {
      const newOrder = { ...order, userId: user.id };
      setAllOrders(prev => [newOrder, ...prev]);
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, register, checkUserExists, logout, updateProfile, orders, placeOrder }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};

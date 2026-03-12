import React, { createContext, useContext, useState, useEffect } from 'react';
import { Product, CartItem, MOCK_PRODUCTS, CATEGORIES } from '../lib/data';

interface StoreContextType {
  products: Product[];
  cart: CartItem[];
  addToCart: (product: Product, weight: number) => void;
  removeFromCart: (productId: string, weight: number) => void;
  updateQuantity: (productId: string, weight: number, count: number) => void;
  clearCart: () => void;
  cartTotal: number;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedCategory: string;
  setSelectedCategory: (category: string) => void;
  filteredProducts: Product[];
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [products] = useState<Product[]>(MOCK_PRODUCTS);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");

  const addToCart = (product: Product, weight: number) => {
     setCart(prev => {
      const existing = prev.find(item => item.id === product.id && item.selectedWeight === weight);
      if (existing) {
         return prev.map(item => 
          (item.id === product.id && item.selectedWeight === weight)
            ? { ...item, quantity: item.quantity + 1 } // quantity here will mean 'count' of packs
            : item
        );
      }
      return [...prev, { ...product, selectedWeight: weight, quantity: 1 }];
     });
  };

  const removeFromCart = (productId: string, weight: number) => {
      setCart(prev => prev.filter(item => !(item.id === productId && item.selectedWeight === weight)));
  }

  const updateQuantity = (productId: string, weight: number, newCount: number) => {
    if (newCount < 1) {
        removeFromCart(productId, weight);
        return;
    }
    setCart(prev => prev.map(item => 
        (item.id === productId && item.selectedWeight === weight)
        ? { ...item, quantity: newCount }
        : item
    ));
  };

  const clearCart = () => setCart([]);

  const cartTotal = cart.reduce((total, item) => {
    const pricePerGram = item.pricePerKg / 1000;
    const itemPrice = pricePerGram * item.selectedWeight;
    return total + (itemPrice * item.quantity);
  }, 0);

  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "All" || p.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <StoreContext.Provider value={{
      products,
      cart,
      addToCart,
      removeFromCart,
      updateQuantity: updateQuantity,
      clearCart,
      cartTotal,
      searchQuery,
      setSearchQuery,
      selectedCategory,
      setSelectedCategory,
      filteredProducts
    }}>
      {children}
    </StoreContext.Provider>
  );
};

export const useStore = () => {
  const context = useContext(StoreContext);
  if (!context) throw new Error("useStore must be used within StoreProvider");
  return context;
};

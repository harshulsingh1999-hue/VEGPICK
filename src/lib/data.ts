export interface Product {
  id: string;
  name: string;
  category: string;
  pricePerKg: number;
  image: string;
  available: boolean;
  description: string;
  rating: number;
  reviews: number;
}

export interface CartItem extends Product {
  quantity: number; // in grams
  selectedWeight: number; // 250, 500, 1000
}

export interface User {
  id: string;
  name: string;
  phone: string;
  email: string;
  addresses: Address[];
}

export interface Address {
  id: string;
  label: string; // Home, Work
  street: string;
  city: string;
  zip: string;
}

export interface Order {
  id: string;
  userId?: string;
  items: CartItem[];
  total: number;
  status: 'placed' | 'packed' | 'out_for_delivery' | 'delivered' | 'cancelled';
  date: string;
  deliverySlot: string;
  address: Address;
  paymentMethod: 'cod' | 'upi';
}

export const CATEGORIES = ["All", "Leafy Greens", "Root Vegetables", "Fruits", "Herbs", "Exotic"];

export const MOCK_PRODUCTS: Product[] = [
  {
    id: "1",
    name: "Fresh Tomato",
    category: "Fruits",
    pricePerKg: 40,
    image: "https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&q=80&w=1000",
    available: true,
    description: "Farm fresh red tomatoes, perfect for curries and salads.",
    rating: 4.5,
    reviews: 120
  },
  {
    id: "2",
    name: "Potato",
    category: "Root Vegetables",
    pricePerKg: 30,
    image: "https://images.unsplash.com/photo-1518977676601-b53f82aba655?auto=format&fit=crop&q=80&w=1000",
    available: true,
    description: "Organic potatoes, great for frying and boiling.",
    rating: 4.2,
    reviews: 85
  },
  {
    id: "3",
    name: "Spinach (Palak)",
    category: "Leafy Greens",
    pricePerKg: 60,
    image: "https://images.unsplash.com/photo-1576045057995-568f588f82fb?auto=format&fit=crop&q=80&w=1000",
    available: true,
    description: "Fresh green spinach leaves, rich in iron.",
    rating: 4.8,
    reviews: 200
  },
  {
    id: "4",
    name: "Onion",
    category: "Root Vegetables",
    pricePerKg: 35,
    image: "https://images.unsplash.com/photo-1508747703703-c3bc0d1f204f?auto=format&fit=crop&q=80&w=1000",
    available: true,
    description: "Essential for every Indian kitchen.",
    rating: 4.3,
    reviews: 150
  },
  {
    id: "5",
    name: "Carrot",
    category: "Root Vegetables",
    pricePerKg: 50,
    image: "https://images.unsplash.com/photo-1598170845058-32b9d6a5da37?auto=format&fit=crop&q=80&w=1000",
    available: true,
    description: "Sweet and crunchy orange carrots.",
    rating: 4.6,
    reviews: 90
  },
  {
    id: "6",
    name: "Broccoli",
    category: "Exotic",
    pricePerKg: 120,
    image: "https://images.unsplash.com/photo-1459411621453-7debff8f5cfb?auto=format&fit=crop&q=80&w=1000",
    available: true,
    description: "Fresh broccoli florets, high in fiber.",
    rating: 4.7,
    reviews: 60
  },
  {
    id: "7",
    name: "Coriander",
    category: "Herbs",
    pricePerKg: 80,
    image: "https://images.unsplash.com/photo-1589135233689-d538665f5756?auto=format&fit=crop&q=80&w=1000",
    available: true,
    description: "Aromatic fresh coriander leaves.",
    rating: 4.4,
    reviews: 110
  }
];

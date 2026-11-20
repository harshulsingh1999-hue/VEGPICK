import { Product, Coupon } from './data';

/**
 * Starter produce catalog templates used ONLY when an Admin explicitly
 * initializes an empty Firestore store via the Admin Control Panel.
 */
export const STARTER_PRODUCTS: Omit<Product, 'id'>[] = [
  {
    name: 'Fresh Tomato',
    category: 'Fruits',
    pricePerKg: 40,
    image: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&q=80&w=1000',
    available: true,
    description: 'Farm fresh red tomatoes, hand-picked daily for curries and salads.',
    rating: 4.5,
    reviews: 120
  },
  {
    name: 'Organic Potato',
    category: 'Root Vegetables',
    pricePerKg: 30,
    image: 'https://images.unsplash.com/photo-1518977676601-b53f82aba655?auto=format&fit=crop&q=80&w=1000',
    available: true,
    description: 'Washed farm potatoes, ideal for roasting, curries, and everyday meals.',
    rating: 4.4,
    reviews: 85
  },
  {
    name: 'Spinach (Palak)',
    category: 'Leafy Greens',
    pricePerKg: 60,
    image: 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?auto=format&fit=crop&q=80&w=1000',
    available: true,
    description: 'Crisp green spinach leaves harvested at dawn, naturally rich in iron.',
    rating: 4.8,
    reviews: 200
  },
  {
    name: 'Red Onion',
    category: 'Root Vegetables',
    pricePerKg: 35,
    image: 'https://images.unsplash.com/photo-1508747703703-c3bc0d1f204f?auto=format&fit=crop&q=80&w=1000',
    available: true,
    description: 'Fresh crisp red onions, kitchen essential sourced directly from farms.',
    rating: 4.3,
    reviews: 150
  },
  {
    name: 'Sweet Carrot',
    category: 'Root Vegetables',
    pricePerKg: 50,
    image: 'https://images.unsplash.com/photo-1598170845058-32b9d6a5da37?auto=format&fit=crop&q=80&w=1000',
    available: true,
    description: 'Sweet and crunchy orange carrots, ideal for salads and fresh juices.',
    rating: 4.6,
    reviews: 90
  },
  {
    name: 'Fresh Broccoli',
    category: 'Exotic',
    pricePerKg: 120,
    image: 'https://images.unsplash.com/photo-1459411621453-7debff8f5cfb?auto=format&fit=crop&q=80&w=1000',
    available: true,
    description: 'Hydroponically grown broccoli florets, high in fiber and vitamins.',
    rating: 4.7,
    reviews: 60
  },
  {
    name: 'Fresh Coriander',
    category: 'Herbs',
    pricePerKg: 80,
    image: 'https://images.unsplash.com/photo-1589135233689-d538665f5756?auto=format&fit=crop&q=80&w=1000',
    available: true,
    description: 'Aromatic fresh coriander bunches picked to preserve essential oils.',
    rating: 4.5,
    reviews: 110
  }
];

export const STARTER_COUPONS: Coupon[] = [
  {
    code: 'FRESH20',
    description: '20% OFF on fresh farm produce orders',
    discountType: 'percent',
    discountValue: 20,
    minOrder: 0,
    isActive: true,
    expiry: '2027-12-31'
  },
  {
    code: 'WELCOME50',
    description: 'Flat ₹50 OFF on orders above ₹200',
    discountType: 'flat',
    discountValue: 50,
    minOrder: 200,
    isActive: true,
    expiry: '2027-12-31'
  }
];

import React, { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useDelivery } from '../context/DeliveryContext';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';

const notifySystem = (title: string, body: string) => {
  if (
    typeof window === 'undefined' ||
    !('Notification' in window) ||
    window.Notification.permission !== 'granted'
  ) {
    return;
  }

  const options = {
    body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png'
  };

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then((reg) => reg.showNotification(title, options))
      .catch(() => {
        try {
          new window.Notification(title, options);
        } catch {
          // Ignore unsupported browser contexts
        }
      });
    return;
  }

  try {
    new window.Notification(title, options);
  } catch {
    // Ignore unsupported browser contexts
  }
};

export const RealtimeNotifier: React.FC = () => {
  const { orders, allOrders, isAdmin } = useAuth();
  const { deliveryUser, availableOrders, assignedOrders } = useDelivery();
  const { appSettings } = useStore();
  const { showToast } = useToast();

  const initializedCustomerRef = useRef(false);
  const prevCustomerStatuses = useRef<Map<string, string>>(new Map());

  const initializedAdminRef = useRef(false);
  const prevAdminOrderIds = useRef<Set<string>>(new Set());

  const initializedPartnerRef = useRef(false);
  const prevAvailableIds = useRef<Set<string>>(new Set());
  const prevAssignedIds = useRef<Set<string>>(new Set());

  // 1. Customer order status delta alerts
  useEffect(() => {
    if (!appSettings.notificationsEnabled) return;
    if (!initializedCustomerRef.current) {
      orders.forEach((o) => prevCustomerStatuses.current.set(o.id, o.status));
      initializedCustomerRef.current = true;
      return;
    }

    orders.forEach((order) => {
      const prev = prevCustomerStatuses.current.get(order.id);
      if (prev && prev !== order.status) {
        const readable = order.status.replace(/_/g, ' ');
        const msg = `Order #${order.id} is now ${readable}`;
        showToast(msg, order.status === 'cancelled' ? 'error' : 'info');
        notifySystem('FreshVeggie Order Update', msg);
      }
      prevCustomerStatuses.current.set(order.id, order.status);
    });
  }, [orders, appSettings.notificationsEnabled, showToast]);

  // 2. Admin new incoming order alerts
  useEffect(() => {
    if (!isAdmin || !appSettings.notificationsEnabled) {
      initializedAdminRef.current = false;
      prevAdminOrderIds.current.clear();
      return;
    }
    if (!initializedAdminRef.current) {
      allOrders.forEach((o) => prevAdminOrderIds.current.add(o.id));
      initializedAdminRef.current = true;
      return;
    }

    allOrders.forEach((order) => {
      if (!prevAdminOrderIds.current.has(order.id)) {
        const msg = `New order #${order.id} from ${order.customerName} (₹${order.total})`;
        showToast(msg, 'success');
        notifySystem('New FreshVeggie Order', msg);
      }
      prevAdminOrderIds.current.add(order.id);
    });
  }, [allOrders, isAdmin, appSettings.notificationsEnabled, showToast]);

  // 3. Delivery partner dispatch & assignment alerts
  useEffect(() => {
    if (!deliveryUser?.isApproved || !appSettings.notificationsEnabled) {
      initializedPartnerRef.current = false;
      prevAvailableIds.current.clear();
      prevAssignedIds.current.clear();
      return;
    }
    if (!initializedPartnerRef.current) {
      availableOrders.forEach((a) => prevAvailableIds.current.add(a.orderId));
      assignedOrders.forEach((o) => prevAssignedIds.current.add(o.id));
      initializedPartnerRef.current = true;
      return;
    }

    if (deliveryUser.isOnline) {
      availableOrders.forEach((item) => {
        if (!prevAvailableIds.current.has(item.orderId)) {
          const msg = `New dispatch available: #${item.orderId} (${item.city})`;
          showToast(msg, 'info');
          notifySystem('New Delivery Request', msg);
        }
        prevAvailableIds.current.add(item.orderId);
      });
    }

    assignedOrders.forEach((order) => {
      if (!prevAssignedIds.current.has(order.id) && order.status !== 'delivered') {
        const msg = `Assigned delivery #${order.id} to you`;
        showToast(msg, 'info');
        notifySystem('Delivery Assigned', msg);
      }
      prevAssignedIds.current.add(order.id);
    });
  }, [
    deliveryUser?.isApproved,
    deliveryUser?.isOnline,
    availableOrders,
    assignedOrders,
    appSettings.notificationsEnabled,
    showToast
  ]);

  return null;
};

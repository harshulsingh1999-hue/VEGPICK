import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useDelivery } from '../context/DeliveryContext';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import {
  AppPushRole,
  ensurePushServiceWorker,
  sendLocationPermissionPushReminder,
  showLocalPushNotification,
  syncExistingPushSubscription
} from '../lib/pushNotifications';
import { inspectGeolocationPermission } from '../lib/locationPermission';

export const RealtimeNotifier: React.FC = () => {
  const navigate = useNavigate();
  const { firebaseUser, orders, allOrders, isAdmin } = useAuth();
  const { deliveryUser, availableOrders, assignedOrders } = useDelivery();
  const { appSettings, complaints } = useStore();
  const { showToast } = useToast();

  const initializedCustomerRef = useRef(false);
  const prevCustomerStatuses = useRef<Map<string, string>>(new Map());

  const initializedComplaintsRef = useRef(false);
  const prevComplaintStatuses = useRef<Map<string, string>>(new Map());

  const initializedAdminRef = useRef(false);
  const prevAdminOrderMap = useRef<Map<string, string>>(new Map());

  const initializedAdminTicketsRef = useRef(false);
  const prevAdminTicketIds = useRef<Set<string>>(new Set());

  const initializedPartnerRef = useRef(false);
  const prevAvailableIds = useRef<Set<string>>(new Set());
  const prevAssignedIds = useRef<Set<string>>(new Set());
  const remindedLocationDeniedRef = useRef(false);

  // 0. Ensure Service Worker & notification click routing across Android / iOS / Web
  useEffect(() => {
    void ensurePushServiceWorker();

    const handleNotificationAction = (rawDetail: {
      url?: string;
      action?: string;
      orderId?: string;
    }) => {
      const targetUrl =
        typeof rawDetail.url === 'string' &&
        rawDetail.url.startsWith('/') &&
        !rawDetail.url.startsWith('//')
          ? rawDetail.url
          : '/';
      navigate(targetUrl);
      if (rawDetail.action === 'enable_location') {
        window.setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent('fv-request-location-sync', {
              detail: { orderId: rawDetail.orderId || '' }
            })
          );
        }, 250);
      }
    };

    const onSwMessage = (event: MessageEvent) => {
      const data = event.data as {
        type?: string;
        url?: string;
        action?: string;
        orderId?: string;
      } | null;
      if (data?.type === 'PUSH_NOTIFICATION_CLICK') {
        handleNotificationAction(data);
      }
    };

    const onWindowClickEvent = (event: Event) => {
      const custom = event as CustomEvent<{
        url?: string;
        action?: string;
        orderId?: string;
      }>;
      if (custom.detail) {
        handleNotificationAction(custom.detail);
      }
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', onSwMessage);
    }
    window.addEventListener('fv-push-notification-click', onWindowClickEvent);

    return () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', onSwMessage);
      }
      window.removeEventListener('fv-push-notification-click', onWindowClickEvent);
    };
  }, [navigate]);

  // 0b. Keep Web Push subscription synced for active device & role even when no Firebase ID token is present
  useEffect(() => {
    const role: AppPushRole = isAdmin
      ? 'admin'
      : deliveryUser?.isApproved
      ? 'delivery'
      : 'customer';
    void syncExistingPushSubscription(role);
  }, [firebaseUser?.uid, isAdmin, deliveryUser?.isApproved]);

  // 1. Customer order status delta alerts via Push Notification + toast
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
        void showLocalPushNotification({
          title: 'FreshVeggie Order Update',
          body: msg,
          url: `/orders/${order.id}`,
          tag: `customer-order-${order.id}`,
          orderId: order.id
        });
      }
      prevCustomerStatuses.current.set(order.id, order.status);
    });
  }, [orders, appSettings.notificationsEnabled, showToast]);

  // 1b. Customer support ticket status alerts via Push Notification
  useEffect(() => {
    if (!firebaseUser || isAdmin || !appSettings.notificationsEnabled) {
      initializedComplaintsRef.current = false;
      prevComplaintStatuses.current.clear();
      return;
    }

    const mine = complaints.filter((c) => c.userId === firebaseUser.uid);
    if (!initializedComplaintsRef.current) {
      mine.forEach((c) => prevComplaintStatuses.current.set(c.id, c.status));
      initializedComplaintsRef.current = true;
      return;
    }

    mine.forEach((ticket) => {
      const prev = prevComplaintStatuses.current.get(ticket.id);
      if (prev && prev !== ticket.status) {
        const msg = `Support Ticket #${ticket.id} updated to ${ticket.status.replace(/_/g, ' ')}`;
        showToast(msg, 'info');
        void showLocalPushNotification({
          title: 'FreshVeggie Support Update',
          body: msg,
          url: '/contact',
          tag: `ticket-${ticket.id}`
        });
      }
      prevComplaintStatuses.current.set(ticket.id, ticket.status);
    });
  }, [complaints, firebaseUser?.uid, isAdmin, appSettings.notificationsEnabled, showToast]);

  // 2. Admin new incoming order & cancellation alerts via Push Notification
  useEffect(() => {
    if (!isAdmin || !appSettings.notificationsEnabled) {
      initializedAdminRef.current = false;
      prevAdminOrderMap.current.clear();
      return;
    }
    if (!initializedAdminRef.current) {
      allOrders.forEach((o) => prevAdminOrderMap.current.set(o.id, o.status));
      initializedAdminRef.current = true;
      return;
    }

    allOrders.forEach((order) => {
      const prevStatus = prevAdminOrderMap.current.get(order.id);
      if (!prevStatus) {
        const msg = `New order #${order.id} from ${order.customerName} (₹${order.total})`;
        showToast(msg, 'success');
        void showLocalPushNotification({
          title: 'New FreshVeggie Order',
          body: msg,
          url: '/admin/dashboard',
          tag: `admin-new-order-${order.id}`,
          orderId: order.id
        });
      } else if (prevStatus !== order.status) {
        const msg = `Order #${order.id} status changed to ${order.status.replace(/_/g, ' ')}`;
        void showLocalPushNotification({
          title: 'Order Status Update (Admin)',
          body: msg,
          url: '/admin/dashboard',
          tag: `admin-order-${order.id}`,
          orderId: order.id
        });
      }
      prevAdminOrderMap.current.set(order.id, order.status);
    });
  }, [allOrders, isAdmin, appSettings.notificationsEnabled, showToast]);

  // 2b. Admin new support ticket alerts via Push Notification
  useEffect(() => {
    if (!isAdmin || !appSettings.notificationsEnabled) {
      initializedAdminTicketsRef.current = false;
      prevAdminTicketIds.current.clear();
      return;
    }
    if (!initializedAdminTicketsRef.current) {
      complaints.forEach((t) => prevAdminTicketIds.current.add(t.id));
      initializedAdminTicketsRef.current = true;
      return;
    }

    complaints.forEach((ticket) => {
      if (!prevAdminTicketIds.current.has(ticket.id)) {
        const msg = `New support ticket #${ticket.id}: ${ticket.subject}`;
        showToast(msg, 'info');
        void showLocalPushNotification({
          title: 'New Support Ticket',
          body: msg,
          url: '/admin/dashboard',
          tag: `admin-ticket-${ticket.id}`
        });
      }
      prevAdminTicketIds.current.add(ticket.id);
    });
  }, [complaints, isAdmin, appSettings.notificationsEnabled, showToast]);

  // 3. Delivery partner dispatch, assignment & location-permission push alerts
  useEffect(() => {
    if (!deliveryUser?.isApproved || !appSettings.notificationsEnabled) {
      initializedPartnerRef.current = false;
      prevAvailableIds.current.clear();
      prevAssignedIds.current.clear();
      remindedLocationDeniedRef.current = false;
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
          void showLocalPushNotification({
            title: 'New Delivery Request',
            body: msg,
            url: `/delivery/order/${item.orderId}`,
            tag: `dispatch-${item.orderId}`,
            orderId: item.orderId,
            requireInteraction: true
          });
        }
        prevAvailableIds.current.add(item.orderId);
      });
    }

    assignedOrders.forEach((order) => {
      if (!prevAssignedIds.current.has(order.id) && order.status !== 'delivered') {
        const msg = `Assigned delivery #${order.id} to you`;
        showToast(msg, 'info');
        void showLocalPushNotification({
          title: 'Delivery Assigned',
          body: msg,
          url: `/delivery/order/${order.id}`,
          tag: `assigned-${order.id}`,
          orderId: order.id,
          requireInteraction: true
        });
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

  // 3b. If partner is active/online with blocked device GPS, dispatch a clickable Push Notification
  useEffect(() => {
    if (!deliveryUser?.isApproved || !appSettings.notificationsEnabled) return undefined;
    const activeTrip = assignedOrders.find(
      (o) => o.status === 'packed' || o.status === 'out_for_delivery'
    );
    if (!deliveryUser.isOnline && !activeTrip) return undefined;
    if (remindedLocationDeniedRef.current) return undefined;

    let cancelled = false;
    void inspectGeolocationPermission().then((perm) => {
      if (cancelled || perm !== 'denied' || remindedLocationDeniedRef.current) return;
      remindedLocationDeniedRef.current = true;
      void sendLocationPermissionPushReminder({
        url: activeTrip ? `/delivery/order/${activeTrip.id}` : '/delivery/dashboard',
        orderId: activeTrip?.id
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    deliveryUser?.isApproved,
    deliveryUser?.isOnline,
    assignedOrders,
    appSettings.notificationsEnabled
  ]);

  return null;
};

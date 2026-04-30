/** Static fixtures for UI-only screens (no API). */

export const MOCK_STORE_NAME = "Northside Market";

export const MOCK_KPIS = [
  { title: "Net sales", value: "₵ 12,480", period: "Last 7 days", variant: "primary" as const },
  { title: "Orders", value: "186", period: "Same period", variant: "accent" as const },
  { title: "Avg. ticket", value: "₵ 67.10", period: "Per completed sale", variant: "success" as const },
];

export const MOCK_SALES_CHART = [
  { label: "Mon", value: 820 },
  { label: "Tue", value: 1240 },
  { label: "Wed", value: 980 },
  { label: "Thu", value: 1420 },
  { label: "Fri", value: 1680 },
  { label: "Sat", value: 2100 },
  { label: "Sun", value: 1540 },
];

export const MOCK_BAR_WEEK = [
  { label: "M", sales: 42, returns: 4 },
  { label: "T", sales: 55, returns: 6 },
  { label: "W", sales: 38, returns: 3 },
  { label: "T", sales: 61, returns: 5 },
  { label: "F", sales: 72, returns: 8 },
  { label: "S", sales: 88, returns: 7 },
  { label: "S", sales: 64, returns: 4 },
];

export const MOCK_PRODUCTS = [
  { id: "p1", name: "Filtered water 500ml", stockCount: 48, lowStockThreshold: 12 },
  { id: "p2", name: "Wholewheat loaf", stockCount: 9, lowStockThreshold: 10 },
  { id: "p3", name: "Battery AA (4-pack)", stockCount: 120, lowStockThreshold: 24 },
  { id: "p4", name: "Kitchen towel 2-roll", stockCount: 3, lowStockThreshold: 8 },
  { id: "p5", name: "Orange juice 1L", stockCount: 0, lowStockThreshold: 6 },
];

export const MOCK_ORDERS = [
  {
    id: "o1",
    thumbnails: [null, null, null] as (string | null)[],
    customerName: "Ama Mensah",
    dateLabel: "Today · 2:14 PM",
    itemCount: 4,
    totalLabel: "₵ 142.50",
    isPartPayment: false,
  },
  {
    id: "o2",
    thumbnails: [null, null] as (string | null)[],
    customerName: null,
    dateLabel: "Yesterday · 6:02 PM",
    itemCount: 2,
    totalLabel: "₵ 38.00",
    isPartPayment: true,
  },
  {
    id: "o3",
    thumbnails: [null] as (string | null)[],
    customerName: "Kofi Boateng",
    dateLabel: "Apr 28 · 11:20 AM",
    itemCount: 1,
    totalLabel: "₵ 210.00",
    isPartPayment: false,
  },
];

export const MOCK_ORDER_LINES = [
  { id: "l1", name: "Filtered water 500ml", quantity: 3, unitPriceLabel: "₵ 2.50" },
  { id: "l2", name: "Wholewheat loaf", quantity: 1, unitPriceLabel: "₵ 8.00" },
  { id: "l3", name: "Battery AA (4-pack)", quantity: 2, unitPriceLabel: "₵ 12.00" },
];

export const MOCK_RETURNS = [
  { id: "r1", thumbnail: null as string | null, dateLabel: "Apr 27", itemCount: 2, totalRefundLabel: "₵ 24.00" },
  { id: "r2", thumbnail: null as string | null, dateLabel: "Apr 25", itemCount: 1, totalRefundLabel: "₵ 8.50" },
];

export const MOCK_BEST_SELLERS = [
  { rank: 1, imageUrl: null as string | null, name: "Filtered water 500ml", unitsSold: 412 },
  { rank: 2, imageUrl: null as string | null, name: "Wholewheat loaf", unitsSold: 288 },
  { rank: 3, imageUrl: null as string | null, name: "Battery AA (4-pack)", unitsSold: 196 },
  { rank: 4, imageUrl: null as string | null, name: "Orange juice 1L", unitsSold: 154 },
];

import {
  ClerkProvider,
  useAuth,
  useReverification,
  useSignIn,
  useUser,
} from '@clerk/clerk-expo';
import { tokenCache } from '@clerk/clerk-expo/token-cache';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type ScrollViewInstance,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import Svg, { Circle, G } from 'react-native-svg';

const theme = {
  colors: {
    primary: '#3478E5',
    primaryDeep: '#205FC8',
    ice: '#EAF2FF',
    paleBlue: '#F3F7FD',
    background: '#F5F8FC',
    white: '#FFFFFF',
    navy: '#14233B',
    text: '#26364D',
    secondaryText: '#77869C',
    border: '#E3EAF3',
    success: '#16A780',
    error: '#E45D6B',
    warning: '#E8A43A',
    softBorder: '#D6E5FB',
    errorSurface: '#FFF3F4',
    errorBorder: '#F9DADD',
    successSurface: '#E8F7F1',
    warningSurface: '#FFF6E8',
    dangerSurface: '#FFF7F7',
    successBorder: '#CDEDE1',
    shadow: '#1C3B67',
  },
  spacing: { xs: 6, sm: 10, md: 16, lg: 22, xl: 30, xxl: 44 },
  radius: { input: 14, card: 20, panel: 24, pill: 999 },
  motion: { fast: 180 },
} as const;

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
const TEMPORARY_CREDENTIALS_KEY = 'cocoa-erp.temporary-credentials.v1';
const TEMPORARY_CREDENTIALS_TTL_MS = 24 * 60 * 60 * 1000;
const apiUrl =
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === 'web' ? process.env.EXPO_PUBLIC_WEB_API_URL : undefined) ??
  'http://localhost:3000/api';

type Screen = 'loading' | 'auth' | 'pending' | 'connection-error' | 'email-setup' | 'admin' | 'manager' | 'worker';
type ApiError = { message?: string | string[] };
type ApiRequest = <T,>(path: string, init?: RequestInit) => Promise<T>;
type TemporaryCredentials = {
  username: string;
  password: string;
  expiresAt: number;
};
type Session = {
  kind: 'platform_admin' | 'company_manager' | 'worker';
  profile: { name: string; username: string; role?: string; specialty?: string; email?: string | null; phoneNumber?: string | null; companyId?: { name: string } | null };
};
type Manager = {
  _id: string;
  name: string;
  username: string;
  email?: string | null;
  status: 'active' | 'suspended';
  companyId: { name: string; baseCurrencyCode: string } | null;
};
type Worker = {
  _id: string;
  name: string;
  username: string;
  email?: string | null;
  phoneNumber?: string | null;
  employeeNumber: string;
  role: string;
  status: 'active' | 'suspended';
  warehouseIds?: string[];
  specialty?: string;
};
type TaskItem = {
  _id: string;
  title: string;
  description: string;
  dueAt?: string | null;
  priority: 'low' | 'normal' | 'high';
  status: 'open' | 'in_progress' | 'pending_confirmation' | 'completed';
  managerConfirmedAt?: string | null;
  workerConfirmedAt?: string | null;
  assigneeId: string | { _id: string; name: string; employeeNumber?: string; role?: string };
  truckId?: string | { _id: string; name: string; registrationNumber: string } | null;
  route?: string;
};
type Warehouse = {
  _id: string;
  id?: string;
  code: string;
  name: string;
  location?: string;
  address?: string;
  status?: string;
  lowStockThresholdKg?: string | number | null;
};
type CompanyDashboard = {
  generatedAt: string;
  currencyCode: string;
  kpis: {
    warehouses: number;
    trucks: number;
    activeTrucks: number;
    trucksOnTrip: number;
    availableTrucks: number;
    inventoryStockKg: number;
    inventoryValue: number;
    inventoryBatches: number;
    expenses: number;
    monthlyExpenses: number;
    trips: number;
    activeTrips: number;
    pendingTrips: number;
    completedTrips: number;
    transportedKg: number;
    purchases: number;
    sales: number;
    suppliers: number;
    customers: number;
    fixedAssets: number;
    assetValue: number;
    materials: number;
  };
  warehouses: {
    id: string;
    code: string;
    name: string;
    location: string;
    address: string;
    status: string;
    stockKg: number;
    inventoryValue: number;
    batches: number;
    trucks: number;
    trips: number;
    expenses: number;
  }[];
  analytics: {
    expenseByCategory: { label: string; amount: number; count: number }[];
    expenseByTruck: { id: string; amount: number; count: number }[];
    expenseByTrip: { id: string; amount: number; count: number }[];
    monthlyExpenses: { month: string; amount: number }[];
    fuelAndMaintenance: { fuel: number; maintenance: number };
    operationalVsTransportation: { operational: number; transportation: number };
  };
  dataQuality: { unconvertedExpenseCount: number; conversionError?: string };
};
type WarehouseDashboard = {
  currencyCode: string;
  warehouse: {
    id: string;
    name: string;
    code: string;
    location: string;
    address: string;
    status: string;
    createdAt: string | null;
    lowStockThresholdKg: number | null;
  };
  inventory: {
    stockKg: number;
    batchCount: number;
    inventoryValue: number;
    weightedAverageCostPerKg: number;
    lowStockBatchCount: number | null;
    batches: {
      id: string;
      lotNumber: string;
      quantityKg: number;
      unitCostPerKg: number;
      inventoryValue: number;
      status: string;
    }[];
    movements: { type: string; quantityKg: number; count: number }[];
  };
  expenses: {
    total: number;
    unconvertedCount: number;
    currencyCode: string;
    monthly: number;
    monthlyFuel: number;
    monthlyMaintenance: number;
    byCategory: { category: string; amount: number; count: number }[];
    records: {
      id: string;
      category: string;
      amount: number;
      currencyCode: string;
      paymentStatus: string;
      incurredAt: string;
      truckId: string | null;
      tripId: string | null;
      costCenterType: string;
      costCenterId: string | null;
    }[];
    filtersApplied: Record<string, string | undefined>;
    limit: number;
  };
  trucks: {
    total: number;
    active: number;
    inactive: number;
    onTrip: number;
    available: number;
    monthlyFuel: number;
    monthlyMaintenance: number;
    records: {
      id: string;
      name: string;
      registrationNumber: string;
      status: string;
      driverId: string | null;
      driverName: string | null;
      expenseTotal: number;
    }[];
  };
  trips: {
    total: number;
    completed: number;
    active: number;
    pending: number;
    cancelled: number;
    transportedKg: number;
    records: {
      id: string;
      truckId: string | null;
      truckName: string | null;
      driverId: string | null;
      driverName: string | null;
      shipmentId: string | null;
      status: string;
      transportedQuantityKg: number;
      startedAt: string | null;
      completedAt: string | null;
    }[];
  };
  materials: {
    count: number;
    movements: number;
    records: { id: string; name: string; quantityOnHand: number; unitCost: number; inventoryValue: number }[];
    movementSummary: { type: string; quantity: number; count: number }[];
  };
  operations: {
    purchases: number;
    purchaseOrders: number;
    sales: number;
    salesOrders: number;
    supplierPayments: number;
    supplierAdvances: number;
    customerPayments: number;
    customerAdvances: number;
  };
};
type ExpenseFilters = {
  from: string;
  to: string;
  category: string;
  truckId: string;
  tripId: string;
  paymentStatus: string;
};
type CompanyExpenseRecords = {
  total: number;
  count: number;
  records: {
    id: string;
    category: string;
    amount: number;
    currencyCode: string;
    paymentStatus: string;
    incurredAt: string;
    warehouseId: string;
    truckId: string | null;
    tripId: string | null;
    costCenterType: string;
    costCenterId: string;
  }[];
  limit: number;
  currencyCode: string;
  unconvertedCount: number;
  conversionError?: string;
};
type CurrencyOption = { code: string; name: string };
type ExchangeRateResponse = {
  result?: string;
  rates?: Record<string, number>;
};
type NavigationSection = { id: string; label: string; collection?: string };
type NavigationGroup = { label: string; sections: NavigationSection[] };
type ModuleRecord = Record<string, unknown>;
const AUTO_REFRESH_INTERVAL_MS = 120_000;
type ModuleRecordsResponse = {
  collection: string;
  total: number;
  limit: number;
  page: number;
  records: ModuleRecord[];
};
type ModuleField = {
  name: string;
  label: string;
  type?: 'text' | 'textarea' | 'decimal' | 'date' | 'select' | 'reference' | 'category' | 'currency' | 'checkbox';
  required?: boolean;
  source?: string;
  choices?: string[];
  placeholder?: string;
};
const EMPTY_MODULE_FIELDS: ModuleField[] = [];

const workerJobRoles = [
  { value: 'warehouse_operator', label: 'Warehouse operator' },
  { value: 'inventory_clerk', label: 'Inventory clerk' },
  { value: 'driver', label: 'Driver' },
  { value: 'accountant', label: 'Accountant' },
  { value: 'sales_representative', label: 'Sales representative' },
  { value: 'purchasing_officer', label: 'Purchasing officer' },
  { value: 'other', label: 'Other' },
] as const;
const driverSpecialties = [
  { value: 'heavy_vehicle', label: 'Heavy vehicles' },
  { value: 'long_distance', label: 'Long-distance routes' },
  { value: 'local_delivery', label: 'Local delivery' },
  { value: 'defensive_driving', label: 'Defensive driving' },
  { value: 'route_planning', label: 'Route planning' },
  { value: 'vehicle_inspection', label: 'Vehicle inspection' },
  { value: 'hazardous_materials', label: 'Hazardous materials' },
  { value: 'loading_and_unloading', label: 'Loading and unloading' },
] as const;

function driverSpecialtyLabel(value: string) {
  return driverSpecialties.find((specialty) => specialty.value === value)?.label
    ?? value.replace(/_/g, ' ');
}

function workerRoleLabel(role: string) {
  return workerJobRoles.find((item) => item.value === role)?.label
    ?? role.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const moduleFields: Record<string, ModuleField[]> = {
  companies: [
    { name: 'name', label: 'Company name', required: true },
    { name: 'baseCurrencyCode', label: 'Company currency', type: 'currency', required: true },
  ],
  journalEntries: [
    { name: 'entryNumber', label: 'Entry number', required: true },
    { name: 'description', label: 'Description', type: 'textarea', required: true },
    { name: 'entryDate', label: 'Entry date', type: 'date', required: true },
    { name: 'reference', label: 'Reference' },
    { name: 'status', label: 'Status', type: 'select', choices: ['draft', 'posted', 'void'] },
  ],
  journalLines: [
    { name: 'journalEntryId', label: 'Journal entry', type: 'reference', source: 'journalEntries', required: true },
    { name: 'accountId', label: 'Account', type: 'reference', source: 'accounts', required: true },
    { name: 'description', label: 'Description' },
    { name: 'debit', label: 'Debit', type: 'decimal' },
    { name: 'credit', label: 'Credit', type: 'decimal' },
  ],
  documents: [
    { name: 'title', label: 'Document title', required: true },
    { name: 'documentType', label: 'Document type', type: 'select', choices: ['invoice', 'receipt', 'contract', 'delivery_note', 'other'], required: true },
    { name: 'relatedEntityType', label: 'Related record type', type: 'select', choices: ['warehouses', 'products', 'trucks', 'trips', 'suppliers', 'customers', 'purchases', 'sales', 'assets'] },
    { name: 'relatedEntityId', label: 'Related record', type: 'reference', source: 'relatedEntity' },
    { name: 'fileUrl', label: 'Document URL' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ],
  auditLogs: [
    { name: 'action', label: 'Action', required: true },
    { name: 'entityType', label: 'Record type', required: true },
    { name: 'entityId', label: 'Record reference' },
    { name: 'description', label: 'Details', type: 'textarea' },
  ],
  products: [
    { name: 'sku', label: 'SKU', required: true },
    { name: 'name', label: 'Product name', required: true },
    { name: 'category', label: 'Category' },
    { name: 'unit', label: 'Unit', type: 'select', choices: ['kg', 'bag', 'piece', 'ton', 'other'], required: true },
    { name: 'defaultUnitCost', label: 'Default unit cost', type: 'decimal' },
    { name: 'status', label: 'Status', type: 'select', choices: ['active', 'inactive'] },
  ],
  cocoaLots: [
    { name: 'warehouseId', label: 'Warehouse', type: 'reference', source: 'warehouses', required: true },
    { name: 'lotNumber', label: 'Batch / lot number', required: true },
    { name: 'receivedQuantityKg', label: 'Received quantity (kg)', type: 'decimal', required: true },
    { name: 'remainingQuantityKg', label: 'Current quantity (kg)', type: 'decimal', required: true },
    { name: 'unitCostPerKg', label: 'Cost per kg', type: 'decimal', required: true },
    { name: 'inventoryValue', label: 'Inventory value', type: 'decimal', required: true },
    { name: 'status', label: 'Status', type: 'select', choices: ['available', 'depleted', 'quarantined'] },
  ],
  stockMovements: [
    { name: 'warehouseId', label: 'Warehouse', type: 'reference', source: 'warehouses', required: true },
    { name: 'lotId', label: 'Inventory batch', type: 'reference', source: 'cocoaLots', required: true },
    { name: 'movementType', label: 'Movement', type: 'select', choices: ['incoming', 'outgoing', 'transfer'], required: true },
    { name: 'quantityKg', label: 'Quantity (kg)', type: 'decimal', required: true },
    { name: 'unitCostPerKg', label: 'Cost per kg', type: 'decimal', required: true },
    { name: 'occurredAt', label: 'Movement date', type: 'date' },
  ],
  materials: [
    { name: 'warehouseId', label: 'Warehouse', type: 'reference', source: 'warehouses', required: true },
    { name: 'name', label: 'Material name', required: true },
    { name: 'quantityOnHand', label: 'Quantity on hand', type: 'decimal', required: true },
    { name: 'unitCost', label: 'Unit cost', type: 'decimal', required: true },
  ],
  materialMovements: [
    { name: 'warehouseId', label: 'Warehouse', type: 'reference', source: 'warehouses', required: true },
    { name: 'materialId', label: 'Material', type: 'reference', source: 'materials', required: true },
    { name: 'movementType', label: 'Movement', type: 'select', choices: ['incoming', 'consumed', 'transfer'], required: true },
    { name: 'quantity', label: 'Quantity', type: 'decimal', required: true },
    { name: 'occurredAt', label: 'Movement date', type: 'date', required: true },
  ],
  suppliers: [
    { name: 'name', label: 'Supplier name', required: true },
    { name: 'contactName', label: 'Contact person' },
    { name: 'phone', label: 'Phone' },
    { name: 'email', label: 'Email' },
    { name: 'address', label: 'Address', type: 'textarea' },
    { name: 'taxNumber', label: 'Tax number' },
    { name: 'status', label: 'Status', type: 'select', choices: ['active', 'inactive'] },
  ],
  purchaseOrders: [
    { name: 'warehouseId', label: 'Warehouse', type: 'reference', source: 'warehouses', required: true },
    { name: 'supplierId', label: 'Supplier', type: 'reference', source: 'suppliers', required: true },
    { name: 'orderNumber', label: 'Order number', required: true },
    { name: 'orderDate', label: 'Order date', type: 'date', required: true },
    { name: 'expectedDate', label: 'Expected date', type: 'date' },
    { name: 'totalAmount', label: 'Order total', type: 'decimal' },
    { name: 'status', label: 'Status', type: 'select', choices: ['draft', 'ordered', 'partially_received', 'received', 'cancelled'] },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ],
  purchases: [
    { name: 'warehouseId', label: 'Warehouse', type: 'reference', source: 'warehouses', required: true },
    { name: 'supplierId', label: 'Supplier', type: 'reference', source: 'suppliers', required: true },
    { name: 'purchaseOrderId', label: 'Purchase order', type: 'reference', source: 'purchaseOrders' },
    { name: 'invoiceNumber', label: 'Supplier invoice number', required: true },
    { name: 'receivedAt', label: 'Received date', type: 'date', required: true },
    { name: 'totalAmount', label: 'Purchase total', type: 'decimal', required: true },
    { name: 'freightAmount', label: 'Incidental / freight cost', type: 'decimal' },
    { name: 'currencyCode', label: 'Currency', type: 'currency', required: true },
    { name: 'paymentStatus', label: 'Payment status', type: 'select', choices: ['unpaid', 'partial', 'paid'] },
  ],
  supplierPayments: [
    { name: 'warehouseId', label: 'Warehouse', type: 'reference', source: 'warehouses', required: true },
    { name: 'supplierId', label: 'Supplier', type: 'reference', source: 'suppliers', required: true },
    { name: 'purchaseId', label: 'Purchase invoice', type: 'reference', source: 'purchases' },
    { name: 'amount', label: 'Payment amount', type: 'decimal', required: true },
    { name: 'currencyCode', label: 'Currency', type: 'currency', required: true },
    { name: 'paidAt', label: 'Payment date', type: 'date', required: true },
    { name: 'paymentMethod', label: 'Payment method', type: 'select', choices: ['cash', 'bank_transfer', 'check', 'other'] },
    { name: 'reference', label: 'Reference' },
  ],
  supplierAdvances: [
    { name: 'warehouseId', label: 'Warehouse', type: 'reference', source: 'warehouses', required: true },
    { name: 'supplierId', label: 'Supplier', type: 'reference', source: 'suppliers', required: true },
    { name: 'amount', label: 'Advance amount', type: 'decimal', required: true },
    { name: 'currencyCode', label: 'Currency', type: 'currency', required: true },
    { name: 'receivedAt', label: 'Advance date', type: 'date', required: true },
    { name: 'reference', label: 'Reference' },
  ],
  customers: [
    { name: 'name', label: 'Customer name', required: true },
    { name: 'contactName', label: 'Contact person' },
    { name: 'phone', label: 'Phone' },
    { name: 'email', label: 'Email' },
    { name: 'address', label: 'Address', type: 'textarea' },
    { name: 'taxNumber', label: 'Tax number' },
    { name: 'status', label: 'Status', type: 'select', choices: ['active', 'inactive'] },
  ],
  salesOrders: [
    { name: 'warehouseId', label: 'Warehouse', type: 'reference', source: 'warehouses', required: true },
    { name: 'customerId', label: 'Customer', type: 'reference', source: 'customers', required: true },
    { name: 'orderNumber', label: 'Order number', required: true },
    { name: 'orderDate', label: 'Order date', type: 'date', required: true },
    { name: 'totalAmount', label: 'Order total', type: 'decimal' },
    { name: 'status', label: 'Status', type: 'select', choices: ['draft', 'confirmed', 'partially_shipped', 'shipped', 'cancelled'] },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ],
  sales: [
    { name: 'warehouseId', label: 'Warehouse', type: 'reference', source: 'warehouses', required: true },
    { name: 'customerId', label: 'Customer', type: 'reference', source: 'customers', required: true },
    { name: 'salesOrderId', label: 'Sales order', type: 'reference', source: 'salesOrders' },
    { name: 'invoiceNumber', label: 'Sales invoice number', required: true },
    { name: 'soldAt', label: 'Sale date', type: 'date', required: true },
    { name: 'totalAmount', label: 'Invoice total', type: 'decimal', required: true },
    { name: 'currencyCode', label: 'Currency', type: 'currency', required: true },
    { name: 'paymentStatus', label: 'Payment status', type: 'select', choices: ['unpaid', 'partial', 'paid'] },
  ],
  customerPayments: [
    { name: 'warehouseId', label: 'Warehouse', type: 'reference', source: 'warehouses', required: true },
    { name: 'customerId', label: 'Customer', type: 'reference', source: 'customers', required: true },
    { name: 'saleId', label: 'Sales invoice', type: 'reference', source: 'sales' },
    { name: 'amount', label: 'Payment amount', type: 'decimal', required: true },
    { name: 'currencyCode', label: 'Currency', type: 'currency', required: true },
    { name: 'paidAt', label: 'Payment date', type: 'date', required: true },
    { name: 'paymentMethod', label: 'Payment method', type: 'select', choices: ['cash', 'bank_transfer', 'check', 'other'] },
    { name: 'reference', label: 'Reference' },
  ],
  customerAdvances: [
    { name: 'warehouseId', label: 'Warehouse', type: 'reference', source: 'warehouses', required: true },
    { name: 'customerId', label: 'Customer', type: 'reference', source: 'customers', required: true },
    { name: 'amount', label: 'Advance amount', type: 'decimal', required: true },
    { name: 'currencyCode', label: 'Currency', type: 'currency', required: true },
    { name: 'receivedAt', label: 'Advance date', type: 'date', required: true },
    { name: 'reference', label: 'Reference' },
  ],
  trucks: [
    { name: 'warehouseId', label: 'Warehouse', type: 'reference', source: 'warehouses', required: true },
    { name: 'name', label: 'Truck name', required: true },
    { name: 'registrationNumber', label: 'Registration number', required: true },
    { name: 'driverId', label: 'Assigned driver', type: 'reference', source: 'accounts' },
    { name: 'status', label: 'Status', type: 'select', choices: ['active', 'inactive', 'sold', 'disposed'] },
  ],
  trips: [
    { name: 'warehouseId', label: 'Warehouse', type: 'reference', source: 'warehouses', required: true },
    { name: 'truckId', label: 'Truck', type: 'reference', source: 'trucks', required: true },
    { name: 'driverId', label: 'Driver', type: 'reference', source: 'accounts' },
    { name: 'shipmentId', label: 'Sales / shipment', type: 'reference', source: 'sales' },
    { name: 'status', label: 'Status', type: 'select', choices: ['pending', 'active', 'completed', 'cancelled'], required: true },
    { name: 'transportedQuantityKg', label: 'Transported quantity (kg)', type: 'decimal' },
    { name: 'startedAt', label: 'Start date', type: 'date' },
    { name: 'completedAt', label: 'Completion date', type: 'date' },
  ],
  truckExpenses: [
    { name: 'warehouseId', label: 'Warehouse', type: 'reference', source: 'warehouses', required: true },
    { name: 'truckId', label: 'Truck', type: 'reference', source: 'trucks', required: true },
    { name: 'tripId', label: 'Trip', type: 'reference', source: 'trips' },
    { name: 'category', label: 'Expense category', type: 'category', required: true },
    { name: 'amount', label: 'Amount', type: 'decimal', required: true },
    { name: 'currencyCode', label: 'Currency', type: 'currency', required: true },
    { name: 'incurredAt', label: 'Expense date', type: 'date', required: true },
  ],
  fuelLogs: [
    { name: 'truckId', label: 'Truck', type: 'reference', source: 'trucks', required: true },
    { name: 'tripId', label: 'Trip', type: 'reference', source: 'trips' },
    { name: 'quantityLiters', label: 'Fuel (liters)', type: 'decimal', required: true },
    { name: 'unitPrice', label: 'Price per liter', type: 'decimal', required: true },
    { name: 'currencyCode', label: 'Currency', type: 'currency', required: true },
    { name: 'occurredAt', label: 'Fuel date', type: 'date' },
  ],
  maintenance: [
    { name: 'warehouseId', label: 'Warehouse', type: 'reference', source: 'warehouses', required: true },
    { name: 'truckId', label: 'Truck', type: 'reference', source: 'trucks', required: true },
    { name: 'description', label: 'Repair / parts / service', type: 'textarea', required: true },
    { name: 'status', label: 'Status', type: 'select', choices: ['scheduled', 'in_progress', 'completed', 'cancelled'] },
    { name: 'occurredAt', label: 'Maintenance date', type: 'date' },
  ],
  truckDisposals: [
    { name: 'truckId', label: 'Truck', type: 'reference', source: 'trucks', required: true },
    { name: 'disposedAt', label: 'Disposal date', type: 'date', required: true },
    { name: 'salePrice', label: 'Sale proceeds', type: 'decimal', required: true },
    { name: 'currencyCode', label: 'Currency', type: 'currency', required: true },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ],
  assets: [
    { name: 'warehouseId', label: 'Warehouse', type: 'reference', source: 'warehouses' },
    { name: 'name', label: 'Asset name', required: true },
    { name: 'assetNumber', label: 'Asset number', required: true },
    { name: 'acquisitionCost', label: 'Acquisition cost', type: 'decimal', required: true },
    { name: 'acquiredAt', label: 'Acquisition date', type: 'date', required: true },
    { name: 'usefulLifeMonths', label: 'Useful life (months)', type: 'decimal' },
    { name: 'residualValue', label: 'Residual value', type: 'decimal' },
    { name: 'status', label: 'Status', type: 'select', choices: ['active', 'disposed'] },
  ],
  assetDepreciations: [
    { name: 'assetId', label: 'Asset', type: 'reference', source: 'assets', required: true },
    { name: 'period', label: 'Depreciation period', required: true },
    { name: 'depreciationAmount', label: 'Depreciation amount', type: 'decimal', required: true },
    { name: 'postedAt', label: 'Posting date', type: 'date', required: true },
  ],
  assetDisposals: [
    { name: 'assetId', label: 'Asset', type: 'reference', source: 'assets', required: true },
    { name: 'disposedAt', label: 'Disposal date', type: 'date', required: true },
    { name: 'salePrice', label: 'Sale proceeds', type: 'decimal', required: true },
    { name: 'currencyCode', label: 'Currency', type: 'currency', required: true },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ],
  assetMovements: [
    { name: 'assetId', label: 'Asset', type: 'reference', source: 'assets', required: true },
    { name: 'movementType', label: 'Movement type', type: 'select', choices: ['warehouse_transfer', 'assignment', 'disposal'], required: true },
    { name: 'fromWarehouseId', label: 'From warehouse', type: 'reference', source: 'warehouses' },
    { name: 'toWarehouseId', label: 'To warehouse', type: 'reference', source: 'warehouses' },
    { name: 'movedAt', label: 'Movement date', type: 'date', required: true },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ],
  expenses: [
    { name: 'warehouseId', label: 'Warehouse', type: 'reference', source: 'warehouses', required: true },
    { name: 'category', label: 'Expense category', type: 'category', required: true },
    { name: 'truckId', label: 'Link to truck (optional)', type: 'reference', source: 'trucks' },
    { name: 'costCenterType', label: 'Cost center type', type: 'select', choices: ['warehouse', 'truck', 'trip'], required: true },
    { name: 'costCenterId', label: 'Cost center', type: 'reference', source: 'costCenter', required: true },
    { name: 'tripId', label: 'Trip', type: 'reference', source: 'trips' },
    { name: 'amount', label: 'Amount', type: 'decimal', required: true },
    { name: 'currencyCode', label: 'Currency', type: 'currency', required: true },
    { name: 'paymentStatus', label: 'Payment status', type: 'select', choices: ['unpaid', 'partial', 'paid'] },
    { name: 'incurredAt', label: 'Expense date', type: 'date' },
    { name: 'description', label: 'Description', type: 'textarea' },
  ],
  expenseCategories: [
    { name: 'name', label: 'Category name', required: true },
    { name: 'code', label: 'Category code' },
    { name: 'description', label: 'Description', type: 'textarea' },
    { name: 'status', label: 'Status', type: 'select', choices: ['active', 'inactive'] },
  ],
  costCenters: [
    { name: 'name', label: 'Cost center name', required: true },
    { name: 'costCenterType', label: 'Type', type: 'select', choices: ['warehouse', 'truck', 'trip'], required: true },
    { name: 'referenceId', label: 'Warehouse / truck / trip', type: 'reference', source: 'costCenter', required: true },
    { name: 'code', label: 'Code' },
    { name: 'status', label: 'Status', type: 'select', choices: ['active', 'inactive'] },
  ],
};

const warehouseModulesByTab: Record<string, string[]> = {
  inventory: ['cocoaLots', 'stockMovements'],
  expenses: ['expenses'],
  trucks: ['trucks', 'truckExpenses', 'fuelLogs', 'maintenance'],
  trips: ['trips', 'sales', 'salesOrders'],
  materials: ['materials', 'materialMovements'],
  commercial: [
    'purchases',
    'purchaseOrders',
    'supplierPayments',
    'supplierAdvances',
    'sales',
    'salesOrders',
    'customerPayments',
    'customerAdvances',
  ],
};

const relatedEntityCollections: Record<string, string> = {
  assets: 'assets',
  customers: 'customers',
  products: 'products',
  purchases: 'purchases',
  sales: 'sales',
  suppliers: 'suppliers',
  trips: 'trips',
  trucks: 'trucks',
  warehouses: 'warehouses',
};

function moduleOptionSource(field: ModuleField, draft: ModuleRecord): string {
  if (field.type === 'category') return field.source ?? 'expenseCategories';
  if (field.source === 'costCenter') {
    return draft.costCenterType === 'truck'
      ? 'trucks'
      : draft.costCenterType === 'trip'
        ? 'trips'
        : 'warehouses';
  }
  if (field.source === 'relatedEntity') {
    return typeof draft.relatedEntityType === 'string'
      ? relatedEntityCollections[draft.relatedEntityType] ?? ''
      : '';
  }
  return field.source ?? '';
}

function moduleOptionMatchesWarehouse(
  source: string,
  option: ModuleRecord,
  warehouseId?: string,
): boolean {
  if (!warehouseId || source === 'customers') return true;
  if (!option.warehouseId) return source !== 'trucks';
  return String(option.warehouseId) === warehouseId;
}

const managerNavigation: NavigationGroup[] = [
  { label: 'WORKSPACE', sections: [{ id: 'overview', label: 'Overview' }, { id: 'companyProfile', label: 'Company profile', collection: 'companies' }, { id: 'workers', label: 'Team accounts', collection: 'accounts' }, { id: 'tasks', label: 'Worker tasks' }, { id: 'warehouses', label: 'Warehouses', collection: 'warehouses' }] },
  { label: 'CORE', sections: [{ id: 'journalEntries', label: 'Journal entries', collection: 'journalEntries' }, { id: 'journalLines', label: 'Journal lines', collection: 'journalLines' }, { id: 'documents', label: 'Documents', collection: 'documents' }, { id: 'auditLogs', label: 'Audit log', collection: 'auditLogs' }] },
  { label: 'INVENTORY', sections: [{ id: 'products', label: 'Products', collection: 'products' }, { id: 'cocoaLots', label: 'Inventory batches', collection: 'cocoaLots' }, { id: 'stockMovements', label: 'Stock movements', collection: 'stockMovements' }, { id: 'materials', label: 'Materials', collection: 'materials' }, { id: 'materialMovements', label: 'Material movements', collection: 'materialMovements' }] },
  { label: 'PURCHASING', sections: [{ id: 'suppliers', label: 'Suppliers', collection: 'suppliers' }, { id: 'purchaseOrders', label: 'Purchase orders', collection: 'purchaseOrders' }, { id: 'purchases', label: 'Purchases', collection: 'purchases' }, { id: 'supplierPayments', label: 'Supplier payments', collection: 'supplierPayments' }, { id: 'supplierAdvances', label: 'Supplier advances', collection: 'supplierAdvances' }] },
  { label: 'SALES', sections: [{ id: 'customers', label: 'Customers', collection: 'customers' }, { id: 'salesOrders', label: 'Sales orders', collection: 'salesOrders' }, { id: 'sales', label: 'Sales', collection: 'sales' }, { id: 'customerPayments', label: 'Customer payments', collection: 'customerPayments' }, { id: 'customerAdvances', label: 'Customer advances', collection: 'customerAdvances' }] },
  { label: 'TRANSPORT', sections: [{ id: 'trucks', label: 'Trucks', collection: 'trucks' }, { id: 'trips', label: 'Trips', collection: 'trips' }, { id: 'truckExpenses', label: 'Truck expenses', collection: 'truckExpenses' }, { id: 'fuelLogs', label: 'Fuel logs', collection: 'fuelLogs' }, { id: 'maintenance', label: 'Maintenance', collection: 'maintenance' }, { id: 'truckDisposals', label: 'Truck disposals', collection: 'truckDisposals' }] },
  { label: 'ASSETS', sections: [{ id: 'assets', label: 'Fixed assets', collection: 'assets' }, { id: 'assetDepreciations', label: 'Depreciations', collection: 'assetDepreciations' }, { id: 'assetDisposals', label: 'Asset disposals', collection: 'assetDisposals' }, { id: 'assetMovements', label: 'Asset movements', collection: 'assetMovements' }] },
  { label: 'EXPENSES', sections: [{ id: 'expenses', label: 'Expenses', collection: 'expenses' }, { id: 'expenseCategories', label: 'Expense categories', collection: 'expenseCategories' }, { id: 'costCenters', label: 'Cost centers', collection: 'costCenters' }] },
  { label: 'ACCOUNT', sections: [{ id: 'account', label: 'Account' }] },
];

const currenciesApiUrl = 'https://open.er-api.com/v6/latest/USD';

function normalizePhoneNumber(value: string): string {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';

  if (trimmed.startsWith('+') || digits.startsWith('00') || digits.startsWith('961')) {
    const internationalDigits = digits.startsWith('00')
      ? digits.slice(2)
      : digits;
    const normalizedDigits = internationalDigits.startsWith('9610')
      ? `961${internationalDigits.slice(4)}`
      : internationalDigits;
    return `+${normalizedDigits}`;
  }

  const nationalDigits = digits.startsWith('0') ? digits.slice(1) : digits;
  return `+961${nationalDigits}`;
}

function isValidPhoneNumber(value: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(normalizePhoneNumber(value));
}

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      {publishableKey ? (
        <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
          <AppShell />
        </ClerkProvider>
      ) : (
        <SafeAreaView style={styles.centered}>
          <Text style={styles.brand}>ManageNest</Text>
          <Text style={styles.muted}>
            Clerk authentication is not configured in this build. Set
            EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in the EAS environment and rebuild the app.
          </Text>
        </SafeAreaView>
      )}
    </SafeAreaProvider>
  );
}

function AppShell() {
  const { isLoaded, isSignedIn, getToken, signOut } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const [screen, setScreen] = useState<Screen>('loading');
  const screenEntrance = useRef(new Animated.Value(0)).current;
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [managers, setManagers] = useState<Manager[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [createdCredentials, setCreatedCredentials] = useState<TemporaryCredentials | null>(null);
  const [credentialsLoaded, setCredentialsLoaded] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const loadCredentials = async () => {
      const saved = Platform.OS === 'web'
        ? window.localStorage.getItem(TEMPORARY_CREDENTIALS_KEY)
        : await SecureStore.getItemAsync(TEMPORARY_CREDENTIALS_KEY);
      if (saved) {
        const credentials = JSON.parse(saved) as TemporaryCredentials;
        if (
          typeof credentials.username === 'string' &&
          typeof credentials.password === 'string' &&
          typeof credentials.expiresAt === 'number' &&
          credentials.expiresAt > Date.now()
        ) {
          if (active) setCreatedCredentials(credentials);
        } else if (Platform.OS === 'web') {
          window.localStorage.removeItem(TEMPORARY_CREDENTIALS_KEY);
        } else {
          await SecureStore.deleteItemAsync(TEMPORARY_CREDENTIALS_KEY);
        }
      }
      if (active) setCredentialsLoaded(true);
    };
    void loadCredentials().catch((cause: unknown) => {
      if (active) {
        setError(cause instanceof Error ? `Unable to restore saved temporary credentials: ${cause.message}` : 'Unable to restore saved temporary credentials');
        setCredentialsLoaded(true);
      }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!credentialsLoaded) return;
    const persistCredentials = async () => {
      if (!createdCredentials) {
        if (Platform.OS === 'web') window.localStorage.removeItem(TEMPORARY_CREDENTIALS_KEY);
        else await SecureStore.deleteItemAsync(TEMPORARY_CREDENTIALS_KEY);
        return;
      }
      const serialized = JSON.stringify(createdCredentials);
      if (Platform.OS === 'web') window.localStorage.setItem(TEMPORARY_CREDENTIALS_KEY, serialized);
      else await SecureStore.setItemAsync(TEMPORARY_CREDENTIALS_KEY, serialized);
    };
    void persistCredentials().catch((cause: unknown) => {
      setError(cause instanceof Error ? `Unable to save temporary credentials securely: ${cause.message}` : 'Unable to save temporary credentials securely');
    });
  }, [createdCredentials, credentialsLoaded]);

  useEffect(() => {
    if (!createdCredentials) return;
    const remaining = createdCredentials.expiresAt - Date.now();
    if (remaining <= 0) {
      setCreatedCredentials(null);
      return;
    }
    const timeout = setTimeout(() => setCreatedCredentials(null), remaining);
    return () => clearTimeout(timeout);
  }, [createdCredentials]);

  const request = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const token = await getTokenRef.current();
      let response: Response;
      const requestController = new AbortController();
      let requestTimedOut = false;
      const requestTimeout = setTimeout(() => {
        requestTimedOut = true;
        requestController.abort();
      }, 12_000);
      try {
        response = await fetch(`${apiUrl}${path}`, {
          ...init,
          cache: init.cache ?? 'no-store',
          signal: init.signal ?? requestController.signal,
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...init.headers,
          },
        });
      } catch (cause) {
        if (requestTimedOut || (cause instanceof Error && cause.name === 'AbortError')) {
          throw new Error('The API request timed out. Check your internet connection and try again. The API may be starting after a period of inactivity.');
        }
        if (cause instanceof TypeError) {
          throw new Error(`Unable to reach the API at ${apiUrl}. Check your internet connection and try again.`);
        }
        throw cause;
      } finally {
        clearTimeout(requestTimeout);
      }
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Your session has expired. Please sign out and sign in again.');
        }
        const body = (await response.json().catch(() => ({}))) as ApiError;
        const message = Array.isArray(body.message)
          ? body.message.join(', ')
          : body.message;
        throw new Error(message || `Request failed (${response.status})`);
      }
      return response.json() as Promise<T>;
    },
    [],
  );

  const refreshManagerData = useCallback(async () => {
    const [currentSession, companyWorkers, companyWarehouses] = await Promise.all([
      request<Session>('/session'),
      request<Worker[]>('/workers'),
      request<Warehouse[]>('/warehouses'),
    ]);
    setSession(currentSession);
    setWorkers(companyWorkers);
    setWarehouses(companyWarehouses);
  }, [request]);
  const refreshWarehouses = useCallback(async () => {
    const [listed, dashboard, moduleRecords] = await Promise.allSettled([
      request<unknown>('/warehouses'),
      request<CompanyDashboard>('/dashboard/company'),
      request<unknown>('/dashboard/modules/warehouses'),
    ]);
    const warehouseById = new Map<string, Warehouse>();
    const addWarehouse = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      const rawId = record._id ?? record.id;
      const id = typeof rawId === 'string'
        ? rawId
        : rawId && typeof rawId === 'object' && 'toString' in rawId
          ? String(rawId)
          : '';
      if (!id || typeof record.name !== 'string') return;
      const warehouse: Warehouse = {
        _id: id,
        id,
        name: record.name,
        code: typeof record.code === 'string' ? record.code : '',
        location: typeof record.location === 'string' ? record.location : '',
        address: typeof record.address === 'string' ? record.address : '',
        status: typeof record.status === 'string' ? record.status : undefined,
      };
      warehouseById.set(id, warehouse);
    };
    const addRecords = (value: unknown) => {
      const records = Array.isArray(value)
        ? value
        : value && typeof value === 'object' && 'records' in value &&
            Array.isArray(value.records)
          ? value.records
          : [];
      records.forEach(addWarehouse);
    };

    if (listed.status === 'fulfilled') addRecords(listed.value);
    if (dashboard.status === 'fulfilled') {
      addRecords(dashboard.value.warehouses);
    }
    if (moduleRecords.status === 'fulfilled') addRecords(moduleRecords.value);

    const companyWarehouses = [...warehouseById.values()];
    if (companyWarehouses.length === 0) {
      const errors = [listed, dashboard, moduleRecords]
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason instanceof Error ? result.reason.message : 'Unknown request error');
      throw new Error(errors.length
        ? `Unable to load warehouses: ${[...new Set(errors)].join('; ')}`
        : 'No warehouse records were returned for this company.');
    }
    setWarehouses(companyWarehouses);
    return companyWarehouses;
  }, [request]);

  const refreshAdminData = useCallback(async () => {
    setManagers(await request<Manager[]>('/admin/managers'));
  }, [request]);

  const refreshSessionData = useCallback(async () => {
    setSession(await request<Session>('/session'));
  }, [request]);

  const loadSession = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const current = await request<Session>('/session');
      setSession(current);
      if (!current.profile.email) {
        setScreen('email-setup');
        return;
      }
      if (current.kind === 'platform_admin') {
        setManagers(await request<Manager[]>('/admin/managers'));
        setScreen('admin');
      } else if (current.kind === 'company_manager') {
        const [companyWorkers, companyWarehouses] = await Promise.all([
          request<Worker[]>('/workers'),
          request<Warehouse[]>('/warehouses'),
        ]);
        setWorkers(companyWorkers);
        setWarehouses(companyWarehouses);
        setScreen('manager');
      } else {
        setScreen('worker');
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to load account';
      if (message.includes('No company account')) {
        setSession(null);
        setScreen('pending');
        setError('This Clerk login has no active ManageNest account. Ask your administrator to create or enable your account.');
      } else {
        setError(message);
        setScreen('connection-error');
      }
    } finally {
      setBusy(false);
    }
  }, [request]);

  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn) void loadSession();
    else {
      setSession(null);
      setScreen('auth');
    }
  }, [isLoaded, isSignedIn, loadSession]);

  useEffect(() => {
    screenEntrance.setValue(0);
    Animated.timing(screenEntrance, {
      toValue: 1,
      duration: theme.motion.fast,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [screen, screenEntrance]);

  const runAction = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The request failed');
    } finally {
      setBusy(false);
    }
  };

  const createManager = async (input: {
    name: string;
    username: string;
    companyName: string;
  }) => runAction(async () => {
    const result = await request<{
      manager: { username: string };
      initialPassword: string;
    }>('/admin/managers', { method: 'POST', body: JSON.stringify(input) });
    setCreatedCredentials({ username: result.manager.username, password: result.initialPassword, expiresAt: Date.now() + TEMPORARY_CREDENTIALS_TTL_MS });
    setManagers(await request<Manager[]>('/admin/managers'));
  });

  const updateManager = async (id: string, input: { name?: string; username?: string; companyName?: string; status?: string }) =>
    runAction(async () => {
      await request(`/admin/managers/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
      setManagers(await request<Manager[]>('/admin/managers'));
    });

  const deleteManager = async (id: string) => runAction(async () => {
    await request(`/admin/managers/${id}`, { method: 'DELETE' });
    setManagers(await request<Manager[]>('/admin/managers'));
  });

  const createWorker = async (input: {
    name: string;
    username: string;
    phoneNumber: string;
    employeeNumber: string;
    role: string;
    warehouseIds?: string[];
    specialty?: string;
  }) => runAction(async () => {
    const result = await request<{ worker: Worker; initialPassword: string }>('/workers', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    setCreatedCredentials({ username: input.username, password: result.initialPassword, expiresAt: Date.now() + TEMPORARY_CREDENTIALS_TTL_MS });
    setWorkers(await request<Worker[]>('/workers'));
  });

  const updateWorker = async (id: string, input: { name?: string; username?: string; employeeNumber?: string; phoneNumber?: string; role?: string; status?: string; warehouseIds?: string[]; specialty?: string }) =>
    runAction(async () => {
      await request(`/workers/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
      setWorkers(await request<Worker[]>('/workers'));
    });

  const deleteWorker = async (id: string) => runAction(async () => {
    await request(`/workers/${id}`, { method: 'DELETE' });
    setWorkers(await request<Worker[]>('/workers'));
  });

  const createWarehouse = async (
    code: string,
    name: string,
    lowStockThresholdKg?: number,
    location?: string,
    address?: string,
  ) => runAction(async () => {
    await request('/warehouses', {
      method: 'POST',
      body: JSON.stringify({ code, name, lowStockThresholdKg, location, address }),
    });
    setWarehouses(await request<Warehouse[]>('/warehouses'));
  });

  if (!isLoaded || screen === 'loading' || (isSignedIn && screen === 'auth')) {
    return <Loading />;
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'right', 'bottom', 'left']}>
      <StatusBar style="dark" />
      <Animated.View
        style={[
          styles.flex,
          {
            opacity: screenEntrance,
            transform: [
              {
                translateY: screenEntrance.interpolate({
                  inputRange: [0, 1],
                  outputRange: [5, 0],
                }),
              },
            ],
          },
        ]}
      >
      {screen === 'auth' && (
        <AuthScreen
          error={error}
          busy={busy}
          onSignedIn={loadSession}
        />
      )}
      {screen === 'pending' && (
        <MessageScreen
          title="Account not assigned"
          message={error}
          actionLabel="Sign out"
          onAction={() => signOut()}
        />
      )}
      {screen === 'connection-error' && (
        <MessageScreen
          title="Workspace unavailable"
          message={error}
          actionLabel={busy ? 'Retrying…' : 'Retry connection'}
          onAction={() => void loadSession()}
          secondaryActionLabel="Sign out"
          onSecondaryAction={() => void signOut()}
        />
      )}
      {screen === 'email-setup' && (
        <EmailSetupScreen
          request={request}
          error={error}
          onComplete={loadSession}
          onChangePassword={() => setChangePasswordOpen(true)}
        />
      )}
      {screen === 'admin' && (
        <AdminDashboard
          session={session}
          adminName={session?.profile.name ?? 'Administrator'}
          managers={managers}
          error={error}
          busy={busy}
          credentials={createdCredentials}
          onCreate={createManager}
          onUpdate={updateManager}
          onDelete={deleteManager}
          onRefresh={refreshAdminData}
          onChangePassword={() => setChangePasswordOpen(true)}
          onSignOut={() => signOut()}
        />
      )}
      {screen === 'manager' && (
        <ManagerDashboard
          session={session}
          workers={workers}
          warehouses={warehouses}
          request={request}
          error={error}
          busy={busy}
          credentials={createdCredentials}
          onCreateWorker={createWorker}
          onUpdateWorker={updateWorker}
          onDeleteWorker={deleteWorker}
          onCreateWarehouse={createWarehouse}
          onRefreshManagerData={refreshManagerData}
          onRefreshWarehouses={refreshWarehouses}
          onChangePassword={() => setChangePasswordOpen(true)}
          onSignOut={() => signOut()}
        />
      )}
      {screen === 'worker' && (
        <WorkerWorkspace
          session={session}
          request={request}
          onRefreshSession={refreshSessionData}
          onSignOut={() => signOut()}
          onChangePassword={() => setChangePasswordOpen(true)}
        />
      )}
      {changePasswordOpen && (
        <ChangePasswordModal onClose={() => setChangePasswordOpen(false)} />
      )}
      </Animated.View>
    </SafeAreaView>
  );
}

function AuthScreen({
  error,
  busy,
  onSignedIn,
}: {
  error: string;
  busy: boolean;
  onSignedIn: () => Promise<void>;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isPhone = width < 600;
  const { signIn, setActive } = useSignIn();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pendingSignIn, setPendingSignIn] = useState<typeof signIn>(undefined);
  const [secondFactor, setSecondFactor] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);

  const finishSignIn = async (result: NonNullable<typeof pendingSignIn>) => {
    if (result.status !== 'complete' || !result.createdSessionId || !setActive) {
      throw new Error('Verification did not complete. Check the code and try again.');
    }
    await setActive({ session: result.createdSessionId });
    setPendingSignIn(undefined);
    await onSignedIn();
  };

  const submit = async () => {
    setSubmitting(true);
    setLocalError('');
    try {
      if (!signIn || !setActive) throw new Error('Clerk sign-in is not ready yet.');
      const result = await signIn.create({ identifier: identifier.trim(), password });
      if (result.status === 'needs_second_factor') {
        const factors = result.supportedSecondFactors ?? [];
        const supported = factors.find((factor) => factor.strategy === 'email_code');
        if (!supported) {
          throw new Error('Email verification is not enabled for this account in Clerk. Add and verify an email address for the admin, then enable email-code verification.');
        }
        setSecondFactor(supported.strategy);
        setCode('');
        setCodeSent(false);
        await result.prepareSecondFactor({
          strategy: 'email_code',
          emailAddressId: supported.emailAddressId,
        });
        setCodeSent(true);
        setPendingSignIn(result);
        return;
      }
      await finishSignIn(result);
    } catch (cause) {
      setLocalError(clerkError(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const verifySecondFactor = async () => {
    setSubmitting(true);
    setLocalError('');
    try {
      if (!pendingSignIn || !code.trim()) throw new Error('Enter the verification code.');
      if (secondFactor !== 'email_code') {
        throw new Error('Email verification is not available. Please sign in again.');
      }
      const result = await pendingSignIn.attemptSecondFactor({
        strategy: 'email_code',
        code: code.trim(),
      });
      await finishSignIn(result);
    } catch (cause) {
      setLocalError(clerkError(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const changeSecondFactor = async (strategy: string) => {
    setSubmitting(true);
    setLocalError('');
    try {
      if (!pendingSignIn) throw new Error('Sign-in expired. Please sign in again.');
      const factor = pendingSignIn.supportedSecondFactors?.find(
        (candidate) => candidate.strategy === strategy,
      );
      if (strategy !== 'email_code' || !factor || !('emailAddressId' in factor)) {
        throw new Error('Email verification is not available for this account. Contact your administrator to enable it in Clerk.');
      }
      await pendingSignIn.prepareSecondFactor({
        strategy: 'email_code',
        emailAddressId: factor.emailAddressId,
      });
      setSecondFactor('email_code');
      setCode('');
      setCodeSent(true);
    } catch (cause) {
      setLocalError(clerkError(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
    >
      <ScrollView contentContainerStyle={[styles.page, isPhone && styles.pagePhone]} keyboardShouldPersistTaps="handled">
        <BrandHeader subtitle={pendingSignIn ? 'Verify your identity to continue' : 'Sign in to your assigned account'} />
        <View style={styles.authCard}>
          <Text style={styles.cardEyebrow}>{pendingSignIn ? 'SECURE SIGN IN' : 'WELCOME BACK'}</Text>
          <Text style={styles.formTitle}>{pendingSignIn ? 'Verify it’s you' : 'Sign in to ManageNest'}</Text>
          <Text style={styles.formDescription}>
            {pendingSignIn
              ? 'Enter the one-time code sent to your email address.'
              : 'Use the account details provided by your administrator.'}
          </Text>
          {pendingSignIn ? (
          <>
            {(pendingSignIn.supportedSecondFactors ?? [])
              .filter((factor) => factor.strategy === 'email_code')
              .map((factor) => (
                <Pressable
                  key={factor.strategy}
                  onPress={() => void changeSecondFactor(factor.strategy)}
                  disabled={submitting || secondFactor === factor.strategy}
                  style={styles.factorOption}
                >
                  <Text style={styles.actionText}>
                    {`Email code (${factor.safeIdentifier})`}
                  </Text>
                </Pressable>
              ))}
            <AppInput
              style={styles.input}
              placeholder="Verification code"
              keyboardType="number-pad"
              autoCapitalize="none"
              value={code}
              onChangeText={setCode}
              editable={codeSent}
            />
            <PrimaryButton
              label={submitting ? 'Verifying…' : 'Verify and sign in'}
              onPress={verifySecondFactor}
              disabled={submitting || !code.trim() || !codeSent}
            />
            <Pressable onPress={() => {             setPendingSignIn(undefined); setLocalError(''); setCode(''); }}>
              <Text style={styles.smallPrint}>Back to sign in</Text>
            </Pressable>
          </>
          ) : (
          <>
            <AppInput
              style={styles.input}
              placeholder="Username or email"
              autoCapitalize="none"
              value={identifier}
              onChangeText={setIdentifier}
            />
            <AppInput
              style={styles.input}
              placeholder="Password"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
            <PrimaryButton
              label={submitting || busy ? 'Signing in…' : 'Sign in'}
              onPress={submit}
              disabled={submitting || busy || !identifier.trim() || !password}
            />
          </>
          )}
          <ErrorText message={localError || error} />
        </View>
        {!pendingSignIn && (
          <Text style={styles.smallPrint}>
            Accounts are provisioned securely by your company administrator.
          </Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function EmailSetupScreen({
  request,
  error,
  onComplete,
  onChangePassword,
}: {
  request: ApiRequest;
  error: string;
  onComplete: () => Promise<void>;
  onChangePassword: () => void;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isPhone = width < 600;
  const { user } = useUser();
  const verifiedEmails = [
    ...(user?.emailAddresses.filter(
      (address) => address.verification?.status === 'verified',
    ) ?? []),
  ].sort((first, second) => {
    if (first.id === user?.primaryEmailAddressId) return -1;
    if (second.id === user?.primaryEmailAddressId) return 1;
    return 0;
  });
  const createEmailAddress = useReverification(async (targetEmail: string) => {
    if (!user) throw new Error('Your Clerk session is not ready.');
    return user.createEmailAddress({ email: targetEmail });
  });
  const setPrimaryEmailAddress = useReverification(async (emailAddressId: string) => {
    if (!user) throw new Error('Your Clerk session is not ready.');
    return user.update({ primaryEmailAddressId: emailAddressId });
  });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [emailAddress, setEmailAddress] = useState<
    Awaited<ReturnType<NonNullable<typeof user>['createEmailAddress']>> | null
  >(null);
  const [localError, setLocalError] = useState('');
  const [busy, setBusy] = useState(false);

  const saveVerifiedEmail = async (verifiedEmail: string) => {
    setBusy(true);
    setLocalError('');
    try {
      if (!verifiedEmails.some(
        (address) =>
          address.emailAddress.toLowerCase() === verifiedEmail.toLowerCase(),
      )) {
        throw new Error('Select an email address verified by your account provider.');
      }
      await request('/session/email', {
        method: 'PATCH',
        body: JSON.stringify({ email: verifiedEmail }),
      });
      await onComplete();
    } catch (cause) {
      setLocalError(clerkError(cause));
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async () => {
    setBusy(true);
    setLocalError('');
    try {
      const emailAddress = await createEmailAddress(email.trim());
      await emailAddress.prepareVerification({ strategy: 'email_code' });
      setEmailAddress(emailAddress);
    } catch (cause) {
      setLocalError(clerkError(cause));
    } finally {
      setBusy(false);
    }
  };

  const verifyEmail = async () => {
    setBusy(true);
    setLocalError('');
    try {
      if (!user) throw new Error('Your Clerk session is not ready.');
      if (!emailAddress) throw new Error('Email verification expired. Request a new code.');
      const verifiedEmail = await emailAddress.attemptVerification({ code });
      if (verifiedEmail.verification.status !== 'verified') {
        throw new Error('Email verification has not completed.');
      }
      await setPrimaryEmailAddress(verifiedEmail.id);
      await request('/session/email', {
        method: 'PATCH',
        body: JSON.stringify({ email: verifiedEmail.emailAddress }),
      });
      await onComplete();
    } catch (cause) {
      setLocalError(clerkError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
    >
      <ScrollView contentContainerStyle={[styles.page, isPhone && styles.pagePhone]} keyboardShouldPersistTaps="handled">
        <BrandHeader subtitle={emailAddress ? 'Verify your email address' : 'Add and verify your email'} />
        <View style={styles.authCard}>
          <Text style={styles.cardEyebrow}>ACCOUNT SECURITY</Text>
          <Text style={styles.formTitle}>{emailAddress ? 'Confirm your email' : 'Secure your account'}</Text>
          <Text style={styles.formDescription}>
            Add a verified email address so you can also sign in with it.
          </Text>
        {verifiedEmails.length > 0 && !emailAddress ? (
          <>
            <Text style={styles.smallPrint}>
              Your Clerk account already has verified email addresses. Select one to finish setting up your account.
            </Text>
            {verifiedEmails.map((address) => (
              <PrimaryButton
                key={address.id}
                label={
                  busy
                    ? 'Saving email…'
                    : `Continue with ${address.emailAddress}${address.id === user?.primaryEmailAddressId ? ' (primary)' : ''}`
                }
                onPress={() => void saveVerifiedEmail(address.emailAddress)}
                disabled={busy}
              />
            ))}
          </>
        ) : !emailAddress ? (
          <>
            <AppInput
              style={styles.input}
              placeholder="Your email address"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <PrimaryButton label={busy ? 'Sending code…' : 'Send verification code'} onPress={sendCode} disabled={busy || !email.includes('@')} />
          </>
        ) : (
          <>
            <Text style={styles.smallPrint}>A verification code was sent to {email}.</Text>
            <AppInput
              style={styles.input}
              placeholder="Verification code"
              keyboardType="number-pad"
              value={code}
              onChangeText={setCode}
            />
            <PrimaryButton label={busy ? 'Verifying…' : 'Verify email'} onPress={verifyEmail} disabled={busy || code.length < 4} />
          </>
        )}
        <ErrorText message={localError || error} />
        <ActionButton label="Change password" onPress={onChangePassword} disabled={busy} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function AdminDashboard({
  session,
  adminName,
  managers,
  error,
  busy,
  credentials,
  onCreate,
  onUpdate,
  onDelete,
  onRefresh,
  onChangePassword,
  onSignOut,
}: {
  session: Session | null;
  adminName: string;
  managers: Manager[];
  error: string;
  busy: boolean;
  credentials: TemporaryCredentials | null;
  onCreate: (input: { name: string; username: string; companyName: string }) => Promise<void>;
  onUpdate: (id: string, input: { name?: string; username?: string; companyName?: string; status?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onChangePassword: () => void;
  onSignOut: () => void;
}) {
  const { width } = useWindowDimensions();
  const isPhone = width < 600;
  const [activeSection, setActiveSection] = useState('overview');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [companyName, setCompanyName] = useState('');
  const { refreshing, refreshError, onRefresh: refreshScreen } = usePullToRefresh(onRefresh);
  const groups: NavigationGroup[] = [{
    label: 'PLATFORM',
    sections: [
      { id: 'overview', label: 'Overview' },
      { id: 'companies', label: 'Companies', collection: 'companies' },
      { id: 'users', label: 'Platform users', collection: 'users' },
      { id: 'account', label: 'Account' },
    ],
  }];
  const selectedNavigation = groups.flatMap((group) => group.sections).find((section) => section.id === activeSection);
  return (
    <View style={[styles.dashboardShell, width <= 900 && styles.dashboardShellMobile]}>
      <DashboardSidebar
        activeSection={activeSection}
        groups={groups}
        identity="Platform admin"
        onSelect={setActiveSection}
      />
      <View style={styles.dashboardMain}>
      <ScrollView
        contentContainerStyle={[styles.dashboard, isPhone && styles.dashboardPhone]}
        refreshControl={Platform.OS === 'web' ? undefined : (
          createPullToRefreshControl(refreshing, refreshScreen)
        )}
      >
      <DashboardHeader
        title={activeSection === 'overview' ? 'Platform overview' : selectedNavigation?.label ?? 'Platform'}
        subtitle={`Signed in as ${adminName}`}
      />
      <ErrorText message={refreshError} />
      {activeSection === 'account' ? (
        <AccountSettingsScreen
          name={session?.profile.name ?? adminName}
          username={session?.profile.username ?? ''}
          email={session?.profile.email}
          role="Platform administrator"
          onChangePassword={onChangePassword}
          onSignOut={onSignOut}
        />
      ) : activeSection === 'overview' ? (
      <>
      <View style={[styles.metrics, isPhone && styles.metricsPhone]}>
        <Metric label="Company workspaces" value={String(managers.length)} compact={isPhone} />
        <Metric label="Active managers" value={String(managers.filter((manager) => manager.status === 'active').length)} compact={isPhone} />
        <Metric label="Platform role" value="Administrator" compact={isPhone} />
      </View>
      <View style={styles.section}>
        <Text style={styles.cardEyebrow}>PLATFORM HEALTH</Text>
        <Text style={styles.sectionTitle}>Manager accounts</Text>
        <DonutChart
          total={managers.length}
          segments={[
            { label: 'Active', value: managers.filter((manager) => manager.status === 'active').length, color: theme.colors.primary },
            { label: 'Suspended', value: managers.filter((manager) => manager.status === 'suspended').length, color: theme.colors.warning },
          ]}
        />
      </View>
      <View style={styles.section}>
        <Text style={styles.cardEyebrow}>GET STARTED</Text>
        <Text style={styles.sectionTitle}>Create a company workspace</Text>
        <Text style={styles.muted}>Add a company manager to provision their company and sign-in account.</Text>
        <ActionButton label="Go to company managers" onPress={() => setActiveSection('managers')} />
      </View>
      </>
      ) : (
      <>
      <View style={styles.section}>
        <Text style={styles.cardEyebrow}>NEW WORKSPACE</Text>
        <Text style={styles.sectionTitle}>{activeSection === 'companies' ? 'Create a company workspace' : 'Create a platform user'}</Text>
        <Text style={styles.muted}>Creates the company, manager record, and Clerk login together.</Text>
        <AppInput placeholder="Manager full name" value={name} onChangeText={setName} />
        <AppInput placeholder="Username (used to sign in)" autoCapitalize="none" value={username} onChangeText={setUsername} />
        <AppInput placeholder="Company name" value={companyName} onChangeText={setCompanyName} />
        <PrimaryButton
          label={busy ? 'Creating…' : 'Create manager account'}
          onPress={() => void onCreate({ name, username, companyName })}
          disabled={busy || !name.trim() || username.trim().length < 4 || !companyName.trim()}
        />
      </View>
      <CredentialNotice credentials={credentials} />
      <View style={styles.section}>
        <Text style={styles.cardEyebrow}>DIRECTORY</Text>
        <Text style={styles.sectionTitle}>{activeSection === 'companies' ? 'Company workspaces' : 'Company managers'}</Text>
        {managers.length === 0 && (
          <View style={styles.emptyState}>
            <View style={styles.emptyMark}><Text style={styles.emptyMarkText}>M</Text></View>
            <Text style={styles.emptyTitle}>No managers yet</Text>
            <Text style={styles.emptyDescription}>Create a manager account to set up your first company workspace.</Text>
          </View>
        )}
        {managers.map((manager) => (
          <ManagerRow key={manager._id} manager={manager} busy={busy} onUpdate={onUpdate} onDelete={onDelete} />
        ))}
      </View>
      </>
      )}
      <ErrorText message={error} />
      </ScrollView>
      </View>
    </View>
  );
}

function ManagerRow({
  manager,
  busy,
  onUpdate,
  onDelete,
}: {
  manager: Manager;
  busy: boolean;
  onUpdate: (id: string, input: { name?: string; username?: string; companyName?: string; status?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(manager.name);
  const [username, setUsername] = useState(manager.username);
  const [companyName, setCompanyName] = useState(manager.companyId?.name ?? '');
  return (
    <View style={styles.record}>
      {editing ? (
        <>
          <AppInput value={name} onChangeText={setName} placeholder="Manager name" />
          <AppInput value={username} onChangeText={setUsername} placeholder="Username" autoCapitalize="none" />
          <AppInput value={companyName} onChangeText={setCompanyName} placeholder="Company name" />
          <View style={styles.actions}>
            <ActionButton label="Save" disabled={busy || username.trim().length < 4} onPress={() => { void onUpdate(manager._id, { name, username, companyName }).then(() => setEditing(false)); }} />
            <ActionButton label="Cancel" disabled={busy} onPress={() => setEditing(false)} />
          </View>
        </>
      ) : (
        <>
          <Text style={styles.warehouseName}>{manager.name}</Text>
          <Text style={styles.muted}>@{manager.username}{manager.email ? ` · ${manager.email}` : ' · Email not added'} · {manager.companyId?.name ?? 'Company unavailable'}</Text>
          <Text style={manager.status === 'active' ? styles.activeTag : styles.disabledTag}>{manager.status.toUpperCase()}</Text>
          <View style={styles.actions}>
            <ActionButton label="Edit" disabled={busy} onPress={() => setEditing(true)} />
            <ActionButton label={manager.status === 'active' ? 'Disable' : 'Enable'} disabled={busy} onPress={() => void onUpdate(manager._id, { status: manager.status === 'active' ? 'suspended' : 'active' })} />
            <ActionButton label="Delete" disabled={busy} destructive onPress={() => void onDelete(manager._id)} />
          </View>
        </>
      )}
    </View>
  );
}

function ManagerDashboard({
  session,
  workers,
  warehouses,
  request,
  error,
  busy,
  credentials,
  onCreateWorker,
  onUpdateWorker,
  onDeleteWorker,
  onCreateWarehouse,
  onRefreshManagerData,
  onRefreshWarehouses,
  onChangePassword,
  onSignOut,
}: {
  session: Session | null;
  workers: Worker[];
  warehouses: Warehouse[];
  request: ApiRequest;
  error: string;
  busy: boolean;
  credentials: TemporaryCredentials | null;
  onCreateWorker: (input: { name: string; username: string; phoneNumber: string; employeeNumber: string; role: string; warehouseIds?: string[]; specialty?: string }) => Promise<void>;
  onUpdateWorker: (id: string, input: { name?: string; username?: string; employeeNumber?: string; phoneNumber?: string; role?: string; status?: string; warehouseIds?: string[]; specialty?: string }) => Promise<void>;
  onDeleteWorker: (id: string) => Promise<void>;
  onCreateWarehouse: (
    code: string,
    name: string,
    lowStockThresholdKg?: number,
    location?: string,
    address?: string,
  ) => Promise<void>;
  onRefreshManagerData: () => Promise<void>;
  onRefreshWarehouses: () => Promise<Warehouse[]>;
  onChangePassword: () => void;
  onSignOut: () => void;
}) {
  const { width } = useWindowDimensions();
  const isPhone = width < 600;
  const [activeSection, setActiveSection] = useState('overview');
  const [workerName, setWorkerName] = useState('');
  const [workerUsername, setWorkerUsername] = useState('');
  const [workerPhoneNumber, setWorkerPhoneNumber] = useState('');
  const [employeeNumber, setEmployeeNumber] = useState('');
  const [workerRole, setWorkerRole] = useState<(typeof workerJobRoles)[number]['value']>('warehouse_operator');
  const [workerWarehouseIds, setWorkerWarehouseIds] = useState<string[]>([]);
  const [workerSpecialty, setWorkerSpecialty] = useState('');
  const [workerWarehouses, setWorkerWarehouses] = useState(warehouses);
  const [workerWarehousesLoading, setWorkerWarehousesLoading] = useState(false);
  const [workerWarehousesError, setWorkerWarehousesError] = useState('');
  const [warehouseCode, setWarehouseCode] = useState('');
  const [warehouseName, setWarehouseName] = useState('');
  const [lowStockThreshold, setLowStockThreshold] = useState('');
  const [warehouseLocation, setWarehouseLocation] = useState('');
  const [warehouseAddress, setWarehouseAddress] = useState('');
  const [warehouseListLoading, setWarehouseListLoading] = useState(false);
  const [warehouseListError, setWarehouseListError] = useState('');
  const [managingWarehouseRecords, setManagingWarehouseRecords] = useState(false);
  const [managingExpenseRecords, setManagingExpenseRecords] = useState(false);
  const [selectedExpenseCategory, setSelectedExpenseCategory] = useState('');
  const [companyDashboard, setCompanyDashboard] = useState<CompanyDashboard | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState('');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(null);
  const [selectedWarehouseTab, setSelectedWarehouseTab] = useState('overview');
  const [warehouseDashboard, setWarehouseDashboard] = useState<WarehouseDashboard | null>(null);
  const [warehouseLoading, setWarehouseLoading] = useState(false);
  const [warehouseError, setWarehouseError] = useState('');
  const [warehouseRefreshKey, setWarehouseRefreshKey] = useState(0);
  const [screenRefreshKey, setScreenRefreshKey] = useState(0);
  const [expenseFilterDraft, setExpenseFilterDraft] = useState({
    from: '',
    to: '',
    category: '',
    truckId: '',
    tripId: '',
    paymentStatus: '',
  });
  const [expenseFilterQuery, setExpenseFilterQuery] = useState('');
  const loadCompanyDashboard = useCallback(async (showLoading = true) => {
    if (showLoading) setDashboardLoading(true);
    setDashboardError('');
    try {
      setCompanyDashboard(await request<CompanyDashboard>('/dashboard/company'));
    } catch (cause) {
      setDashboardError(cause instanceof Error ? cause.message : 'Unable to load company dashboard');
    } finally {
      if (showLoading) setDashboardLoading(false);
    }
  }, [request]);
  const refreshModuleData = useCallback(() => {
    setWarehouseRefreshKey((current) => current + 1);
    void loadCompanyDashboard();
    void onRefreshManagerData().catch((cause: unknown) => {
      setDashboardError(cause instanceof Error ? cause.message : 'Unable to refresh company records');
    });
  }, [loadCompanyDashboard, onRefreshManagerData]);
  const refreshCurrentScreen = useCallback(async () => {
    setScreenRefreshKey((current) => current + 1);
    setWarehouseRefreshKey((current) => current + 1);
    const refreshes: Promise<unknown>[] = [onRefreshManagerData()];
    if (activeSection === 'overview') {
      refreshes.push(
        request<CompanyDashboard>('/dashboard/company').then((dashboard) => {
          setCompanyDashboard(dashboard);
          setDashboardError('');
        }),
      );
    }
    await Promise.all(refreshes);
  }, [activeSection, onRefreshManagerData, request]);
  const { refreshing, refreshError, onRefresh: refreshScreen } = usePullToRefresh(refreshCurrentScreen);
  useEffect(() => {
    if (activeSection === 'overview') void loadCompanyDashboard();
  }, [activeSection, loadCompanyDashboard]);
  useEffect(() => {
    setWorkerWarehouses(warehouses);
  }, [warehouses]);
  useEffect(() => {
    if (activeSection !== 'workers') return;
    setWorkerWarehousesLoading(true);
    setWorkerWarehousesError('');
    void onRefreshManagerData()
      .catch((cause: unknown) => {
        setWorkerWarehousesError(
          cause instanceof Error ? cause.message : 'Unable to refresh worker warehouse assignments',
        );
      })
      .finally(() => setWorkerWarehousesLoading(false));
  }, [activeSection, onRefreshManagerData]);
  useEffect(() => {
    if (activeSection !== 'warehouses') return;
    let active = true;
    setWarehouseListLoading(true);
    setWarehouseListError('');
    void onRefreshWarehouses()
      .catch((cause: unknown) => {
        if (active) {
          setWarehouseListError(
            cause instanceof Error ? cause.message : 'Unable to load company warehouses',
          );
        }
      })
      .finally(() => {
        if (active) setWarehouseListLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeSection, onRefreshWarehouses]);
  useEffect(() => {
    const interval = setInterval(() => {
      void loadCompanyDashboard(false);
      setWarehouseRefreshKey((current) => current + 1);
      void onRefreshManagerData().catch((cause: unknown) => {
        setDashboardError(cause instanceof Error ? cause.message : 'Unable to refresh company records');
      });
    }, AUTO_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadCompanyDashboard, onRefreshManagerData]);
  useEffect(() => {
    if (!selectedWarehouseId) {
      setWarehouseDashboard(null);
      return;
    }
    let active = true;
    setWarehouseLoading(true);
    setWarehouseError('');
    setWarehouseDashboard(null);
    const query = expenseFilterQuery ? `?${expenseFilterQuery}` : '';
    void request<WarehouseDashboard>(
      `/dashboard/warehouses/${encodeURIComponent(selectedWarehouseId)}${query}`,
    ).then((result) => {
      if (active) setWarehouseDashboard(result);
    }).catch((cause: unknown) => {
      if (active) setWarehouseError(cause instanceof Error ? cause.message : 'Unable to load warehouse overview');
    }).finally(() => {
      if (active) setWarehouseLoading(false);
    });
    return () => {
      active = false;
    };
  }, [expenseFilterQuery, request, selectedWarehouseId, warehouseRefreshKey]);
  const selectedNavigation = managerNavigation
    .flatMap((group) => group.sections)
    .find((section) => section.id === activeSection);

  return (
    <View style={[styles.dashboardShell, width <= 900 && styles.dashboardShellMobile]}>
      <DashboardSidebar
        activeSection={activeSection}
        groups={managerNavigation}
        identity={session?.profile.companyId?.name ?? 'Company workspace'}
        onSelect={setActiveSection}
      />
      <View style={styles.dashboardMain}>
      <ScrollView
        contentContainerStyle={[styles.dashboard, isPhone && styles.dashboardPhone]}
        refreshControl={Platform.OS === 'web' ? undefined : (
          createPullToRefreshControl(refreshing, refreshScreen)
        )}
      >
      <DashboardHeader
        title={activeSection === 'overview' ? (session?.profile.companyId?.name ?? 'Company workspace') : (selectedNavigation?.label ?? 'Workspace')}
        subtitle={`Manager: ${session?.profile.name ?? ''}`}
      />
      <ErrorText message={refreshError} />
      {activeSection === 'account' ? (
        <AccountSettingsScreen
          name={session?.profile.name ?? 'Manager'}
          username={session?.profile.username ?? ''}
          email={session?.profile.email}
          phoneNumber={session?.profile.phoneNumber}
          role="Company manager"
          onChangePassword={onChangePassword}
          onSignOut={onSignOut}
        />
      ) : activeSection === 'overview' ? (
      <>
      <View style={[styles.managerWelcome, isPhone && styles.managerWelcomePhone]}>
        <Text style={styles.cardEyebrow}>COMPANY WORKSPACE</Text>
        <Text style={styles.welcomeTitle}>Good to see you, {session?.profile.name?.split(' ')[0] ?? 'Manager'}.</Text>
        <Text style={styles.muted}>A live operational and financial overview across every warehouse.</Text>
      </View>
      {dashboardLoading ? (
        <View style={styles.section}><ActivityIndicator color={theme.colors.primary} /><Text style={styles.muted}>Loading company records…</Text></View>
      ) : dashboardError ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Company data is unavailable</Text>
          <Text style={styles.error}>{dashboardError}</Text>
        </View>
      ) : companyDashboard ? (
        <CompanyOverview
          dashboard={companyDashboard}
          onOpenWarehouse={(id) => {
            setSelectedWarehouseId(id);
            setSelectedWarehouseTab('overview');
            setActiveSection('warehouses');
          }}
          onOpenExpenses={(category) => {
            setSelectedExpenseCategory(category);
            setActiveSection('expenses');
          }}
        />
      ) : null}
      <View style={[styles.chartGrid, isPhone && styles.chartGridPhone]}>
        <View style={[styles.section, styles.chartPanel, isPhone && styles.chartPanelPhone]}>
          <Text style={styles.cardEyebrow}>TEAM HEALTH</Text>
          <Text style={styles.sectionTitle}>Account status</Text>
          <DonutChart
            total={workers.length}
            segments={[
              { label: 'Active', value: workers.filter((worker) => worker.status === 'active').length, color: theme.colors.success },
              { label: 'Suspended', value: workers.filter((worker) => worker.status === 'suspended').length, color: theme.colors.warning },
            ]}
          />
        </View>
        <View style={[styles.section, styles.chartPanel, isPhone && styles.chartPanelPhone]}>
          <Text style={styles.cardEyebrow}>TEAM COMPOSITION</Text>
          <Text style={styles.sectionTitle}>Accounts by role</Text>
          <HistogramChart
            rows={Object.entries(workers.reduce<Record<string, number>>((counts, worker) => {
              const role = worker.role || 'Unassigned';
              counts[role] = (counts[role] ?? 0) + 1;
              return counts;
            }, {})).map(([label, value]) => ({ label, value }))}
          />
        </View>
      </View>
      </>
      ) : activeSection === 'companyProfile' ? (
        <CompanyPreferences
          request={request}
          refreshKey={screenRefreshKey}
          defaultName={session?.profile.companyId?.name ?? ''}
          currencyCode={companyDashboard?.currencyCode ?? 'USD'}
          managerPhoneNumber={session?.profile.phoneNumber ?? ''}
          onSaved={refreshModuleData}
          onPhoneSaved={onRefreshManagerData}
        />
      ) : activeSection === 'workers' ? (
      <>
      <View style={styles.section}>
        <Text style={styles.cardEyebrow}>PEOPLE</Text>
        <Text style={styles.sectionTitle}>Create worker account</Text>
        <Text style={styles.muted}>Choose the worker’s job role. You can assign tasks to them after the account is created.</Text>
        <ErrorText message={workerWarehousesError} />
        {workerWarehousesLoading ? (
          <View style={styles.actions}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={styles.muted}>Loading company warehouses…</Text>
          </View>
        ) : null}
        <AppInput placeholder="Worker full name" value={workerName} onChangeText={setWorkerName} />
        <AppInput placeholder="Username (used to sign in)" autoCapitalize="none" value={workerUsername} onChangeText={setWorkerUsername} />
        <AppInput placeholder="Lebanese phone (03… or +961…)" autoCapitalize="none" keyboardType="phone-pad" value={workerPhoneNumber} onChangeText={setWorkerPhoneNumber} />
        <AppInput placeholder="Employee number" value={employeeNumber} onChangeText={setEmployeeNumber} />
        <JobRolePicker value={workerRole} onChange={setWorkerRole} />
        {workerRole === 'driver' ? (
          <DriverSpecialtyPicker value={workerSpecialty} onChange={setWorkerSpecialty} />
        ) : null}
        {workerRole === 'driver' ? (
          <Text style={styles.muted}>Warehouse access is assigned automatically from the truck this driver is assigned to.</Text>
        ) : (
          <WarehouseAssignmentPicker
            warehouses={workerWarehouses}
            value={workerWarehouseIds}
            onChange={setWorkerWarehouseIds}
            onCreateWarehouse={() => setActiveSection('warehouses')}
            loading={workerWarehousesLoading}
            error={workerWarehousesError}
          />
        )}
        <PrimaryButton
          label={busy ? 'Creating…' : 'Create worker'}
          onPress={() => void onCreateWorker({
            name: workerName,
            username: workerUsername,
            phoneNumber: normalizePhoneNumber(workerPhoneNumber),
            employeeNumber,
            role: workerRole,
            warehouseIds: workerRole === 'driver' ? undefined : workerWarehouseIds,
            specialty: workerRole === 'driver' ? workerSpecialty || undefined : undefined,
          })}
          disabled={busy || !workerName.trim() || workerUsername.trim().length < 4 || !isValidPhoneNumber(workerPhoneNumber) || !employeeNumber.trim()}
        />
      </View>
      <CredentialNotice credentials={credentials} />
      <View style={styles.section}>
        <Text style={styles.cardEyebrow}>TEAM DIRECTORY</Text>
        <Text style={styles.sectionTitle}>Workers</Text>
        {workers.length === 0 && (
          <View style={styles.emptyState}>
            <View style={styles.emptyMark}><Text style={styles.emptyMarkText}>T</Text></View>
            <Text style={styles.emptyTitle}>Your team starts here</Text>
            <Text style={styles.emptyDescription}>Add a worker account to begin building your company directory.</Text>
          </View>
        )}
        {workers.map((worker) => (
        <WorkerRow key={worker._id} worker={worker} warehouses={workerWarehouses} busy={busy} onUpdate={onUpdateWorker} onDelete={onDeleteWorker} />
        ))}
      </View>
      </>
      ) : activeSection === 'tasks' ? (
        <TaskManagement request={request} workers={workers} externalRefreshKey={screenRefreshKey} />
      ) : activeSection === 'warehouses' ? (
      <>
      <View style={styles.section}>
        <Text style={styles.cardEyebrow}>LOCATIONS</Text>
        <View style={[styles.warehouseHeading, isPhone && styles.warehouseHeadingPhone]}>
          <Text style={styles.sectionTitle}>{selectedWarehouseId ? 'Warehouse overview' : 'Warehouses'}</Text>
          <View style={[styles.actions, isPhone && styles.actionsPhone]}>
            <ActionButton
              label={managingWarehouseRecords ? 'Back to warehouses' : 'Manage records'}
              onPress={() => {
                setSelectedWarehouseId(null);
                setManagingWarehouseRecords((current) => !current);
              }}
            />
            {selectedWarehouseId ? (
            <ActionButton label="All warehouses" onPress={() => setSelectedWarehouseId(null)} />
            ) : null}
          </View>
        </View>
        {managingWarehouseRecords ? (
          <ModuleRecordsView section={selectedNavigation} request={request} onChanged={refreshModuleData} externalRefreshKey={screenRefreshKey} />
        ) : selectedWarehouseId ? (
          <WarehouseDetail
            dashboard={warehouseDashboard}
            warehouses={warehouses}
            request={request}
            externalRefreshKey={screenRefreshKey}
            onTransferred={() => {
              setWarehouseRefreshKey((current) => current + 1);
              void loadCompanyDashboard();
            }}
            loading={warehouseLoading}
            error={warehouseError}
            activeTab={selectedWarehouseTab}
            onSelectTab={setSelectedWarehouseTab}
            filters={expenseFilterDraft}
            onChangeFilters={(key, value) => {
              setExpenseFilterDraft((current) => ({ ...current, [key]: value }));
            }}
            onApplyFilters={() => {
              const params = new URLSearchParams();
              Object.entries(expenseFilterDraft).forEach(([key, value]) => {
                if (value.trim()) params.set(key, value.trim());
              });
              setExpenseFilterQuery(params.toString());
            }}
          />
        ) : (
          <>
        {warehouseListLoading ? (
          <View style={styles.actions}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={styles.muted}>Loading company warehouses…</Text>
          </View>
        ) : null}
        <ErrorText message={warehouseListError} />
        {!warehouseListLoading && !warehouseListError && warehouses.length === 0 && (
          <View style={styles.inlineEmpty}>
            <Text style={styles.emptyDescription}>No warehouses have been added to this company yet.</Text>
          </View>
        )}
        {warehouses.map((warehouse) => (
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.warehouseRow, pressed && styles.controlPressed]}
            key={warehouse._id}
            onPress={() => {
              setSelectedWarehouseId(warehouse._id);
              setSelectedWarehouseTab('overview');
            }}
          >
            <View style={styles.warehouseIcon}><Text style={styles.warehouseIconText}>W</Text></View>
            <View style={styles.flex}>
              <Text style={styles.warehouseName}>{warehouse.name}</Text>
              <Text style={styles.muted}>{warehouse.code}</Text>
            </View>
            <Text style={styles.linkText}>View details ›</Text>
          </Pressable>
        ))}
        <AppInput placeholder="Warehouse code" value={warehouseCode} onChangeText={setWarehouseCode} autoCapitalize="characters" />
        <AppInput placeholder="Warehouse name" value={warehouseName} onChangeText={setWarehouseName} />
        <AppInput placeholder="City / location (optional)" value={warehouseLocation} onChangeText={setWarehouseLocation} />
        <AppInput placeholder="Address (optional)" value={warehouseAddress} onChangeText={setWarehouseAddress} />
        <AppInput
          placeholder="Low-stock threshold in KG (optional)"
          value={lowStockThreshold}
          onChangeText={setLowStockThreshold}
          keyboardType="decimal-pad"
        />
        <PrimaryButton
          label="Add warehouse"
          onPress={() => void onCreateWarehouse(
            warehouseCode,
            warehouseName,
            lowStockThreshold.trim() ? Number(lowStockThreshold) : undefined,
            warehouseLocation.trim() || undefined,
            warehouseAddress.trim() || undefined,
          ).then(() => {
            setWarehouseCode('');
            setWarehouseName('');
            setLowStockThreshold('');
            setWarehouseLocation('');
            setWarehouseAddress('');
            void loadCompanyDashboard();
          })}
          disabled={busy || !warehouseCode.trim() || !warehouseName.trim() || (lowStockThreshold.trim() !== '' && (!Number.isFinite(Number(lowStockThreshold)) || Number(lowStockThreshold) < 0))}
        />
          </>
        )}
      </View>
      </>
      ) : activeSection === 'expenses' ? (
        <>
          <View style={styles.section}>
            <Text style={styles.cardEyebrow}>FINANCIAL OPERATIONS</Text>
            <Text style={styles.sectionTitle}>{managingExpenseRecords ? 'Manage expense records' : 'Expense analytics'}</Text>
            <ActionButton
              label={managingExpenseRecords ? 'Back to expense analytics' : 'Manage expense records'}
              onPress={() => setManagingExpenseRecords((current) => !current)}
            />
          </View>
          {managingExpenseRecords ? (
            <ModuleRecordsView section={selectedNavigation} request={request} onChanged={refreshModuleData} externalRefreshKey={screenRefreshKey} />
          ) : (
            <CompanyExpenses
              request={request}
              initialCategory={selectedExpenseCategory}
              externalRefreshKey={screenRefreshKey}
              onOpenWarehouse={(id) => {
                setSelectedWarehouseId(id);
                setSelectedWarehouseTab('overview');
                setActiveSection('warehouses');
              }}
            />
          )}
        </>
      ) : (
        <ModuleRecordsView section={selectedNavigation} request={request} onChanged={refreshModuleData} externalRefreshKey={screenRefreshKey} />
      )}
      <ErrorText message={error} />
      </ScrollView>
      </View>
    </View>
  );
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function formatCurrency(value: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currencyCode} ${formatQuantity(value)}`;
  }
}

function CompanyOverview({
  dashboard,
  onOpenWarehouse,
  onOpenExpenses,
}: {
  dashboard: CompanyDashboard;
  onOpenWarehouse: (id: string) => void;
  onOpenExpenses: (category: string) => void;
}) {
  const { width } = useWindowDimensions();
  const isPhone = width < 600;
  const isNarrow = width <= 900;
  const { kpis, analytics, warehouses, currencyCode } = dashboard;
  const metrics: { label: string; value: string }[] = [
    { label: 'Warehouses', value: formatQuantity(kpis.warehouses) },
    { label: 'Trucks', value: formatQuantity(kpis.trucks) },
    { label: 'Active trucks', value: formatQuantity(kpis.activeTrucks) },
    { label: 'Inventory stock', value: `${formatQuantity(kpis.inventoryStockKg)} kg` },
    { label: 'Inventory value', value: formatCurrency(kpis.inventoryValue, currencyCode) },
    { label: 'Inventory batches', value: formatQuantity(kpis.inventoryBatches) },
    { label: 'Total expenses', value: formatCurrency(kpis.expenses, currencyCode) },
    { label: 'Monthly expenses', value: formatCurrency(kpis.monthlyExpenses, currencyCode) },
    { label: 'Total trips', value: formatQuantity(kpis.trips) },
    { label: 'Active trips', value: formatQuantity(kpis.activeTrips) },
    { label: 'Purchases', value: formatQuantity(kpis.purchases) },
    { label: 'Sales', value: formatQuantity(kpis.sales) },
    { label: 'Suppliers', value: formatQuantity(kpis.suppliers) },
    { label: 'Customers', value: formatQuantity(kpis.customers) },
    { label: 'Fixed assets', value: formatQuantity(kpis.fixedAssets) },
    { label: 'Asset book value', value: formatCurrency(kpis.assetValue, currencyCode) },
  ];
  return (
    <>
      <View style={[styles.dashboardMetricGrid, isPhone && styles.dashboardMetricGridPhone]}>
        {metrics.map((metric) => (
          <View style={[styles.dashboardMetric, isPhone && styles.dashboardMetricPhone]} key={metric.label}>
            <Text style={styles.dashboardMetricValue} numberOfLines={1}>{metric.value}</Text>
            <Text style={styles.metricLabel}>{metric.label}</Text>
          </View>
        ))}
      </View>
      <View style={[styles.chartGrid, isPhone && styles.chartGridPhone]}>
        <View style={[styles.section, styles.chartPanel, isPhone && styles.chartPanelPhone]}>
          <Text style={styles.cardEyebrow}>COMPANY EXPENSES</Text>
          <Text style={styles.sectionTitle}>Spend by category</Text>
          <DashboardBars
            rows={analytics.expenseByCategory.map((row) => ({
              label: row.label,
              value: row.amount,
              detail: formatCurrency(row.amount, currencyCode),
            }))}
            onSelect={onOpenExpenses}
          />
        </View>
        <View style={[styles.section, styles.chartPanel, isPhone && styles.chartPanelPhone]}>
          <Text style={styles.cardEyebrow}>LAST 12 MONTHS</Text>
          <Text style={styles.sectionTitle}>Expense trend</Text>
          <DashboardBars
            rows={analytics.monthlyExpenses.map((row) => ({
              label: row.month,
              value: row.amount,
              detail: formatCurrency(row.amount, currencyCode),
            }))}
          />
        </View>
      </View>
      <View style={[styles.chartGrid, isPhone && styles.chartGridPhone]}>
        <View style={[styles.section, styles.chartPanel, isPhone && styles.chartPanelPhone]}>
          <Text style={styles.cardEyebrow}>EXPENSE COST CENTERS</Text>
          <Text style={styles.sectionTitle}>Truck expenses</Text>
          <DashboardBars rows={analytics.expenseByTruck.slice(0, 6).map((row, index) => ({
            label: row.id ? `Truck ${index + 1}` : 'Unassigned truck',
            value: row.amount,
            detail: formatCurrency(row.amount, currencyCode),
          }))} />
        </View>
        <View style={[styles.section, styles.chartPanel, isPhone && styles.chartPanelPhone]}>
          <Text style={styles.cardEyebrow}>EXPENSE COST CENTERS</Text>
          <Text style={styles.sectionTitle}>Trip expenses</Text>
          <DashboardBars rows={analytics.expenseByTrip.slice(0, 6).map((row, index) => ({
            label: row.id ? `Trip ${index + 1}` : 'Unassigned trip',
            value: row.amount,
            detail: formatCurrency(row.amount, currencyCode),
          }))} />
        </View>
      </View>
      <View style={[styles.chartGrid, isPhone && styles.chartGridPhone]}>
        <View style={[styles.section, styles.chartPanel, isPhone && styles.chartPanelPhone]}>
          <Text style={styles.cardEyebrow}>FLEET OPERATIONS · THIS MONTH</Text>
          <Text style={styles.sectionTitle}>Fuel vs maintenance</Text>
          <DonutChart
            total={analytics.fuelAndMaintenance.fuel + analytics.fuelAndMaintenance.maintenance}
            segments={[
              { label: 'Fuel', value: analytics.fuelAndMaintenance.fuel, color: theme.colors.primary },
              { label: 'Maintenance', value: analytics.fuelAndMaintenance.maintenance, color: theme.colors.warning },
            ]}
          />
          <Text style={styles.muted}>
            Fuel {formatCurrency(analytics.fuelAndMaintenance.fuel, currencyCode)} · Maintenance {formatCurrency(analytics.fuelAndMaintenance.maintenance, currencyCode)}
          </Text>
        </View>
        <View style={[styles.section, styles.chartPanel, isPhone && styles.chartPanelPhone]}>
          <Text style={styles.cardEyebrow}>SPEND CLASSIFICATION</Text>
          <Text style={styles.sectionTitle}>Operational vs transportation</Text>
          <DonutChart
            total={analytics.operationalVsTransportation.operational + analytics.operationalVsTransportation.transportation}
            segments={[
              { label: 'Operational', value: analytics.operationalVsTransportation.operational, color: theme.colors.primary },
              { label: 'Transportation', value: analytics.operationalVsTransportation.transportation, color: theme.colors.success },
            ]}
          />
          <Text style={styles.smallPrint}>Transportation includes categories labeled transport, transportation, freight, haulage or shipping; other categories are operational.</Text>
        </View>
        <View style={[styles.section, styles.chartPanel, isPhone && styles.chartPanelPhone]}>
          <Text style={styles.cardEyebrow}>OPERATIONS</Text>
          <Text style={styles.sectionTitle}>Fleet & transport</Text>
          <View style={styles.snapshotRow}><Text style={styles.snapshotLabel}>Trucks on trips</Text><Text style={styles.snapshotValue}>{kpis.trucksOnTrip}</Text></View>
          <View style={styles.snapshotRow}><Text style={styles.snapshotLabel}>Available trucks</Text><Text style={styles.snapshotValue}>{kpis.availableTrucks}</Text></View>
          <View style={styles.snapshotRow}><Text style={styles.snapshotLabel}>Pending / completed trips</Text><Text style={styles.snapshotValue}>{kpis.pendingTrips} / {kpis.completedTrips}</Text></View>
          <View style={styles.snapshotRow}><Text style={styles.snapshotLabel}>Transported goods</Text><Text style={styles.snapshotValue}>{formatQuantity(kpis.transportedKg)} kg</Text></View>
        </View>
      </View>
      <View style={styles.section}>
        <Text style={styles.cardEyebrow}>WAREHOUSE COMPARISON</Text>
        <Text style={styles.sectionTitle}>Performance by location</Text>
        {warehouses.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No warehouses yet</Text>
            <Text style={styles.emptyDescription}>Create a warehouse to see location-level inventory, fleet, trips and expense data.</Text>
          </View>
        ) : isNarrow ? (
          <View style={styles.comparisonCards}>
            {warehouses.map((warehouse) => (
              <Pressable
                key={warehouse.id}
                accessibilityRole="button"
                accessibilityLabel={`Open ${warehouse.name} warehouse`}
                onPress={() => onOpenWarehouse(warehouse.id)}
                style={({ pressed }) => [styles.comparisonCard, pressed && styles.controlPressed]}
              >
                <View style={styles.comparisonCardHeading}>
                  <View style={styles.flex}>
                    <Text style={styles.warehouseName}>{warehouse.name}</Text>
                    <Text style={styles.muted}>{warehouse.code}{warehouse.location ? ` · ${warehouse.location}` : ''}</Text>
                  </View>
                  <Text style={styles.linkText}>Open ›</Text>
                </View>
                <View style={styles.comparisonCardMetrics}>
                  {[
                    ['Inventory stock', `${formatQuantity(warehouse.stockKg)} kg`],
                    ['Inventory value', formatCurrency(warehouse.inventoryValue, currencyCode)],
                    ['Trucks', String(warehouse.trucks)],
                    ['Trips', String(warehouse.trips)],
                    ['Expenses', formatCurrency(warehouse.expenses, currencyCode)],
                  ].map(([label, value]) => (
                    <View key={label} style={styles.comparisonCardMetric}>
                      <Text style={styles.moduleRecordLabel}>{label}</Text>
                      <Text style={styles.comparisonCardValue}>{value}</Text>
                    </View>
                  ))}
                </View>
              </Pressable>
            ))}
          </View>
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <View style={styles.comparisonTable}>
                <View style={styles.comparisonHeader}>
                  {['Warehouse', 'Inventory stock', 'Inventory value', 'Trucks', 'Trips', 'Expenses'].map((label) => (
                    <Text key={label} style={styles.comparisonHeaderText}>{label}</Text>
                  ))}
                </View>
                {warehouses.map((warehouse) => (
                  <Pressable
                    key={warehouse.id}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.comparisonRow, pressed && styles.controlPressed]}
                    onPress={() => onOpenWarehouse(warehouse.id)}
                  >
                    <View style={styles.comparisonName}>
                      <Text style={styles.warehouseName}>{warehouse.name}</Text>
                      <Text style={styles.muted}>{warehouse.code}{warehouse.location ? ` · ${warehouse.location}` : ''}</Text>
                    </View>
                    <Text style={styles.comparisonValue}>{formatQuantity(warehouse.stockKg)} kg</Text>
                    <Text style={styles.comparisonValue}>{formatCurrency(warehouse.inventoryValue, currencyCode)}</Text>
                    <Text style={styles.comparisonValue}>{warehouse.trucks}</Text>
                    <Text style={styles.comparisonValue}>{warehouse.trips}</Text>
                    <Text style={styles.comparisonValue}>{formatCurrency(warehouse.expenses, currencyCode)}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </>
        )}
      </View>
    </>
  );
}

function CompanyPreferences({
  request,
  refreshKey,
  defaultName,
  currencyCode,
  managerPhoneNumber,
  onSaved,
  onPhoneSaved,
}: {
  request: ApiRequest;
  refreshKey: number;
  defaultName: string;
  currencyCode: string;
  managerPhoneNumber: string;
  onSaved: () => void;
  onPhoneSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(defaultName);
  const [currency, setCurrency] = useState(currencyCode);
  const [phoneNumber, setPhoneNumber] = useState(managerPhoneNumber);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPhone, setSavingPhone] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    void request<ModuleRecordsResponse>('/dashboard/modules/companies')
      .then((response) => {
        const company = response.records[0];
        if (active && company) {
          setName(String(company.name ?? defaultName));
          setCurrency(String(company.baseCurrencyCode ?? currencyCode));
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load company preferences');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [currencyCode, defaultName, refreshKey, request]);

  const save = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await request('/dashboard/company/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ name: name.trim(), baseCurrencyCode: currency }),
      });
      setSuccess('Company settings saved.');
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save company preferences');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.cardEyebrow}>COMPANY SETTINGS</Text>
      <Text style={styles.sectionTitle}>Company profile and currency</Text>
      <Text style={styles.muted}>The company manager controls the company base currency. The platform administrator only creates the company workspace.</Text>
      {loading ? <ActivityIndicator color={theme.colors.primary} style={styles.moduleState} /> : (
        <>
          <Text style={styles.cardEyebrow}>MANAGER CONTACT</Text>
          <Text style={styles.muted}>The company owner manages their own contact number. Platform administrators do not enter it.</Text>
          <AppInput
            placeholder="Lebanese phone (03… or +961…)"
            autoCapitalize="none"
            keyboardType="phone-pad"
            value={phoneNumber}
            onChangeText={setPhoneNumber}
          />
          <PrimaryButton
            label={savingPhone ? 'Saving phone…' : 'Save my phone number'}
            onPress={() => {
              setSavingPhone(true);
              setError('');
              setSuccess('');
              void request('/session/phone', {
                method: 'PATCH',
                body: JSON.stringify({ phoneNumber: phoneNumber.trim() ? normalizePhoneNumber(phoneNumber) : '' }),
              }).then(async () => {
                setSuccess('Your contact number was updated.');
                await onPhoneSaved();
              }).catch((cause: unknown) => {
                setError(cause instanceof Error ? cause.message : 'Unable to save contact number');
              }).finally(() => setSavingPhone(false));
            }}
            disabled={savingPhone || (phoneNumber.trim() !== '' && !isValidPhoneNumber(phoneNumber))}
          />
          <View style={styles.moduleField}>
            <Text style={styles.inputLabel}>Company name</Text>
            <AppInput value={name} onChangeText={setName} placeholder="Company name" />
          </View>
          <CurrencyPicker label="Company base currency" value={currency} onChange={setCurrency} />
          {success ? <Text style={styles.passwordSuccess}>{success}</Text> : null}
          <ErrorText message={error} />
          <PrimaryButton label={saving ? 'Saving…' : 'Save company settings'} onPress={() => void save()} disabled={saving || !name.trim()} />
        </>
      )}
    </View>
  );
}

function displayReferenceOption(options: ModuleRecord[] | undefined, id: string | null, fallback: string): string {
  if (!id) return fallback;
  const option = options?.find((item) => String(item._id ?? '') === id);
  return option ? moduleOptionLabel(option) : fallback;
}

function DashboardBars({
  rows,
  onSelect,
}: {
  rows: { label: string; value: number; detail: string }[];
  onSelect?: (label: string) => void;
}) {
  const max = Math.max(...rows.map((row) => row.value), 0);
  if (!rows.length) {
    return <View style={styles.chartEmpty}><Text style={styles.chartEmptyHint}>Records will appear here when data is available.</Text></View>;
  }
  return (
    <View style={styles.histogram}>
      {rows.map((row) => {
        const content = (
          <>
            <View style={styles.histogramHeading}>
              <Text numberOfLines={1} style={styles.histogramLabel}>{row.label}</Text>
              <Text style={styles.histogramValue}>{row.detail}</Text>
            </View>
            <View style={styles.histogramTrack}>
              <View style={[styles.histogramFill, { width: `${max ? (row.value / max) * 100 : 0}%` }]} />
            </View>
          </>
        );
        return onSelect ? (
          <Pressable key={row.label} accessibilityRole="button" onPress={() => onSelect(row.label)} style={styles.dashboardBarRow}>
            {content}
            <Text style={styles.linkText}>View records ›</Text>
          </Pressable>
        ) : (
          <View key={row.label} style={styles.dashboardBarRow}>{content}</View>
        );
      })}
    </View>
  );
}

function WarehouseDetail({
  dashboard,
  warehouses,
  request,
  externalRefreshKey,
  onTransferred,
  loading,
  error,
  activeTab,
  onSelectTab,
  filters,
  onChangeFilters,
  onApplyFilters,
}: {
  dashboard: WarehouseDashboard | null;
  warehouses: Warehouse[];
  request: ApiRequest;
  externalRefreshKey: number;
  onTransferred: () => void;
  loading: boolean;
  error: string;
  activeTab: string;
  onSelectTab: (tab: string) => void;
  filters: ExpenseFilters;
  onChangeFilters: (key: keyof ExpenseFilters, value: string) => void;
  onApplyFilters: () => void;
}) {
  const { width } = useWindowDimensions();
  const isPhone = width < 600;
  const tabs = ['overview', 'inventory', 'expenses', 'trucks', 'trips', 'materials', 'commercial', 'reports'];
  const [transferBusyId, setTransferBusyId] = useState('');
  const [transferError, setTransferError] = useState('');
  const [selectedTruckId, setSelectedTruckId] = useState<string | null>(null);
  const [selectedModule, setSelectedModule] = useState('');
  const { options: expenseReferenceOptions, loading: referenceOptionsLoading, error: referenceOptionsError } =
    useExpenseReferenceOptions(request, activeTab === 'expenses');
  const tabModules = warehouseModulesByTab[activeTab] ?? [];
  useEffect(() => {
    setSelectedModule(tabModules[0] ?? '');
  }, [activeTab]);
  const transferTruck = async (truckId: string, warehouseId: string) => {
    setTransferBusyId(truckId);
    setTransferError('');
    try {
      await request(`/dashboard/trucks/${encodeURIComponent(truckId)}/transfer`, {
        method: 'POST',
        body: JSON.stringify({ warehouseId }),
      });
      onTransferred();
    } catch (cause) {
      setTransferError(cause instanceof Error ? cause.message : 'Unable to transfer truck');
    } finally {
      setTransferBusyId('');
    }
  };
  return (
    <View style={styles.warehouseDetail}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.warehouseTabs}>
        {tabs.map((tab) => (
          <Pressable
            key={tab}
            accessibilityRole="button"
            accessibilityState={{ selected: activeTab === tab }}
            onPress={() => onSelectTab(tab)}
            style={[styles.warehouseTab, activeTab === tab && styles.warehouseTabActive]}
          >
            <Text style={[styles.warehouseTabText, activeTab === tab && styles.warehouseTabTextActive]}>
              {tab === 'trips' ? 'Trips & shipments' : tab[0].toUpperCase() + tab.slice(1)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      {loading ? <ActivityIndicator color={theme.colors.primary} style={styles.detailLoading} /> : null}
      {error ? <ErrorText message={error} /> : null}
      {dashboard && tabModules.length ? (
        <View style={styles.warehouseRecordsPanel}>
          <Text style={styles.cardEyebrow}>WAREHOUSE RECORDS</Text>
          <Text style={styles.sectionTitle}>Manage {activeTab === 'trips' ? 'trips and shipments' : activeTab}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.moduleSelector}>
            {tabModules.map((moduleName) => (
              <Pressable
                key={moduleName}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedModule === moduleName }}
                onPress={() => setSelectedModule(moduleName)}
                style={[styles.moduleChip, selectedModule === moduleName && styles.moduleChipActive]}
              >
                <Text style={[styles.moduleChipText, selectedModule === moduleName && styles.moduleChipTextActive]}>
                  {moduleName.replace(/([a-z])([A-Z])/g, '$1 $2')}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          {selectedModule ? (
            <ModuleRecordsView
              section={{
                id: selectedModule,
                label: selectedModule.replace(/([a-z])([A-Z])/g, '$1 $2'),
                collection: selectedModule,
              }}
              request={request}
              onChanged={onTransferred}
              externalRefreshKey={externalRefreshKey}
              warehouseId={dashboard.warehouse.id}
              defaultCurrencyCode={dashboard.currencyCode}
            />
          ) : null}
        </View>
      ) : null}
      {dashboard && activeTab === 'overview' ? (
        <>
          <Text style={styles.warehouseName}>{dashboard.warehouse.name} · {dashboard.warehouse.code}</Text>
          <Text style={styles.muted}>
            {[dashboard.warehouse.location, dashboard.warehouse.address].filter(Boolean).join(' · ') || 'No location details provided'}
          </Text>
          <View style={[styles.dashboardMetricGrid, isPhone && styles.dashboardMetricGridPhone]}>
            <MiniMetric label="Inventory stock" value={`${formatQuantity(dashboard.inventory.stockKg)} kg`} />
            <MiniMetric label="Inventory value" value={formatCurrency(dashboard.inventory.inventoryValue, dashboard.currencyCode)} />
            <MiniMetric label="Batches" value={String(dashboard.inventory.batchCount)} />
            <MiniMetric label="Weighted avg. cost / kg" value={formatCurrency(dashboard.inventory.weightedAverageCostPerKg, dashboard.currencyCode)} />
            <MiniMetric label="Total expenses" value={formatCurrency(dashboard.expenses.total, dashboard.currencyCode)} />
            <MiniMetric label="Assigned trucks" value={String(dashboard.trucks.total)} />
            <MiniMetric label="Trips" value={String(dashboard.trips.total)} />
            <MiniMetric label="Transported goods" value={`${formatQuantity(dashboard.trips.transportedKg)} kg`} />
            <MiniMetric label="Purchases" value={String(dashboard.operations.purchases)} />
            <MiniMetric label="Purchase orders" value={String(dashboard.operations.purchaseOrders)} />
            <MiniMetric label="Sales / income" value={String(dashboard.operations.sales)} />
            <MiniMetric label="Sales orders" value={String(dashboard.operations.salesOrders)} />
            <MiniMetric label="Supplier payments" value={String(dashboard.operations.supplierPayments + dashboard.operations.supplierAdvances)} />
            <MiniMetric label="Customer receipts" value={String(dashboard.operations.customerPayments + dashboard.operations.customerAdvances)} />
          </View>
          {dashboard.inventory.lowStockBatchCount !== null ? (
            <View style={dashboard.inventory.lowStockBatchCount > 0 ? styles.warningBanner : styles.successBanner}>
              <Text style={styles.noticeText}>
                {dashboard.inventory.lowStockBatchCount > 0
                  ? `${dashboard.inventory.lowStockBatchCount} batch(es) are at or below the ${formatQuantity(dashboard.warehouse.lowStockThresholdKg ?? 0)} kg low-stock threshold.`
                  : 'No low-stock batches for this warehouse.'}
              </Text>
            </View>
          ) : (
            <Text style={styles.muted}>Set a low-stock threshold to enable warehouse alerts.</Text>
          )}
          <View style={styles.snapshotRow}><Text style={styles.snapshotLabel}>Warehouse status</Text><Text style={styles.snapshotValue}>{dashboard.warehouse.status}</Text></View>
          <View style={styles.snapshotRow}><Text style={styles.snapshotLabel}>Created</Text><Text style={styles.snapshotValue}>{dashboard.warehouse.createdAt ? new Date(dashboard.warehouse.createdAt).toLocaleDateString() : '—'}</Text></View>
        </>
      ) : null}
      {dashboard && activeTab === 'inventory' ? (
        <>
          <View style={[styles.dashboardMetricGrid, isPhone && styles.dashboardMetricGridPhone]}>
            <MiniMetric label="Stock on hand" value={`${formatQuantity(dashboard.inventory.stockKg)} kg`} />
            <MiniMetric label="Inventory value" value={formatCurrency(dashboard.inventory.inventoryValue, dashboard.currencyCode)} />
            <MiniMetric label="Weighted average / kg" value={formatCurrency(dashboard.inventory.weightedAverageCostPerKg, dashboard.currencyCode)} />
            <MiniMetric label="Available batches" value={String(dashboard.inventory.batchCount)} />
          </View>
          <Text style={styles.sectionTitle}>Stock movements</Text>
          {dashboard.inventory.movements.length ? dashboard.inventory.movements.map((item) => (
            <View key={item.type} style={styles.snapshotRow}>
              <Text style={styles.snapshotLabel}>{item.type}</Text>
              <Text style={styles.snapshotValue}>{formatQuantity(item.quantityKg)} kg · {item.count}</Text>
            </View>
          )) : <Text style={styles.emptyDescription}>No stock movements recorded for this warehouse.</Text>}
          <Text style={styles.sectionTitle}>Inventory batches</Text>
          {dashboard.inventory.batches.length ? dashboard.inventory.batches.map((batch) => (
            <View key={batch.id} style={styles.record}>
              <Text style={styles.warehouseName}>{batch.lotNumber}</Text>
              <Text style={styles.muted}>{formatQuantity(batch.quantityKg)} kg · {formatQuantity(batch.unitCostPerKg)} / kg · value {formatQuantity(batch.inventoryValue)}</Text>
              <Text style={styles.activeTag}>{batch.status.toUpperCase()}</Text>
            </View>
          )) : <Text style={styles.emptyDescription}>No inventory batches in this warehouse.</Text>}
        </>
      ) : null}
      {dashboard && activeTab === 'expenses' ? (
        <>
          <View style={[styles.filterGrid, isPhone && styles.filterGridPhone]}>
            <DateTimePicker label="From" value={filters.from} showTime={false} onChange={(value) => onChangeFilters('from', value)} />
            <DateTimePicker label="To" value={filters.to} showTime={false} onChange={(value) => onChangeFilters('to', value)} />
            <RecordPicker
              label="Category"
              value={filters.category}
              options={expenseReferenceOptions.expenseCategories ?? []}
              loading={referenceOptionsLoading}
              error={referenceOptionsError}
              placeholder="All categories"
              valueField="name"
              onChange={(value) => onChangeFilters('category', value)}
            />
            <RecordPicker
              label="Truck"
              value={filters.truckId}
              options={(expenseReferenceOptions.trucks ?? []).filter((option) =>
                !dashboard || String(option.warehouseId ?? '') === dashboard.warehouse.id,
              )}
              loading={referenceOptionsLoading}
              error={referenceOptionsError}
              placeholder="All trucks"
              onChange={(value) => onChangeFilters('truckId', value)}
            />
            <RecordPicker
              label="Trip"
              value={filters.tripId}
              options={(expenseReferenceOptions.trips ?? []).filter((option) =>
                !dashboard || String(option.warehouseId ?? '') === dashboard.warehouse.id,
              )}
              loading={referenceOptionsLoading}
              error={referenceOptionsError}
              placeholder="All trips"
              onChange={(value) => onChangeFilters('tripId', value)}
            />
            <AppInput placeholder="Payment status" value={filters.paymentStatus} onChangeText={(value) => onChangeFilters('paymentStatus', value)} />
          </View>
          {referenceOptionsError ? <ErrorText message={referenceOptionsError} /> : null}
          <PrimaryButton label="Apply expense filters" onPress={onApplyFilters} disabled={false} />
          <View style={[styles.dashboardMetricGrid, isPhone && styles.dashboardMetricGridPhone]}>
            <MiniMetric label="Filtered expenses" value={formatCurrency(dashboard.expenses.total, dashboard.currencyCode)} />
            <MiniMetric label="This month" value={formatCurrency(dashboard.expenses.monthly, dashboard.currencyCode)} />
            <MiniMetric label="Fuel this month" value={formatCurrency(dashboard.expenses.monthlyFuel, dashboard.currencyCode)} />
            <MiniMetric label="Maintenance this month" value={formatCurrency(dashboard.expenses.monthlyMaintenance, dashboard.currencyCode)} />
          </View>
          {dashboard.expenses.unconvertedCount > 0 ? (
            <View style={styles.warningBanner}>
              <Text style={styles.noticeText}>
                {dashboard.expenses.unconvertedCount} matching expense(s) lack a base-currency amount and are excluded from these totals.
              </Text>
            </View>
          ) : null}
          <DashboardBars rows={dashboard.expenses.byCategory.map((row) => ({
            label: `${row.category} (${row.count})`,
            value: row.amount,
            detail: formatCurrency(row.amount, dashboard.currencyCode),
          }))} />
          <Text style={styles.sectionTitle}>Expense records (latest {dashboard.expenses.limit})</Text>
          {dashboard.expenses.records.length ? dashboard.expenses.records.map((expense) => (
            <View key={expense.id} style={styles.record}>
              <Text style={styles.warehouseName}>{expense.category} · {formatCurrency(expense.amount, expense.currencyCode || 'USD')}</Text>
              <Text style={styles.muted}>{expense.incurredAt ? new Date(expense.incurredAt).toLocaleDateString() : 'Date unavailable'} · {expense.paymentStatus} · {expense.costCenterType}</Text>
              <Text style={styles.muted}>
                Truck: {displayReferenceOption(expenseReferenceOptions.trucks, expense.truckId, 'Not linked')} · Trip: {displayReferenceOption(expenseReferenceOptions.trips, expense.tripId, 'Not linked')}
              </Text>
            </View>
          )) : <Text style={styles.emptyDescription}>No expenses match these filters.</Text>}
        </>
      ) : null}
      {dashboard && activeTab === 'trucks' ? (
        <>
          <View style={[styles.dashboardMetricGrid, isPhone && styles.dashboardMetricGridPhone]}>
            <MiniMetric label="Assigned" value={String(dashboard.trucks.total)} />
            <MiniMetric label="Active" value={String(dashboard.trucks.active)} />
            <MiniMetric label="On trips" value={String(dashboard.trucks.onTrip)} />
            <MiniMetric label="Available" value={String(dashboard.trucks.available)} />
            <MiniMetric label="Fuel this month" value={formatCurrency(dashboard.trucks.monthlyFuel, dashboard.currencyCode)} />
            <MiniMetric label="Maintenance this month" value={formatCurrency(dashboard.trucks.monthlyMaintenance, dashboard.currencyCode)} />
          </View>
          {dashboard.trucks.records.length ? dashboard.trucks.records.map((truck) => (
            <View key={truck.id} style={styles.record}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setSelectedTruckId((current) => current === truck.id ? null : truck.id)}
              >
                <Text style={styles.linkText}>{truck.name} · {truck.registrationNumber} · View profile</Text>
              </Pressable>
              <Text style={styles.muted}>{truck.status} · Driver: {truck.driverName ?? 'Unassigned'} · Expenses: {formatCurrency(truck.expenseTotal, dashboard.currencyCode)}</Text>
              {warehouses.filter((warehouse) => warehouse._id !== dashboard.warehouse.id).map((warehouse) => (
                <ActionButton
                  key={warehouse._id}
                  label={transferBusyId === truck.id ? 'Transferring…' : `Transfer to ${warehouse.name}`}
                  disabled={!!transferBusyId}
                  onPress={() => void transferTruck(truck.id, warehouse._id)}
                />
              ))}
            </View>
          )) : <Text style={styles.emptyDescription}>No trucks are assigned to this warehouse.</Text>}
          {selectedTruckId ? (() => {
            const truck = dashboard.trucks.records.find((record) => record.id === selectedTruckId);
            if (!truck) return null;
            const truckTrips = dashboard.trips.records.filter((trip) => trip.truckId === truck.id);
            const truckExpenses = dashboard.expenses.records.filter((expense) => expense.truckId === truck.id);
            return (
              <View style={styles.truckProfile}>
                <View style={styles.warehouseHeading}>
                  <Text style={styles.sectionTitle}>Truck profile</Text>
                  <ActionButton label="Close" onPress={() => setSelectedTruckId(null)} />
                </View>
                <Text style={styles.warehouseName}>{truck.name} · {truck.registrationNumber}</Text>
                <Text style={styles.muted}>Status: {truck.status} · Driver: {truck.driverName ?? 'Unassigned'}</Text>
                <Text style={styles.muted}>Recorded expenses: {formatCurrency(truck.expenseTotal, dashboard.currencyCode)}</Text>
                <Text style={styles.cardEyebrow}>TRIPS</Text>
                {truckTrips.length ? truckTrips.map((trip) => (
                  <Text key={trip.id} style={styles.muted}>{trip.status} · {formatQuantity(trip.transportedQuantityKg)} kg · Shipment {trip.shipmentId ? 'Linked' : 'Not linked'}</Text>
                )) : <Text style={styles.emptyDescription}>No trips in this warehouse are linked to this truck.</Text>}
                <Text style={styles.cardEyebrow}>EXPENSE RECORDS</Text>
                {truckExpenses.length ? truckExpenses.map((expense) => (
                  <Text key={expense.id} style={styles.muted}>{expense.category} · {formatCurrency(expense.amount, expense.currencyCode || dashboard.currencyCode)} · {new Date(expense.incurredAt).toLocaleDateString()}</Text>
                )) : <Text style={styles.emptyDescription}>No recent expense records for this truck.</Text>}
              </View>
            );
          })() : null}
          {transferError ? <ErrorText message={transferError} /> : null}
        </>
      ) : null}
      {dashboard && activeTab === 'trips' ? (
        <>
          <View style={[styles.dashboardMetricGrid, isPhone && styles.dashboardMetricGridPhone]}>
            <MiniMetric label="All trips" value={String(dashboard.trips.total)} />
            <MiniMetric label="Completed" value={String(dashboard.trips.completed)} />
            <MiniMetric label="Active" value={String(dashboard.trips.active)} />
            <MiniMetric label="Pending" value={String(dashboard.trips.pending)} />
            <MiniMetric label="Cancelled" value={String(dashboard.trips.cancelled)} />
            <MiniMetric label="Transported" value={`${formatQuantity(dashboard.trips.transportedKg)} kg`} />
          </View>
          {dashboard.trips.records.length ? dashboard.trips.records.map((trip) => (
            <View key={trip.id} style={styles.record}>
              <Text style={styles.warehouseName}>Trip · {trip.status}</Text>
              <Text style={styles.muted}>{formatQuantity(trip.transportedQuantityKg)} kg · Truck: {trip.truckName ?? 'Unassigned'} · Driver: {trip.driverName ?? 'Unassigned'}</Text>
              <Text style={styles.muted}>Shipment: {trip.shipmentId ? 'Linked' : 'Not linked'} · {trip.startedAt ? new Date(trip.startedAt).toLocaleDateString() : 'Not started'}</Text>
            </View>
          )) : <Text style={styles.emptyDescription}>No trips or shipments are associated with this warehouse.</Text>}
        </>
      ) : null}
      {dashboard && activeTab === 'materials' ? (
        <>
          <View style={[styles.dashboardMetricGrid, isPhone && styles.dashboardMetricGridPhone]}>
            <MiniMetric label="Material records" value={String(dashboard.materials.count)} />
            <MiniMetric label="Material movements" value={String(dashboard.materials.movements)} />
          </View>
          <Text style={styles.sectionTitle}>Materials on hand</Text>
          {dashboard.materials.records.length ? dashboard.materials.records.map((material) => (
            <View key={material.id} style={styles.record}>
              <Text style={styles.warehouseName}>{material.name}</Text>
              <Text style={styles.muted}>{formatQuantity(material.quantityOnHand)} units · Unit cost {formatCurrency(material.unitCost, dashboard.currencyCode)} · Value {formatCurrency(material.inventoryValue, dashboard.currencyCode)}</Text>
            </View>
          )) : <Text style={styles.emptyDescription}>No material records for this warehouse.</Text>}
          <Text style={styles.sectionTitle}>Material movements</Text>
          {dashboard.materials.movementSummary.length ? dashboard.materials.movementSummary.map((movement) => (
            <View key={movement.type} style={styles.snapshotRow}>
              <Text style={styles.snapshotLabel}>{movement.type}</Text>
              <Text style={styles.snapshotValue}>{formatQuantity(movement.quantity)} · {movement.count} records</Text>
            </View>
          )) : <Text style={styles.emptyDescription}>No material movements recorded.</Text>}
        </>
      ) : null}
      {dashboard && activeTab === 'reports' ? (
        <View style={styles.section}>
          <Text style={styles.cardEyebrow}>WAREHOUSE REPORT SNAPSHOT</Text>
          <Text style={styles.sectionTitle}>Operational summary</Text>
          <View style={styles.snapshotRow}><Text style={styles.snapshotLabel}>Inventory value</Text><Text style={styles.snapshotValue}>{formatCurrency(dashboard.inventory.inventoryValue, dashboard.currencyCode)}</Text></View>
          <View style={styles.snapshotRow}><Text style={styles.snapshotLabel}>Monthly expenses</Text><Text style={styles.snapshotValue}>{formatCurrency(dashboard.expenses.monthly, dashboard.currencyCode)}</Text></View>
          <View style={styles.snapshotRow}><Text style={styles.snapshotLabel}>Total trips</Text><Text style={styles.snapshotValue}>{dashboard.trips.total}</Text></View>
          <View style={styles.snapshotRow}><Text style={styles.snapshotLabel}>Transported quantity</Text><Text style={styles.snapshotValue}>{formatQuantity(dashboard.trips.transportedKg)} kg</Text></View>
          <Text style={styles.muted}>Values use records assigned to this warehouse and are scoped to the signed-in company.</Text>
        </View>
      ) : null}
      {dashboard && activeTab === 'commercial' ? (
        <View style={styles.dashboardMetricGrid}>
          <MiniMetric label="Purchases" value={String(dashboard.operations.purchases)} />
          <MiniMetric label="Purchase orders" value={String(dashboard.operations.purchaseOrders)} />
          <MiniMetric label="Sales / income" value={String(dashboard.operations.sales)} />
          <MiniMetric label="Sales orders" value={String(dashboard.operations.salesOrders)} />
          <MiniMetric label="Supplier payments" value={String(dashboard.operations.supplierPayments)} />
          <MiniMetric label="Supplier advances" value={String(dashboard.operations.supplierAdvances)} />
          <MiniMetric label="Customer receipts" value={String(dashboard.operations.customerPayments)} />
          <MiniMetric label="Customer advances" value={String(dashboard.operations.customerAdvances)} />
        </View>
      ) : null}
    </View>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  const { width } = useWindowDimensions();
  return (
    <View style={[styles.dashboardMetric, width < 600 && styles.dashboardMetricPhone]}>
      <Text style={styles.dashboardMetricValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function useExpenseReferenceOptions(request: ApiRequest, enabled = true) {
  const [options, setOptions] = useState<Record<string, ModuleRecord[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setOptions({});
    setLoading(true);
    setError('');
    void Promise.all(['warehouses', 'trucks', 'trips', 'expenseCategories'].map(async (source) => {
      try {
        return {
          source,
          records: await request<ModuleRecord[]>(`/dashboard/company/module-options/${source}`),
          error: '',
        };
      } catch (cause) {
        return {
          source,
          records: [],
          error: cause instanceof Error ? cause.message : `Unable to load ${source}`,
        };
      }
    })).then((results) => {
      if (!active) return;
      setOptions(Object.fromEntries(results.map(({ source, records }) => [
        source,
        records.map((record) => ({
          ...record,
          displayName: moduleReferenceLabel(source, record),
        })),
      ])));
      const failures = results.filter((result) => result.error);
      if (failures.length) {
        setError(failures.map(({ source, error: sourceError }) => `${source}: ${sourceError}`).join('\n'));
      }
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [enabled, request]);
  return { options, loading, error };
}

function moduleReferenceLabel(source: string, record: ModuleRecord): string {
  if (source === 'trips') {
    const status = typeof record.status === 'string' ? record.status : '';
    const startedAt = typeof record.startedAt === 'string' ? new Date(record.startedAt) : null;
    const dateLabel = startedAt && !Number.isNaN(startedAt.getTime())
      ? startedAt.toLocaleDateString()
      : '';
    return ['Trip', status, dateLabel].filter(Boolean).join(' · ');
  }
  const name = moduleOptionLabel(record);
  return source === 'warehouses' && record.code
    ? `${name} · ${String(record.code)}`
    : source === 'trucks' && record.registrationNumber
      ? `${name} · ${String(record.registrationNumber)}`
      : name;
}

function CompanyExpenses({
  request,
  initialCategory,
  externalRefreshKey,
  onOpenWarehouse,
}: {
  request: ApiRequest;
  initialCategory: string;
  externalRefreshKey: number;
  onOpenWarehouse: (id: string) => void;
}) {
  const { width } = useWindowDimensions();
  const isPhone = width < 600;
  const [filters, setFilters] = useState<ExpenseFilters>({
    from: '',
    to: '',
    category: initialCategory,
    truckId: '',
    tripId: '',
    paymentStatus: '',
  });
  const [query, setQuery] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [result, setResult] = useState<CompanyExpenseRecords | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const automaticRetryKey = useRef('');
  const { options, loading: optionsLoading, error: optionsError } = useExpenseReferenceOptions(request);
  useEffect(() => {
    setFilters((current) => ({ ...current, category: initialCategory }));
    const params = new URLSearchParams();
    if (initialCategory) params.set('category', initialCategory);
    setQuery(params.toString());
  }, [initialCategory]);
  useEffect(() => {
    const interval = setInterval(
      () => setRefreshKey((current) => current + 1),
      AUTO_REFRESH_INTERVAL_MS,
    );
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    setError('');
    void request<CompanyExpenseRecords>(`/dashboard/expenses${query ? `?${query}` : ''}`)
      .then((data) => {
        if (!active) return;
        setResult(data);
        const retryKey = `${query}:${externalRefreshKey}`;
        if (data.unconvertedCount > 0 && automaticRetryKey.current !== retryKey) {
          automaticRetryKey.current = retryKey;
          retryTimer = setTimeout(() => {
            if (active) setRefreshKey((current) => current + 1);
          }, 1_000);
        }
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load expense records'); })
      .finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [externalRefreshKey, query, refreshKey, request]);
  const applyFilters = () => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value.trim()) params.set(key, value.trim()); });
    setQuery(params.toString());
  };
  return (
    <View style={styles.section}>
      <Text style={styles.cardEyebrow}>COMPANY-WIDE EXPENSES</Text>
      <Text style={styles.sectionTitle}>Expense records</Text>
      <Text style={styles.muted}>Each canonical expense is listed once and retains its warehouse, truck and trip links.</Text>
      <View style={[styles.filterGrid, isPhone && styles.filterGridPhone]}>
        <DateTimePicker label="From" value={filters.from} showTime={false} onChange={(value) => setFilters((current) => ({ ...current, from: value }))} />
        <DateTimePicker label="To" value={filters.to} showTime={false} onChange={(value) => setFilters((current) => ({ ...current, to: value }))} />
        <RecordPicker
          label="Category"
          value={filters.category}
          options={options.expenseCategories ?? []}
          loading={optionsLoading}
          error={optionsError}
          placeholder="All categories"
          valueField="name"
          onChange={(value) => setFilters((current) => ({ ...current, category: value }))}
        />
        <RecordPicker
          label="Truck"
          value={filters.truckId}
          options={options.trucks ?? []}
          loading={optionsLoading}
          error={optionsError}
          placeholder="All trucks"
          onChange={(value) => setFilters((current) => ({ ...current, truckId: value }))}
        />
        <RecordPicker
          label="Trip"
          value={filters.tripId}
          options={options.trips ?? []}
          loading={optionsLoading}
          error={optionsError}
          placeholder="All trips"
          onChange={(value) => setFilters((current) => ({ ...current, tripId: value }))}
        />
        <AppInput placeholder="Payment status" value={filters.paymentStatus} onChangeText={(value) => setFilters((current) => ({ ...current, paymentStatus: value }))} />
      </View>
      {optionsError ? <ErrorText message={optionsError} /> : null}
      <PrimaryButton label="Apply filters" onPress={applyFilters} disabled={false} />
      {loading ? <ActivityIndicator color={theme.colors.primary} style={styles.detailLoading} /> : null}
      {error ? <ErrorText message={error} /> : null}
      {result ? (
        <>
          <View style={styles.snapshotRow}><Text style={styles.snapshotLabel}>Matching expense total ({result.currencyCode})</Text><Text style={styles.snapshotValue}>{formatCurrency(result.total, result.currencyCode)}</Text></View>
          <View style={styles.snapshotRow}><Text style={styles.snapshotLabel}>Matching records</Text><Text style={styles.snapshotValue}>{result.count}</Text></View>
          {result.unconvertedCount > 0 && result.conversionError ? (
            <View style={styles.warningBanner}>
              <Text style={styles.noticeText}>
                {result.unconvertedCount} record(s) still lack a base-currency amount and are excluded from the total.
                {' '}Conversion issue: {result.conversionError}
              </Text>
            </View>
          ) : null}
          <Text style={styles.muted}>Showing up to {result.limit} most recent records.</Text>
          {result.records.map((expense) => (
            <View key={expense.id} style={styles.record}>
              <Text style={styles.warehouseName}>{expense.category} · {formatCurrency(expense.amount, expense.currencyCode || 'USD')}</Text>
              <Text style={styles.muted}>{new Date(expense.incurredAt).toLocaleDateString()} · {expense.paymentStatus} · {expense.costCenterType}</Text>
              <Text style={styles.muted}>
                Warehouse: {displayReferenceOption(options.warehouses, expense.warehouseId, 'Not linked')} · Truck: {displayReferenceOption(options.trucks, expense.truckId, 'Not linked')} · Trip: {displayReferenceOption(options.trips, expense.tripId, 'Not linked')}
              </Text>
              <ActionButton label="Open warehouse" onPress={() => onOpenWarehouse(expense.warehouseId)} disabled={!expense.warehouseId} />
            </View>
          ))}
          {result.records.length === 0 ? <Text style={styles.emptyDescription}>No expense records match these filters.</Text> : null}
        </>
      ) : null}
    </View>
  );
}

function JobRolePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: (typeof workerJobRoles)[number]['value']) => void;
}) {
  return (
    <View style={styles.moduleField}>
      <Text style={styles.inputLabel}>Worker job role</Text>
      <View style={styles.roleOptions}>
        {workerJobRoles.map((role) => (
          <Pressable
            key={role.value}
            accessibilityRole="button"
            accessibilityState={{ selected: role.value === value }}
            onPress={() => onChange(role.value)}
            style={[
              styles.roleOption,
              role.value === value && styles.roleOptionActive,
            ]}
          >
            <Text style={[
              styles.roleOptionText,
              role.value === value && styles.roleOptionTextActive,
            ]}>{role.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function DriverSpecialtyPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.moduleField}>
      <Text style={styles.inputLabel}>Driver specialty</Text>
      <Text style={styles.muted}>Choose the driver’s primary qualification.</Text>
      <View style={styles.roleOptions}>
        {driverSpecialties.map((specialty) => {
          const selected = value === specialty.value;
          return (
            <Pressable
              key={specialty.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange(specialty.value)}
              style={[styles.roleOption, selected && styles.roleOptionActive]}
            >
              <Text style={[styles.roleOptionText, selected && styles.roleOptionTextActive]}>
                {selected ? '✓ ' : ''}{specialty.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function WarehouseAssignmentPicker({
  warehouses,
  value,
  onChange,
  onCreateWarehouse,
  loading = false,
  error = '',
}: {
  warehouses: Warehouse[];
  value: string[];
  onChange: (value: string[]) => void;
  onCreateWarehouse?: () => void;
  loading?: boolean;
  error?: string;
}) {
  return (
    <View style={styles.moduleField}>
      <Text style={styles.inputLabel}>Assigned warehouses</Text>
      <Text style={styles.muted}>Select every warehouse this worker can access.</Text>
      {warehouses.length ? (
        <View style={styles.roleOptions}>
          {warehouses.map((warehouse) => {
            const selected = value.includes(warehouse._id);
            return (
              <Pressable
                key={warehouse._id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                onPress={() => onChange(selected
                  ? value.filter((id) => id !== warehouse._id)
                  : [...value, warehouse._id])}
                style={[styles.roleOption, selected && styles.roleOptionActive]}
              >
                <Text style={[styles.roleOptionText, selected && styles.roleOptionTextActive]}>
                  {selected ? '✓ ' : ''}{warehouse.name} · {warehouse.code}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : loading ? (
        <Text style={styles.muted}>Loading active warehouses…</Text>
      ) : error ? (
        <Text style={styles.error}>Warehouse assignments could not be loaded.</Text>
      ) : (
        <View style={styles.actions}>
          <Text style={styles.muted}>No active warehouses are available yet.</Text>
          {onCreateWarehouse ? (
            <ActionButton label="Create warehouse" onPress={onCreateWarehouse} />
          ) : null}
        </View>
      )}
    </View>
  );
}

function TaskManagement({
  request,
  workers,
  externalRefreshKey,
}: {
  request: ApiRequest;
  workers: Worker[];
  externalRefreshKey: number;
}) {
  const { width } = useWindowDimensions();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [route, setRoute] = useState('');
  const [truckId, setTruckId] = useState('');
  const [truckOptions, setTruckOptions] = useState<ModuleRecord[]>([]);
  const [trucksLoading, setTrucksLoading] = useState(false);
  const [trucksError, setTrucksError] = useState('');
  const [priority, setPriority] = useState<TaskItem['priority']>('normal');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const selectedAssignee = workers.find((worker) => worker._id === assigneeId);
  const assigningToDriver = selectedAssignee?.role === 'driver';

  useEffect(() => {
    let active = true;
    setTruckId('');
    setRoute('');
    setTrucksError('');
    if (!assigningToDriver) {
      setTruckOptions([]);
      setTrucksLoading(false);
      return () => { active = false; };
    }
    setTrucksLoading(true);
    void request<ModuleRecord[]>('/dashboard/company/module-options/trucks')
      .then((records) => { if (active) setTruckOptions(records); })
      .catch((cause: unknown) => {
        if (active) setTrucksError(cause instanceof Error ? cause.message : 'Unable to load company trucks');
      })
      .finally(() => { if (active) setTrucksLoading(false); });
    return () => { active = false; };
  }, [assigneeId, assigningToDriver, request]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void request<TaskItem[]>('/tasks')
      .then((records) => { if (active) setTasks(records); })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load tasks');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [externalRefreshKey, refreshKey, request]);
  useEffect(() => {
    const interval = setInterval(
    () => setRefreshKey((current) => current + 1),
    AUTO_REFRESH_INTERVAL_MS,
    );
    return () => clearInterval(interval);
  }, []);
  const createTask = async () => {
    setSaving(true);
    setError('');
    try {
      await request('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          assigneeId,
          title: title.trim(),
          description: description.trim(),
          dueAt: dueAt.trim() || undefined,
          truckId: assigningToDriver ? truckId || undefined : undefined,
          route: assigningToDriver ? route.trim() || undefined : undefined,
          priority,
        }),
      });
      setTitle('');
      setDescription('');
      setDueAt('');
      setAssigneeId('');
      setRoute('');
      setTruckId('');
      setPriority('normal');
      setRefreshKey((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create task');
    } finally {
      setSaving(false);
    }
  };
  const updateTask = async (task: TaskItem, updates: Partial<TaskItem>) => {
    setError('');
    try {
      await request(`/tasks/${encodeURIComponent(task._id)}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
      setRefreshKey((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update task');
    }
  };
  const deleteTask = async (task: TaskItem) => {
    setError('');
    try {
      await request(`/tasks/${encodeURIComponent(task._id)}`, { method: 'DELETE' });
      setRefreshKey((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to delete task');
    }
  };

  return (
    <>
      <View style={styles.section}>
        <Text style={styles.cardEyebrow}>TEAM OPERATIONS</Text>
        <Text style={styles.sectionTitle}>Assign a task</Text>
        <Text style={styles.muted}>Choose an active worker in your company. They will see the task in their workspace.</Text>
        <AppInput placeholder="Task title" value={title} onChangeText={setTitle} maxLength={160} />
        <AppInput placeholder="Details or instructions (optional)" value={description} onChangeText={setDescription} multiline style={styles.moduleTextArea} />
        <DateTimePicker label="Due date (optional)" value={dueAt} onChange={setDueAt} />
        <Text style={styles.inputLabel}>Assign to</Text>
        <View style={[styles.taskAssignees, width < 600 && styles.taskAssigneesPhone]}>
          {workers.filter((worker) => worker.status === 'active').map((worker) => (
            <Pressable
              key={worker._id}
              accessibilityRole="button"
              accessibilityState={{ selected: assigneeId === worker._id }}
              onPress={() => setAssigneeId(worker._id)}
              style={[styles.roleOption, assigneeId === worker._id && styles.roleOptionActive]}
            >
              <Text style={[styles.roleOptionText, assigneeId === worker._id && styles.roleOptionTextActive]}>
                {worker.name} · {workerRoleLabel(worker.role)}
              </Text>
            </Pressable>
          ))}
          {workers.every((worker) => worker.status !== 'active') ? (
            <Text style={styles.emptyDescription}>Create an active worker account before assigning tasks.</Text>
          ) : null}
        </View>
        {assigningToDriver ? (
          <>
            <RecordPicker
              label="Assigned truck (optional)"
              value={truckId}
              options={truckOptions}
              loading={trucksLoading}
              error={trucksError}
              placeholder="Choose an active company truck"
              emptyMessage="No active company trucks are available."
              onChange={setTruckId}
            />
            <AppInput
              placeholder="Route or destination (optional)"
              value={route}
              onChangeText={setRoute}
              maxLength={500}
            />
          </>
        ) : null}
        <Text style={styles.inputLabel}>Priority</Text>
        <View style={styles.roleOptions}>
          {(['low', 'normal', 'high'] as const).map((value) => (
            <Pressable key={value} onPress={() => setPriority(value)} style={[styles.roleOption, priority === value && styles.roleOptionActive]}>
              <Text style={[styles.roleOptionText, priority === value && styles.roleOptionTextActive]}>
                {value[0].toUpperCase() + value.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>
        <ErrorText message={error} />
        <PrimaryButton label={saving ? 'Assigning…' : 'Assign task'} onPress={() => void createTask()} disabled={saving || !title.trim() || !assigneeId || workers.every((worker) => worker.status !== 'active')} />
      </View>
      <View style={styles.section}>
        <Text style={styles.cardEyebrow}>ASSIGNED WORK</Text>
        <Text style={styles.sectionTitle}>Company tasks</Text>
        {loading ? <ActivityIndicator color={theme.colors.primary} style={styles.detailLoading} /> : null}
        {!loading && !tasks.length ? <Text style={styles.emptyDescription}>No tasks assigned yet.</Text> : null}
        {tasks.map((task) => {
          const assignee = typeof task.assigneeId === 'object' ? task.assigneeId : null;
          return (
            <View key={task._id} style={styles.taskCard}>
              <View style={styles.taskHeading}>
                <Text style={styles.moduleRecordTitle}>{task.title}</Text>
                <Text style={[styles.taskStatus, task.status === 'completed' && styles.taskStatusComplete]}>
                  {task.status === 'pending_confirmation' ? 'PENDING CONFIRMATION' : task.status.replace('_', ' ').toUpperCase()}
                </Text>
              </View>
              <Text style={styles.muted}>
                {assignee ? `${assignee.name} · ${workerRoleLabel(assignee.role ?? '')}` : 'Assigned worker'} · {task.priority} priority
                {task.dueAt ? ` · Due ${new Date(task.dueAt).toLocaleDateString()}` : ''}
              </Text>
              {task.description ? <Text style={styles.noticeText}>{task.description}</Text> : null}
              {typeof task.truckId === 'object' && task.truckId ? (
                <Text style={styles.muted}>
                  Truck: {task.truckId.name} · {task.truckId.registrationNumber}
                </Text>
              ) : null}
              {task.route ? <Text style={styles.muted}>Route: {task.route}</Text> : null}
              <View style={styles.actions}>
                {task.status !== 'completed' && (
                  task.status === 'pending_confirmation' && task.managerConfirmedAt
                    ? <Text style={styles.muted}>You confirmed completion. Waiting for the worker to confirm.</Text>
                    : (
                  <ActionButton
                    label={task.status === 'open' ? 'Start task' : task.status === 'pending_confirmation' ? 'Confirm completion' : 'Confirm task completed'}
                    onPress={() => void updateTask(task, { status: task.status === 'open' ? 'in_progress' : 'completed' })}
                  />
                    )
                )}
                <ActionButton label="Delete" destructive onPress={() => void deleteTask(task)} />
              </View>
            </View>
          );
        })}
      </View>
    </>
  );
}

function WorkerWorkspace({
  session,
  request,
  onRefreshSession,
  onSignOut,
  onChangePassword,
}: {
  session: Session | null;
  request: ApiRequest;
  onRefreshSession: () => Promise<void>;
  onSignOut: () => void;
  onChangePassword: () => void;
}) {
  const { width } = useWindowDimensions();
  const isPhone = width < 600;
  const [activeSection, setActiveSection] = useState('tasks');
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let active = true;
    if (refreshKey === 0) setLoading(true);
    setError('');
    void request<TaskItem[]>('/tasks')
      .then((records) => { if (active) setTasks(records); })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load assigned tasks');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshKey, request]);
  useEffect(() => {
    const interval = setInterval(
      () => setRefreshKey((current) => current + 1),
      AUTO_REFRESH_INTERVAL_MS,
    );
    return () => clearInterval(interval);
  }, []);
  const refreshCurrentScreen = useCallback(async () => {
    if (activeSection === 'account') {
      await onRefreshSession();
      return;
    }
    setTasks(await request<TaskItem[]>('/tasks'));
    setError('');
  }, [activeSection, onRefreshSession, request]);
  const { refreshing, refreshError, onRefresh: refreshScreen } = usePullToRefresh(refreshCurrentScreen);
  const setTaskStatus = async (task: TaskItem, status: TaskItem['status']) => {
    setError('');
    try {
      await request(`/tasks/${encodeURIComponent(task._id)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setRefreshKey((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update task status');
    }
  };
  return (
    <View style={[styles.dashboardShell, width <= 900 && styles.dashboardShellMobile]}>
      <DashboardSidebar
        activeSection={activeSection}
        groups={[{ label: 'WORKSPACE', sections: [{ id: 'tasks', label: 'My tasks' }, { id: 'account', label: 'Account' }] }]}
        identity={session?.profile.companyId?.name ?? 'Company workspace'}
        onSelect={setActiveSection}
      />
      <View style={styles.dashboardMain}>
        <View style={[styles.workerWorkspace, isPhone && styles.workerWorkspacePhone]}>
          <DashboardHeader
            title={activeSection === 'account' ? 'Account' : 'My tasks'}
            subtitle={`${session?.profile.name ?? 'Team member'} · ${workerRoleLabel(session?.profile.role ?? 'worker')}`}
          />
          {activeSection === 'account' ? (
            <ScrollView
              contentContainerStyle={styles.workerTaskList}
              refreshControl={Platform.OS === 'web' ? undefined : (
                createPullToRefreshControl(refreshing, refreshScreen)
              )}
            >
              <ErrorText message={refreshError} />
              <AccountSettingsScreen
                name={session?.profile.name ?? 'Team member'}
                username={session?.profile.username ?? ''}
                email={session?.profile.email}
                phoneNumber={session?.profile.phoneNumber}
                role={workerRoleLabel(session?.profile.role ?? 'worker')}
                onChangePassword={onChangePassword}
                onSignOut={onSignOut}
              />
            </ScrollView>
          ) : (
          <ScrollView
            contentContainerStyle={styles.workerTaskList}
            refreshControl={Platform.OS === 'web' ? undefined : (
              createPullToRefreshControl(refreshing, refreshScreen)
            )}
          >
              <ErrorText message={refreshError} />
              <View style={styles.section}>
                <Text style={styles.cardEyebrow}>YOUR WORKSPACE</Text>
                <Text style={styles.sectionTitle}>Tasks from your manager</Text>
                <Text style={styles.muted}>Update each task as you start and finish your work.</Text>
                {session?.profile.role === 'driver' && session.profile.specialty ? (
                  <Text style={styles.muted}>
                    Your specialty: {driverSpecialtyLabel(session.profile.specialty)}
                  </Text>
                ) : null}
              </View>
              <ErrorText message={error} />
              {loading ? <ActivityIndicator color={theme.colors.primary} style={styles.detailLoading} /> : null}
              {!loading && !tasks.length ? (
                <View style={styles.section}>
                  <Text style={styles.emptyTitle}>No tasks yet</Text>
                  <Text style={styles.emptyDescription}>Tasks assigned by your company manager will appear here.</Text>
                </View>
              ) : null}
              {tasks.map((task) => (
                <View key={task._id} style={styles.taskCard}>
                  <View style={styles.taskHeading}>
                    <Text style={styles.moduleRecordTitle}>{task.title}</Text>
                    <Text style={[styles.taskStatus, task.status === 'completed' && styles.taskStatusComplete]}>
                      {task.status === 'pending_confirmation' ? 'PENDING CONFIRMATION' : task.status.replace('_', ' ').toUpperCase()}
                    </Text>
                  </View>
                  <Text style={styles.muted}>
                    {task.priority.toUpperCase()} PRIORITY{task.dueAt ? ` · DUE ${new Date(task.dueAt).toLocaleDateString()}` : ''}
                  </Text>
                  {task.description ? <Text style={styles.noticeText}>{task.description}</Text> : null}
                  {typeof task.truckId === 'object' && task.truckId ? (
                    <Text style={styles.muted}>
                      Truck: {task.truckId.name} · {task.truckId.registrationNumber}
                    </Text>
                  ) : null}
                  {task.route ? <Text style={styles.muted}>Route: {task.route}</Text> : null}
                  {task.status !== 'completed' && (
                    task.status === 'pending_confirmation' && task.workerConfirmedAt
                      ? <Text style={styles.muted}>You confirmed completion. Waiting for your manager to confirm.</Text>
                      : (
                    <ActionButton
                      label={task.status === 'open' ? 'Start task' : task.status === 'pending_confirmation' ? 'Confirm completion' : 'Confirm task completed'}
                      onPress={() => void setTaskStatus(task, task.status === 'open' ? 'in_progress' : 'completed')}
                    />
                      )
                  )}
                </View>
              ))}
          </ScrollView>
              )}
        </View>
      </View>
    </View>
  );
}

function DashboardSidebar({
  activeSection,
  groups,
  identity,
  onSelect,
}: {
  activeSection: string;
  groups: NavigationGroup[];
  identity: string;
  onSelect: (section: string) => void;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [drawerVisible, setDrawerVisible] = useState(false);
  const drawerTranslateX = useRef(new Animated.Value(-320)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const current = groups
    .flatMap((group) => group.sections)
    .find((section) => section.id === activeSection);
  const select = (section: string) => {
    onSelect(section);
    closeDrawer();
  };
  const openDrawer = () => {
    setDrawerVisible(true);
    requestAnimationFrame(() => {
      Animated.parallel([
        Animated.timing(drawerTranslateX, {
          toValue: 0,
          duration: 230,
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]).start();
    });
  };
  const closeDrawer = () => {
    Animated.parallel([
      Animated.timing(drawerTranslateX, {
        toValue: -320,
        duration: 190,
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 170,
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]).start(({ finished }) => {
      if (finished) setDrawerVisible(false);
    });
  };
  const items = (
    <ScrollView style={styles.sidebarItems} showsVerticalScrollIndicator={false}>
      {groups.map((group) => (
        <View key={group.label} style={styles.sidebarGroup}>
          <Text style={styles.sidebarGroupLabel}>{group.label}</Text>
          {group.sections.map((section) => (
            <Pressable
              key={section.id}
              accessibilityRole="button"
              accessibilityState={{ selected: activeSection === section.id }}
              onPress={() => select(section.id)}
              style={({ pressed }) => [
                styles.sidebarItem,
                width <= 900 && styles.sidebarItemMobile,
                activeSection === section.id && styles.sidebarItemActive,
                pressed && styles.controlPressed,
              ]}
            >
              <Text style={[
                styles.sidebarItemText,
                activeSection === section.id && styles.sidebarItemTextActive,
              ]}>
                {section.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
    </ScrollView>
  );

  if (width > 900) {
    return (
      <View style={styles.sidebar}>
        <View style={styles.sidebarBrand}>
          <View style={styles.sidebarLogo}><Text style={styles.sidebarLogoText}>C</Text></View>
          <View>
            <Text style={styles.sidebarBrandName}>ManageNest</Text>
            <Text style={styles.sidebarCaption}>BUSINESS WORKSPACE</Text>
          </View>
        </View>
        <View style={styles.sidebarIdentity}>
          <Text style={styles.sidebarIdentityLabel}>CURRENT WORKSPACE</Text>
          <Text numberOfLines={1} style={styles.sidebarIdentityName}>{identity}</Text>
        </View>
        {items}
        <Text style={styles.sidebarFooter}>ManageNest · Company-scoped workspace</Text>
      </View>
    );
  }

  return (
    <>
      <View style={styles.mobileNav}>
        <View style={[styles.sidebarBrand, styles.mobileNavBrand]}>
          <View style={styles.mobileSidebarLogo}><Text style={styles.sidebarLogoText}>C</Text></View>
          <View style={styles.flex}>
            <Text numberOfLines={1} style={styles.mobileNavTitle}>{current?.label ?? 'Overview'}</Text>
            <Text numberOfLines={1} style={styles.mobileNavSubtitle}>{identity}</Text>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open workspace navigation"
          accessibilityState={{ expanded: drawerVisible }}
          onPress={openDrawer}
          style={({ pressed }) => [styles.mobileMenuButton, pressed && styles.controlPressed]}
        >
          <View style={styles.mobileMenuIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={styles.mobileMenuLine} />
            <View style={styles.mobileMenuLine} />
            <View style={[styles.mobileMenuLine, styles.mobileMenuLineShort]} />
          </View>
          <Text style={styles.mobileMenuLabel}>Menu</Text>
        </Pressable>
      </View>
      <Modal
        visible={drawerVisible}
        transparent
        animationType="none"
        onRequestClose={closeDrawer}
      >
        <View style={styles.drawerBackdrop}>
          <Animated.View style={[styles.drawerScrim, { opacity: backdropOpacity }]} />
          <Pressable
            accessibilityLabel="Close navigation"
            style={StyleSheet.absoluteFill}
            onPress={closeDrawer}
          />
          <Animated.View
            style={[
              styles.drawer,
              {
                paddingTop: Math.max(26, insets.top + 16),
                paddingBottom: Math.max(18, insets.bottom + 12),
                paddingLeft: Math.max(18, insets.left + 18),
                paddingRight: Math.max(18, insets.right + 18),
                transform: [{ translateX: drawerTranslateX }],
              },
            ]}
          >
            <View style={styles.sidebarBrand}>
              <View style={styles.sidebarLogo}><Text style={styles.sidebarLogoText}>C</Text></View>
              <View style={styles.flex}>
                <Text style={styles.sidebarBrandName}>ManageNest</Text>
                <Text numberOfLines={1} style={styles.mobileNavSubtitle}>{identity}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close navigation" onPress={closeDrawer} style={styles.modalClose}>
                <Text style={styles.modalCloseText}>×</Text>
              </Pressable>
            </View>
            {items}
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

function DonutChart({
  total,
  segments,
}: {
  total: number;
  segments: { label: string; value: number; color: string }[];
}) {
  const radius = 43;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <View style={styles.donutLayout}>
      <View style={styles.donutWrap}>
        {Platform.OS === 'web' ? (
          <View
            style={styles.donutWebFallback}
            accessibilityRole="image"
            accessibilityLabel={`Chart breakdown: ${segments.map((segment) => `${segment.label} ${segment.value}`).join(', ')}`}
          >
            {segments.map((segment) => {
              const share = total > 0 ? (segment.value / total) * 100 : 0;
              if (!share) return null;
              return (
                <View
                  key={segment.label}
                  style={[styles.donutWebSegment, { width: `${share}%`, backgroundColor: segment.color }]}
                />
              );
            })}
          </View>
        ) : (
          <Svg width={118} height={118} viewBox="0 0 118 118">
            <Circle cx="59" cy="59" r={radius} fill="none" stroke={theme.colors.border} strokeWidth="12" />
            <G rotation="-90" origin="59, 59">
              {segments.map((segment) => {
                const length = total > 0 ? (segment.value / total) * circumference : 0;
                const currentOffset = offset;
                offset += length;
                if (!length) return null;
                return (
                  <Circle
                    key={segment.label}
                    cx="59"
                    cy="59"
                    r={radius}
                    fill="none"
                    stroke={segment.color}
                    strokeWidth="12"
                    strokeDasharray={`${length} ${circumference - length}`}
                    strokeDashoffset={-currentOffset}
                    strokeLinecap="round"
                  />
                );
              })}
            </G>
          </Svg>
        )}
        <View style={styles.donutCenter}>
          <Text style={styles.donutValue}>{total}</Text>
          <Text style={styles.donutCaption}>TOTAL</Text>
        </View>
      </View>
      <View style={styles.donutLegend}>
        {segments.map((segment) => (
          <View key={segment.label} style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: segment.color }]} />
            <Text style={styles.legendLabel}>{segment.label}</Text>
            <Text style={styles.legendValue}>{segment.value}</Text>
          </View>
        ))}
        {total === 0 ? <Text style={styles.chartEmptyHint}>Chart updates as accounts are added.</Text> : null}
      </View>
    </View>
  );
}

function HistogramChart({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(...rows.map((row) => row.value), 0);
  if (rows.length === 0) {
    return (
      <View style={styles.chartEmpty}>
        <Text style={styles.chartEmptyHint}>Role distribution will appear when team accounts exist.</Text>
      </View>
    );
  }
  return (
    <View style={styles.histogram}>
      {rows.map((row) => (
        <View key={row.label} style={styles.histogramRow}>
          <View style={styles.histogramHeading}>
            <Text numberOfLines={1} style={styles.histogramLabel}>{row.label}</Text>
            <Text style={styles.histogramValue}>{row.value}</Text>
          </View>
          <View style={styles.histogramTrack}>
            <View style={[styles.histogramFill, { width: `${max ? (row.value / max) * 100 : 0}%` }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

function ModuleRecordsView({
  section,
  request,
  onChanged,
  externalRefreshKey = 0,
  warehouseId,
  defaultCurrencyCode = 'USD',
}: {
  section?: NavigationSection;
  request: ApiRequest;
  onChanged?: () => void;
  externalRefreshKey?: number;
  warehouseId?: string;
  defaultCurrencyCode?: string;
}) {
  const insets = useSafeAreaInsets();
  const [result, setResult] = useState<ModuleRecordsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editorDraft, setEditorDraft] = useState<ModuleRecord>({});
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [deleteRecordId, setDeleteRecordId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [recordOptions, setRecordOptions] = useState<Record<string, ModuleRecord[]>>({});
  const [recordOptionErrors, setRecordOptionErrors] = useState<Record<string, string>>({});
  const [optionsLoading, setOptionsLoading] = useState(false);
  const collection = section?.collection;
  const fields = moduleFields[collection ?? ''] ?? EMPTY_MODULE_FIELDS;
  const selectedWarehouseId = warehouseId ??
    (typeof editorDraft.warehouseId === 'string' ? editorDraft.warehouseId : undefined);
  const refreshModuleOptions = useCallback(async (source: string) => {
    setOptionsLoading(true);
    setRecordOptionErrors((current) => ({ ...current, [source]: '' }));
    try {
      const options = await request<ModuleRecord[]>(
        `/dashboard/company/module-options/${encodeURIComponent(source)}`,
      );
      setRecordOptions((current) => ({ ...current, [source]: options }));
    } catch (cause) {
      setRecordOptionErrors((current) => ({
        ...current,
        [source]: cause instanceof Error ? cause.message : 'Unable to load company choices',
      }));
    } finally {
      setOptionsLoading(false);
    }
  }, [request]);

  useEffect(() => {
    const interval = setInterval(
      () => setReloadKey((current) => current + 1),
      AUTO_REFRESH_INTERVAL_MS,
    );
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setPage(1);
    setSearch('');
    setResult(null);
    setActionError('');
  }, [collection, warehouseId]);
  useEffect(() => {
    if (!collection) {
      setLoading(false);
      setResult(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    const recordsPath = warehouseId
      ? `/dashboard/warehouses/${encodeURIComponent(warehouseId)}/modules/${encodeURIComponent(collection)}?page=${page}`
      : `/dashboard/modules/${encodeURIComponent(collection)}?page=${page}`;
    void request<ModuleRecordsResponse>(recordsPath)
      .then((response) => {
        if (active) {
          setResult(response);
          const lastPage = Math.max(1, Math.ceil(response.total / response.limit));
          if (page > lastPage) setPage(lastPage);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load module records');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [collection, externalRefreshKey, page, reloadKey, request, warehouseId]);

  useEffect(() => {
    if (!editorVisible) return;
    const sources = [...new Set(fields.flatMap((field) => {
      if (field.type !== 'reference' && field.type !== 'category') return [];
      const source = moduleOptionSource(field, editorDraft);
      return source ? [source] : [];
    }))];
    if (!sources.length) {
      setRecordOptions((current) => Object.keys(current).length ? {} : current);
      setRecordOptionErrors((current) => Object.keys(current).length ? {} : current);
      setOptionsLoading((current) => current ? false : current);
      return;
    }
    let active = true;
    setRecordOptions({});
    setRecordOptionErrors({});
    setOptionsLoading(true);
    void Promise.all(sources.map(async (source) => {
      try {
        return {
          source,
          options: await request<ModuleRecord[]>(`/dashboard/company/module-options/${encodeURIComponent(source)}`),
          error: '',
        };
      } catch (cause) {
        return {
          source,
          options: [],
          error: cause instanceof Error ? cause.message : 'Unable to load company choices',
        };
      }
    })).then((entries) => {
      if (!active) return;
      setRecordOptions(Object.fromEntries(entries.map(({ source, options }) => [source, options])));
      setRecordOptionErrors(Object.fromEntries(entries
        .filter((entry) => entry.error)
        .map(({ source, error: sourceError }) => [source, sourceError])));
    }).finally(() => {
      if (active) setOptionsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [editorDraft.costCenterType, editorDraft.relatedEntityType, editorVisible, fields, request]);

  const records = (result?.records ?? []).filter((record) =>
    !search.trim() || JSON.stringify(record).toLowerCase().includes(search.trim().toLowerCase()),
  );
  const scopedRecords = warehouseId
    ? records.filter((record) =>
      !record.warehouseId || String(record.warehouseId) === warehouseId,
    )
    : records;

  const startCreate = () => {
    setActionError('');
    setEditingRecordId(null);
    setEditorDraft(Object.fromEntries(fields.map((field) => [
      field.name,
      field.type === 'checkbox'
        ? false
        : field.type === 'select'
          ? field.choices?.[0] ?? ''
          : field.type === 'currency'
            ? defaultCurrencyCode
            : '',
    ])));
    setEditorVisible(true);
  };
  const startEdit = (record: ModuleRecord) => {
    setActionError('');
    setEditingRecordId(String(record._id));
    setEditorDraft(Object.fromEntries(fields.map((field) => {
      const value = record[field.name];
      return [
        field.name,
        value instanceof Date
          ? value.toISOString()
          : value === null || value === undefined
            ? field.type === 'checkbox' ? false : ''
            : typeof value === 'object'
              ? JSON.stringify(value)
              : String(value),
      ];
    })));
    setEditorVisible(true);
  };
  const saveRecord = async () => {
    if (!collection) return;
    const missing = fields.find((field) =>
      field.required && (
        editorDraft[field.name] === undefined ||
        editorDraft[field.name] === null ||
        editorDraft[field.name] === ''
      ),
    );
    if (missing) {
      setActionError(`${missing.label} is required.`);
      return;
    }
    setSaving(true);
    setActionError('');
    try {
      if (collection === 'companies') {
        await request('/dashboard/company/preferences', {
          method: 'PATCH',
          body: JSON.stringify(editorDraft),
        });
      } else {
        const warehouseQuery = warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : '';
        const path = `/dashboard/modules/${encodeURIComponent(collection)}${editingRecordId ? `/${encodeURIComponent(editingRecordId)}` : ''}${warehouseQuery}`;
        const record = Object.fromEntries(Object.entries(editorDraft).flatMap(([key, value]) => {
          if (value !== '') return [[key, value]];
          return editingRecordId ? [[key, null]] : [];
        }));
        await request(path, {
          method: editingRecordId ? 'PATCH' : 'POST',
          body: JSON.stringify({ record }),
        });
      }
      setEditorVisible(false);
      setReloadKey((current) => current + 1);
      onChanged?.();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Unable to save record');
    } finally {
      setSaving(false);
    }
  };
  const confirmDelete = async () => {
    if (!collection || !deleteRecordId) return;
    setSaving(true);
    setActionError('');
    try {
      await request(
        `/dashboard/modules/${encodeURIComponent(collection)}/${encodeURIComponent(deleteRecordId)}${warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : ''}`,
        { method: 'DELETE' },
      );
      setDeleteRecordId(null);
      setReloadKey((current) => current + 1);
      onChanged?.();
    } catch (cause) {
      setDeleteRecordId(null);
      setActionError(cause instanceof Error ? cause.message : 'Unable to delete record');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.cardEyebrow}>{collection?.toUpperCase() ?? 'WORKSPACE MODULE'}</Text>
      <Text style={styles.sectionTitle}>{section?.label ?? 'Workspace module'}</Text>
      {collection && collection !== 'accounts' && collection !== 'companies' && collection !== 'auditLogs' && fields.length > 0 ? (
        <PrimaryButton label="Create new record" onPress={startCreate} disabled={saving} />
      ) : collection === 'companies' ? (
        <Text style={styles.muted}>Edit the company profile below. The company itself cannot be deleted here.</Text>
      ) : collection === 'accounts' ? (
        <Text style={styles.muted}>Create, edit, and remove worker accounts in the Team accounts section.</Text>
      ) : collection === 'auditLogs' ? (
        <Text style={styles.muted}>Audit logs are read-only. The system writes these records when audited actions are implemented.</Text>
      ) : null}
      {!editorVisible && deleteRecordId === null ? <ErrorText message={actionError} /> : null}
      {loading ? (
        <View style={styles.moduleState}><ActivityIndicator color={theme.colors.primary} /><Text style={styles.muted}>Loading company records…</Text></View>
      ) : error ? (
        <View style={styles.moduleState}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : result ? (
        <>
          <View style={styles.moduleSummary}>
            <Text style={styles.moduleCount}>{formatQuantity(result.total)}</Text>
            <Text style={styles.muted}>records in this company</Text>
            {result.total > 0 ? <AppInput placeholder="Search this page" value={search} onChangeText={setSearch} /> : null}
          </View>
          {collection === 'companies' && result.records[0] ? (
            <ActionButton label="Edit company profile" onPress={() => startEdit(result.records[0])} />
          ) : null}
          {result.total === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyMark}><Text style={styles.emptyMarkText}>{section?.label?.slice(0, 1) ?? 'R'}</Text></View>
              <Text style={styles.emptyTitle}>No {section?.label?.toLowerCase() ?? 'module'} yet</Text>
              <Text style={styles.emptyDescription}>No records are currently saved for this company.</Text>
            </View>
          ) : scopedRecords.length === 0 ? (
            <View style={styles.inlineEmpty}><Text style={styles.emptyDescription}>No records match your search.</Text></View>
          ) : (
            scopedRecords.map((record, index) => (
              <ModuleRecordCard
                key={String(record._id ?? index)}
                record={record}
                index={index}
                canEdit={collection !== 'accounts' && collection !== 'auditLogs'}
                canDelete={collection !== 'accounts' && collection !== 'companies' && collection !== 'auditLogs'}
                onEdit={() => startEdit(record)}
                onDelete={() => {
                  setActionError('');
                  setDeleteRecordId(String(record._id));
                }}
              />
            ))
          )}
          {result.total > result.limit ? (
            <View style={styles.modulePagination}>
              <ActionButton label="Previous" disabled={page <= 1} onPress={() => setPage((current) => Math.max(1, current - 1))} />
              <Text style={styles.muted}>Page {page} of {Math.ceil(result.total / result.limit)}</Text>
              <ActionButton label="Next" disabled={page >= Math.ceil(result.total / result.limit)} onPress={() => setPage((current) => current + 1)} />
            </View>
          ) : null}
        </>
      ) : null}
      <Modal
        visible={editorVisible || deleteRecordId !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setEditorVisible(false);
          setDeleteRecordId(null);
          setActionError('');
        }}
      >
        <View style={[
          styles.moduleModalBackdrop,
          {
            paddingTop: Math.max(theme.spacing.md, insets.top + theme.spacing.sm),
            paddingBottom: Math.max(theme.spacing.md, insets.bottom + theme.spacing.sm),
            paddingLeft: Math.max(theme.spacing.md, insets.left + theme.spacing.md),
            paddingRight: Math.max(theme.spacing.md, insets.right + theme.spacing.md),
          },
        ]}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.moduleEditorLayout}
            keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
          >
          <View style={styles.moduleEditor}>
            <Text style={styles.cardEyebrow}>{deleteRecordId ? 'CONFIRM DELETE' : editingRecordId ? 'EDIT RECORD' : 'NEW RECORD'}</Text>
            <Text style={styles.sectionTitle}>
              {deleteRecordId ? `Delete this ${section?.label?.toLowerCase() ?? 'record'}?` : `${editingRecordId ? 'Update' : 'Create'} ${section?.label?.toLowerCase() ?? 'record'}`}
            </Text>
            {deleteRecordId ? (
              <>
                <Text style={styles.muted}>This permanently deletes this record. Known linked records are protected; remove their references first.</Text>
                <View style={styles.actions}>
                  <ActionButton label="Cancel" disabled={saving} onPress={() => setDeleteRecordId(null)} />
                  <ActionButton label={saving ? 'Deleting…' : 'Delete record'} destructive disabled={saving} onPress={() => void confirmDelete()} />
                </View>
              </>
            ) : (
              <>
                <Text style={styles.muted}>Company ownership is assigned automatically. Relationship choices come from your company records.</Text>
                {collection === 'fuelLogs' ? (
                  <Text style={styles.muted}>The warehouse is assigned automatically from the selected truck.</Text>
                ) : null}
                {optionsLoading ? <ActivityIndicator color={theme.colors.primary} /> : null}
                <ScrollView style={styles.moduleFormFields} keyboardShouldPersistTaps="handled">
                  {fields.filter((field) => !(warehouseId && field.name === 'warehouseId')).map((field) => (
                    (() => {
                      const source = moduleOptionSource(field, editorDraft);
                      const emptyOptionsMessage = source === 'warehouses'
                        ? 'No active warehouses found. Create a warehouse before adding a truck.'
                        : source === 'accounts'
                          ? 'No active drivers found. Add or activate a worker with the Driver role.'
                          : source === 'expenseCategories'
                            ? 'No expense categories found. Create one in the Expense categories section first.'
                          : 'No matching company records found.';
                      return (
                        <ModuleFormField
                          key={field.name}
                          field={field}
                          value={editorDraft[field.name]}
                          options={(recordOptions[source] ?? []).filter((option) =>
                            moduleOptionMatchesWarehouse(source, option, selectedWarehouseId),
                          )}
                          optionsLoading={optionsLoading}
                          optionError={recordOptionErrors[source] ?? ''}
                          emptyOptionsMessage={emptyOptionsMessage}
                          onOpenOptions={source ? () => void refreshModuleOptions(source) : undefined}
                          companyCurrencyCode={defaultCurrencyCode}
                          onChange={(value) => {
                            setActionError('');
                            setEditorDraft((current) => {
                              const next = { ...current, [field.name]: value };
                              if (collection === 'expenses' && field.name === 'truckId') {
                                next.costCenterType = value ? 'truck' : 'warehouse';
                                next.costCenterId = value || '';
                                const selectedTruck = (recordOptions.trucks ?? []).find(
                                  (truck) => String(truck._id ?? '') === value,
                                );
                                if (typeof selectedTruck?.warehouseId === 'string') {
                                  next.warehouseId = selectedTruck.warehouseId;
                                }
                              }
                              if (field.name === 'warehouseId') {
                                const selectedTruck = (recordOptions.trucks ?? []).find(
                                  (truck) => String(truck._id ?? '') === current.truckId,
                                );
                                if (
                                  selectedTruck &&
                                  !moduleOptionMatchesWarehouse('trucks', selectedTruck, String(value))
                                ) {
                                  next.truckId = '';
                                  if (collection === 'expenses' && current.costCenterType === 'truck') {
                                    next.costCenterId = '';
                                    next.costCenterType = 'warehouse';
                                  }
                                }
                                if (collection === 'expenses' && current.costCenterType === 'warehouse') {
                                  next.costCenterId = value;
                                }
                              }
                              if (field.name === 'costCenterType') {
                                next.costCenterId = '';
                                if (collection === 'expenses' && value !== 'truck') next.truckId = '';
                              }
                              if (
                                collection === 'expenses' &&
                                field.name === 'costCenterId' &&
                                current.costCenterType === 'truck'
                              ) next.truckId = value;
                              if (field.name === 'relatedEntityType') next.relatedEntityId = '';
                              return next;
                            });
                          }}
                        />
                      );
                    })()
                  ))}
                </ScrollView>
                <ErrorText message={actionError} />
                <View style={styles.actions}>
                  <ActionButton label="Cancel" disabled={saving} onPress={() => {
                    setEditorVisible(false);
                    setActionError('');
                  }} />
                  <ActionButton label={saving ? 'Saving…' : 'Save record'} disabled={saving} onPress={() => void saveRecord()} />
                </View>
              </>
            )}
          </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

function ModuleFormField({
  field,
  value,
  options,
  optionsLoading,
  optionError,
  emptyOptionsMessage,
  onOpenOptions,
  companyCurrencyCode,
  onChange,
}: {
  field: ModuleField;
  value: unknown;
  options: ModuleRecord[];
  optionsLoading: boolean;
  optionError: string;
  emptyOptionsMessage: string;
  onOpenOptions?: () => void;
  companyCurrencyCode: string;
  onChange: (value: string | boolean) => void;
}) {
  const stringValue = typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
  if (field.type === 'checkbox') {
    const checked = value === true;
    return (
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        onPress={() => onChange(!checked)}
        style={styles.formCheckboxRow}
      >
        <View style={[styles.formCheckbox, checked && styles.formCheckboxChecked]}>
          {checked ? <Text style={styles.formCheckboxMark}>✓</Text> : null}
        </View>
        <Text style={styles.inputLabel}>{field.label}</Text>
      </Pressable>
    );
  }
  if (field.type === 'currency') {
    return (
      <CurrencyPicker
        label={field.label}
        value={stringValue || companyCurrencyCode}
        onChange={onChange}
      />
    );
  }
  if (field.type === 'reference' || field.type === 'select' || field.type === 'category') {
    const choices = field.type === 'select'
      ? (field.choices ?? []).map((choice) => ({ _id: choice, name: choice }))
      : options;
    return (
      <RecordPicker
        label={field.label}
        value={stringValue}
        options={choices}
        loading={optionsLoading}
        error={optionError}
        emptyMessage={emptyOptionsMessage}
        placeholder={field.placeholder ?? `Choose ${field.label.toLowerCase()}`}
        required={field.required}
        valueField={field.type === 'category' ? 'name' : '_id'}
        onOpenOptions={onOpenOptions}
        onChange={onChange}
      />
    );
  }
  if (field.type === 'date') {
    return (
      <DateTimePicker
        label={field.label}
        value={stringValue}
        required={field.required}
        onChange={onChange}
      />
    );
  }
  return (
    <View style={styles.moduleField}>
      <Text style={styles.inputLabel}>
        {field.label}{field.required ? ' *' : ''}
      </Text>
      <AppInput
        accessibilityLabel={field.label}
        placeholder={field.placeholder ?? field.label}
        value={stringValue}
        onChangeText={onChange}
        keyboardType={field.type === 'decimal' ? 'decimal-pad' : 'default'}
        multiline={field.type === 'textarea'}
        autoCapitalize={field.name.toLowerCase().includes('email') ? 'none' : 'sentences'}
        autoCorrect={true}
        style={field.type === 'textarea' ? styles.moduleTextArea : undefined}
      />
    </View>
  );
}

const DATE_PICKER_ROW_HEIGHT = 38;
const DATE_PICKER_VIEW_HEIGHT = 152;
const DATE_PICKER_YEARS = Array.from({ length: 201 }, (_, index) => 1900 + index);
const DATE_PICKER_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function parsePickerDate(value: string) {
  const legacyDateOnly = /^(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\.0+)?Z$/i.exec(value);
  if (legacyDateOnly) {
    const [, year, month, day] = legacyDateOnly;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    const zoned = new Date(value);
    return Number.isNaN(zoned.getTime()) ? new Date() : zoned;
  }
  const dateParts = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(value);
  if (dateParts) {
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = dateParts;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
    if (
      parsed.getFullYear() === Number(year) &&
      parsed.getMonth() === Number(month) - 1 &&
      parsed.getDate() === Number(day)
    ) return parsed;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function formatLocalDate(date: Date) {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatPickerValue(date: Date, showTime: boolean) {
  const dateText = `${DATE_PICKER_MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  if (!showTime) return dateText;
  const hour = date.getHours() % 12 || 12;
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${dateText} · ${hour}:${minute} ${date.getHours() >= 12 ? 'PM' : 'AM'}`;
}

function PickerColumn({
  label,
  values,
  selectedValue,
  onSelect,
  viewHeight,
}: {
  label: string;
  values: { label: string; value: number }[];
  selectedValue: number;
  onSelect: (value: number) => void;
  viewHeight: number;
}) {
  const scrollRef = useRef<ScrollViewInstance>(null);
  const centerInset = (viewHeight - DATE_PICKER_ROW_HEIGHT) / 2;
  const selectedIndex = Math.max(0, values.findIndex((item) => item.value === selectedValue));
  const scrollToValue = (index: number) => scrollRef.current?.scrollTo({
    y: index * DATE_PICKER_ROW_HEIGHT,
    animated: true,
  });
  const settleSelection = (offset: number) => {
    const index = Math.max(0, Math.min(values.length - 1, Math.round(offset / DATE_PICKER_ROW_HEIGHT)));
    onSelect(values[index].value);
  };
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: selectedIndex * DATE_PICKER_ROW_HEIGHT, animated: false });
  }, [selectedIndex, values.length]);
  return (
    <View style={styles.datePickerColumn}>
      <Text style={styles.datePickerColumnLabel}>{label}</Text>
      <View style={[styles.datePickerWheel, { height: viewHeight }]}>
        <View
          pointerEvents="none"
          style={[styles.datePickerSelection, {
            top: centerInset,
            height: DATE_PICKER_ROW_HEIGHT,
          }]}
        />
        <ScrollView
          ref={scrollRef}
          style={styles.datePickerScroll}
          showsVerticalScrollIndicator={false}
          snapToInterval={DATE_PICKER_ROW_HEIGHT}
          decelerationRate="fast"
          contentContainerStyle={{ paddingVertical: centerInset }}
          onMomentumScrollEnd={(event) => settleSelection(event.nativeEvent.contentOffset.y)}
        >
          {values.map((item, index) => (
            <Pressable
              key={`${item.value}-${index}`}
              accessibilityRole="button"
              onPress={() => {
                onSelect(item.value);
                scrollToValue(index);
              }}
              style={styles.datePickerWheelItem}
            >
              <Text style={[
                styles.datePickerWheelText,
                item.value === selectedValue && styles.datePickerWheelTextSelected,
              ]} numberOfLines={1}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

function DateTimePicker({
  label,
  value,
  onChange,
  required = false,
  showTime = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  showTime?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const wheelHeight = showTime
    ? Math.max(112, Math.min(DATE_PICKER_VIEW_HEIGHT, (height - insets.top - insets.bottom - 300) / 2))
    : DATE_PICKER_VIEW_HEIGHT;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => new Date());
  const openPicker = () => {
    setDraft(value ? parsePickerDate(value) : new Date());
    setOpen(true);
  };
  const changeDate = (part: 'year' | 'month' | 'day', selected: number) => {
    setDraft((current) => {
      const next = new Date(current);
      if (part === 'day') {
        next.setDate(selected);
      } else {
        const day = current.getDate();
        next.setDate(1);
        if (part === 'year') next.setFullYear(selected);
        else next.setMonth(selected);
        next.setDate(Math.min(day, daysInMonth(next.getFullYear(), next.getMonth())));
      }
      return next;
    });
  };
  const changeHour = (hour: number) => {
    setDraft((current) => {
      const next = new Date(current);
      const isPm = current.getHours() >= 12;
      next.setHours((hour % 12) + (isPm ? 12 : 0));
      return next;
    });
  };
  const changePeriod = (period: number) => {
    setDraft((current) => {
      const next = new Date(current);
      const hour = current.getHours() % 12;
      next.setHours(hour + (period ? 12 : 0));
      return next;
    });
  };
  const hour = draft.getHours() % 12 || 12;
  const wheelValues = (values: number[], formatter: (value: number) => string) =>
    values.map((item) => ({ label: formatter(item), value: item }));

  return (
    <View style={styles.moduleField}>
      <Text style={styles.inputLabel}>{label}{required ? ' *' : ''}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Choose ${label}`}
        onPress={openPicker}
        style={({ pressed }) => [styles.datePickerTrigger, pressed && styles.controlPressed]}
      >
        <Text style={value ? styles.recordPickerValue : styles.recordPickerPlaceholder}>
          {value ? formatPickerValue(parsePickerDate(value), showTime) : showTime ? 'Select date and time' : 'Select date'}
        </Text>
        <Text style={styles.datePickerIcon}>▦</Text>
      </Pressable>
      {value && !required ? (
        <Pressable accessibilityRole="button" onPress={() => onChange('')} style={styles.datePickerClear}>
          <Text style={styles.linkText}>Clear date</Text>
        </Pressable>
      ) : null}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={[
          styles.modalBackdrop,
          {
            paddingTop: Math.max(theme.spacing.md, insets.top + theme.spacing.sm),
            paddingBottom: Math.max(theme.spacing.md, insets.bottom + theme.spacing.sm),
            paddingLeft: Math.max(theme.spacing.md, insets.left + theme.spacing.md),
            paddingRight: Math.max(theme.spacing.md, insets.right + theme.spacing.md),
          },
        ]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessibilityLabel="Close date picker" />
          <View style={[styles.datePickerModal, { width: Math.min(width - insets.left - insets.right - 32, 560) }]}>
            <Text style={styles.cardEyebrow}>{showTime ? 'DATE & TIME' : 'DATE'}</Text>
            <Text style={styles.sectionTitle}>{label}</Text>
            <Text style={styles.datePickerPreview}>{formatPickerValue(draft, showTime)}</Text>
            <View style={styles.datePickerGroup}>
              <PickerColumn
                label="YEAR"
                values={wheelValues(DATE_PICKER_YEARS, String)}
                selectedValue={draft.getFullYear()}
                onSelect={(selected) => changeDate('year', selected)}
                viewHeight={wheelHeight}
              />
              <PickerColumn
                label="MONTH"
                values={wheelValues(DATE_PICKER_MONTHS.map((_, index) => index), (index) => DATE_PICKER_MONTHS[index])}
                selectedValue={draft.getMonth()}
                onSelect={(selected) => changeDate('month', selected)}
                viewHeight={wheelHeight}
              />
              <PickerColumn
                label="DAY"
                values={wheelValues(Array.from({ length: daysInMonth(draft.getFullYear(), draft.getMonth()) }, (_, index) => index + 1), String)}
                selectedValue={draft.getDate()}
                onSelect={(selected) => changeDate('day', selected)}
                viewHeight={wheelHeight}
              />
            </View>
            {showTime ? (
              <>
                <Text style={styles.datePickerGroupTitle}>TIME</Text>
                <View style={styles.datePickerGroup}>
                  <PickerColumn
                    label="HOUR"
                    values={wheelValues(Array.from({ length: 12 }, (_, index) => index + 1), (selected) => String(selected).padStart(2, '0'))}
                    selectedValue={hour}
                    onSelect={changeHour}
                    viewHeight={wheelHeight}
                  />
                  <PickerColumn
                    label="MINUTE"
                    values={wheelValues(Array.from({ length: 60 }, (_, index) => index), (selected) => String(selected).padStart(2, '0'))}
                    selectedValue={draft.getMinutes()}
                    onSelect={(selected) => setDraft((current) => {
                      const next = new Date(current);
                      next.setMinutes(selected, 0, 0);
                      return next;
                    })}
                    viewHeight={wheelHeight}
                  />
                  <PickerColumn
                    label="AM / PM"
                    values={[{ label: 'AM', value: 0 }, { label: 'PM', value: 1 }]}
                    selectedValue={draft.getHours() >= 12 ? 1 : 0}
                    onSelect={changePeriod}
                    viewHeight={wheelHeight}
                  />
                </View>
              </>
            ) : null}
            <View style={styles.datePickerActions}>
              <ActionButton label="Cancel" onPress={() => setOpen(false)} />
              <ActionButton
                label="Set date"
                onPress={() => {
                  onChange(showTime ? draft.toISOString() : formatLocalDate(draft));
                  setOpen(false);
                }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function RecordPicker({
  label,
  value,
  options,
  loading = false,
  error = '',
  emptyMessage = 'No matching company records found.',
  placeholder,
  required = false,
  valueField = '_id',
  onOpenOptions,
  onChange,
}: {
  label: string;
  value: string;
  options: ModuleRecord[];
  loading?: boolean;
  error?: string;
  emptyMessage?: string;
  placeholder: string;
  required?: boolean;
  valueField?: string;
  onOpenOptions?: () => void;
  onChange: (value: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = options.find((option) => String(option[valueField] ?? '') === value);
  const filtered = options.filter((option) =>
    `${moduleOptionLabel(option)} ${String(option._id ?? '')}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  return (
    <View style={styles.moduleField}>
      <Text style={styles.inputLabel}>{label}{required ? ' *' : ''}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setSearch('');
          setOpen(true);
          onOpenOptions?.();
        }}
        style={({ pressed }) => [styles.recordPicker, pressed && styles.controlPressed]}
      >
        <Text numberOfLines={1} style={selected ? styles.recordPickerValue : styles.recordPickerPlaceholder}>
          {selected ? moduleOptionLabel(selected) : loading ? `Loading ${label.toLowerCase()}…` : placeholder}
        </Text>
        <Text style={styles.currencyChevron}>⌄</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={[
          styles.modalBackdrop,
          {
            paddingTop: Math.max(theme.spacing.lg, insets.top + theme.spacing.md),
            paddingBottom: Math.max(theme.spacing.lg, insets.bottom + theme.spacing.md),
            paddingLeft: Math.max(theme.spacing.md, insets.left + theme.spacing.md),
            paddingRight: Math.max(theme.spacing.md, insets.right + theme.spacing.md),
          },
        ]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessibilityLabel="Close choices" />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
            style={styles.modalKeyboardLayout}
          >
          <View style={styles.currencyModal}>
            <View style={styles.modalHeading}>
              <View style={styles.flex}>
                <Text style={styles.cardEyebrow}>{required ? 'REQUIRED' : 'OPTIONAL'}</Text>
                <Text style={styles.modalTitle}>{label}</Text>
              </View>
              <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={styles.modalClose}>
                <Text style={styles.modalCloseText}>×</Text>
              </Pressable>
            </View>
            <AppInput placeholder={`Search ${label.toLowerCase()}`} value={search} onChangeText={setSearch} autoCapitalize="none" />
            {loading ? <ActivityIndicator color={theme.colors.primary} style={styles.currencyLoading} /> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <ScrollView style={styles.currencyList} keyboardShouldPersistTaps="handled">
              {!required ? (
                <Pressable style={styles.currencyOption} onPress={() => { onChange(''); setOpen(false); }}>
                  <Text style={styles.currencyName}>None</Text>
                </Pressable>
              ) : null}
              {filtered.map((option) => {
                const id = String(option._id ?? '');
                const optionValue = String(option[valueField] ?? '');
                const isSelected = optionValue === value;
                return (
                  <Pressable
                    key={id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => { onChange(optionValue); setOpen(false); }}
                    style={({ pressed }) => [
                      styles.currencyOption,
                      isSelected && styles.currencyOptionSelected,
                      pressed && styles.controlPressed,
                    ]}
                  >
                    <View style={styles.flex}>
                      <Text style={styles.currencyName}>{moduleOptionLabel(option)}</Text>
                      {option.code || option.registrationNumber || option.employeeNumber ? (
                        <Text style={styles.currencyCode}>
                          {String(option.code ?? option.registrationNumber ?? option.employeeNumber)}
                        </Text>
                      ) : null}
                    </View>
                    {isSelected ? <Text style={styles.currencyCheck}>✓</Text> : null}
                  </Pressable>
                );
              })}
              {!loading && !error && filtered.length === 0 ? <Text style={styles.emptyDescription}>{emptyMessage}</Text> : null}
            </ScrollView>
          </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

function moduleOptionLabel(option: ModuleRecord): string {
  const key = ['displayName', 'name', 'title', 'lotNumber', 'code', 'orderNumber', 'invoiceNumber', 'registrationNumber', 'reference', 'employeeNumber', 'entryNumber']
    .find((candidate) => option[candidate] !== undefined && option[candidate] !== null);
  return key ? String(option[key]) : 'Record';
}

const currencyNames: Record<string, string> = {
  AED: 'UAE Dirham',
  AUD: 'Australian Dollar',
  CAD: 'Canadian Dollar',
  CHF: 'Swiss Franc',
  CNY: 'Chinese Yuan',
  EUR: 'Euro',
  GBP: 'British Pound',
  INR: 'Indian Rupee',
  JPY: 'Japanese Yen',
  KWD: 'Kuwaiti Dinar',
  LBP: 'Lebanese Pound',
  SAR: 'Saudi Riyal',
  USD: 'US Dollar',
};

function CurrencyPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [options, setOptions] = useState<CurrencyOption[]>([]);
  const [search, setSearch] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const loadCurrencies = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(currenciesApiUrl, { signal });
      if (!response.ok) throw new Error(`Currency service returned HTTP ${response.status}`);
      const data = await response.json() as ExchangeRateResponse;
      if (data.result !== 'success' || !data.rates) throw new Error('Currency service returned an invalid currency list.');
      const currencyOptions = Object.keys(data.rates)
        .filter((code) => /^[A-Z]{3}$/.test(code))
        .map((code) => ({ code, name: currencyNames[code] ?? code }))
        .sort((first, second) => first.name.localeCompare(second.name));
      if (!currencyOptions.length) throw new Error('Currency service returned no currencies.');
      setOptions(currencyOptions);
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : 'Unable to load currency list.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void loadCurrencies(controller.signal);
    return () => controller.abort();
  }, [loadCurrencies]);
  const selected = options.find((option) => option.code === value);
  const normalizedManualCode = manualCode.trim().toUpperCase();
  const canApplyManualCode = /^[A-Z]{3}$/.test(normalizedManualCode);
  const filtered = options.filter((option) =>
    `${option.name} ${option.code}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <View style={styles.moduleField}>
      <Text style={styles.inputLabel}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Choose ${label}`}
        onPress={() => { setSearch(''); setManualCode(''); setOpen(true); }}
        style={({ pressed }) => [styles.recordPicker, pressed && styles.controlPressed]}
      >
        <Text style={selected ? styles.recordPickerValue : styles.recordPickerPlaceholder}>
          {selected ? `${selected.name} (${selected.code})` : value || 'Choose currency'}
        </Text>
        <Text style={styles.currencyChevron}>⌄</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={[
          styles.modalBackdrop,
          {
            paddingTop: Math.max(theme.spacing.lg, insets.top + theme.spacing.md),
            paddingBottom: Math.max(theme.spacing.lg, insets.bottom + theme.spacing.md),
            paddingLeft: Math.max(theme.spacing.md, insets.left + theme.spacing.md),
            paddingRight: Math.max(theme.spacing.md, insets.right + theme.spacing.md),
          },
        ]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessibilityLabel="Close currencies" />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
            style={styles.modalKeyboardLayout}
          >
          <View style={styles.currencyModal}>
            <View style={styles.modalHeading}>
              <View style={styles.flex}>
                <Text style={styles.cardEyebrow}>WORLD CURRENCIES</Text>
                <Text style={styles.modalTitle}>{label}</Text>
              </View>
              <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={styles.modalClose}>
                <Text style={styles.modalCloseText}>×</Text>
              </Pressable>
            </View>
            <AppInput placeholder="Search currency or ISO code" value={search} onChangeText={setSearch} autoCapitalize="none" autoCorrect={false} />
            <Text style={styles.inputLabel}>Or enter a 3-letter ISO currency code</Text>
            <AppInput
              placeholder="For example, EUR"
              value={manualCode}
              onChangeText={setManualCode}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={3}
            />
            <ActionButton
              label="Use currency code"
              disabled={!canApplyManualCode}
              onPress={() => {
                onChange(normalizedManualCode);
                setOpen(false);
              }}
            />
            {loading ? <ActivityIndicator color={theme.colors.primary} style={styles.currencyLoading} /> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {!loading && !error ? (
              <ScrollView style={styles.currencyList} keyboardShouldPersistTaps="handled">
                {filtered.map((option) => (
                  <Pressable
                    key={option.code}
                    accessibilityRole="button"
                    accessibilityState={{ selected: option.code === value }}
                    onPress={() => { onChange(option.code); setOpen(false); }}
                    style={({ pressed }) => [
                      styles.currencyOption,
                      option.code === value && styles.currencyOptionSelected,
                      pressed && styles.controlPressed,
                    ]}
                  >
                    <View style={styles.flex}>
                      <Text style={styles.currencyName}>{option.name}</Text>
                      <Text style={styles.currencyCode}>{option.code}</Text>
                    </View>
                    {option.code === value ? <Text style={styles.currencyCheck}>✓</Text> : null}
                  </Pressable>
                ))}
                {!filtered.length ? <Text style={styles.emptyDescription}>No matching currencies.</Text> : null}
              </ScrollView>
            ) : null}
            {error ? <ActionButton label="Try again" onPress={() => void loadCurrencies()} /> : null}
          </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

function ModuleRecordCard({
  record,
  index,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: {
  record: ModuleRecord;
  index: number;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { width } = useWindowDimensions();
  const titleField = ['name', 'title', 'lotNumber', 'code', 'number', 'registrationNumber', 'reference']
    .find((key) => record[key] !== undefined && record[key] !== null);
  const title = titleField ? formatModuleValue(record[titleField]) : `Record ${index + 1}`;
  const fields = Object.entries(record).filter(([key, value]) =>
    !isIdentifierField(key) &&
    !['__v', 'createdAt', 'updatedAt'].includes(key) &&
    key !== titleField &&
    value !== null && value !== undefined,
  );

  return (
    <View style={styles.moduleRecord}>
      <Text numberOfLines={1} style={styles.moduleRecordTitle}>{title}</Text>
      {fields.length === 0 ? (
        <Text style={styles.muted}>No additional details.</Text>
      ) : (
        <View style={[styles.moduleRecordFields, width < 600 && styles.moduleRecordFieldsPhone]}>
          {fields.map(([key, value]) => (
            <View key={key} style={[styles.moduleRecordField, width < 600 && styles.moduleRecordFieldPhone]}>
              <Text style={styles.moduleRecordLabel}>{key.replace(/([a-z0-9])([A-Z])/g, '$1 $2')}</Text>
              <Text numberOfLines={3} style={styles.moduleRecordValue}>{formatModuleValue(value)}</Text>
            </View>
          ))}
        </View>
      )}
      {record.createdAt ? <Text style={styles.moduleRecordDate}>{formatModuleValue(record.createdAt)}</Text> : null}
      {canEdit || canDelete ? (
        <View style={styles.actions}>
          {canEdit ? <ActionButton label="Edit" onPress={onEdit} /> : null}
          {canDelete ? <ActionButton label="Delete" destructive onPress={onDelete} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function formatModuleValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      const items = value.map(formatModuleValue).filter((item) => item !== '—');
      return items.length ? items.join(', ') : '—';
    }
    const entries = Object.entries(value)
      .filter(([key]) => !isIdentifierField(key))
      .map(([key, item]) => `${key}: ${formatModuleValue(item)}`);
    return entries.length ? entries.join(', ') : '—';
  }
  if (/^[a-f\d]{24}$/i.test(String(value))) return '—';
  return String(value);
}

function isIdentifierField(key: string): boolean {
  return key === '_id' || key === 'id' || /^[A-Za-z0-9]+Ids?$/.test(key);
}

function WorkerRow({
  worker,
  warehouses,
  busy,
  onUpdate,
  onDelete,
}: {
  worker: Worker;
  warehouses: Warehouse[];
  busy: boolean;
  onUpdate: (id: string, input: { name?: string; username?: string; employeeNumber?: string; phoneNumber?: string; role?: string; status?: string; warehouseIds?: string[]; specialty?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(worker.name);
  const [username, setUsername] = useState(worker.username);
  const [employeeNumber, setEmployeeNumber] = useState(worker.employeeNumber);
  const [phoneNumber, setPhoneNumber] = useState(worker.phoneNumber ?? '');
  const [role, setRole] = useState<(typeof workerJobRoles)[number]['value']>(
    workerJobRoles.find((item) => item.value === worker.role)?.value ?? workerJobRoles[0].value,
  );
  const [warehouseIds, setWarehouseIds] = useState<string[]>(
    (worker.warehouseIds ?? []).map(String),
  );
  const [specialty, setSpecialty] = useState(worker.specialty ?? '');
  return (
    <View style={styles.record}>
      {editing ? (
        <>
          <AppInput value={name} onChangeText={setName} placeholder="Worker name" />
          <AppInput value={username} onChangeText={setUsername} placeholder="Username" autoCapitalize="none" />
          <AppInput value={employeeNumber} onChangeText={setEmployeeNumber} placeholder="Employee number" />
          <AppInput value={phoneNumber} onChangeText={setPhoneNumber} placeholder="Mobile number" keyboardType="phone-pad" />
          <Text style={styles.inputLabel}>Verified email (managed by the worker)</Text>
          <Text style={styles.muted}>{worker.email || 'Not set'}</Text>
          <JobRolePicker value={role} onChange={setRole} />
          {role === 'driver' ? (
            <DriverSpecialtyPicker value={specialty} onChange={setSpecialty} />
          ) : null}
          {role === 'driver' ? (
            <Text style={styles.muted}>Warehouse access is assigned automatically from the truck this driver is assigned to.</Text>
          ) : (
            <WarehouseAssignmentPicker
              warehouses={warehouses}
              value={warehouseIds}
              onChange={setWarehouseIds}
            />
          )}
          <View style={styles.actions}>
            <ActionButton
              label="Save"
              disabled={busy || !name.trim() || username.trim().length < 4 || (phoneNumber.trim() !== '' && !isValidPhoneNumber(phoneNumber))}
              onPress={() => {
                void onUpdate(worker._id, {
                  name,
                  username,
                  employeeNumber,
                  phoneNumber: phoneNumber.trim() ? normalizePhoneNumber(phoneNumber) : '',
                  role,
                  warehouseIds: role === 'driver' ? undefined : warehouseIds,
                  specialty: role === 'driver' ? specialty || undefined : undefined,
                }).then(() => setEditing(false));
              }}
            />
            <ActionButton label="Cancel" disabled={busy} onPress={() => setEditing(false)} />
          </View>
        </>
      ) : (
        <>
          <Text style={styles.warehouseName}>{worker.name}</Text>
          <Text style={styles.muted}>@{worker.username} · {worker.employeeNumber} · {worker.role}</Text>
          {worker.role === 'driver' && worker.specialty ? (
            <Text style={styles.muted}>Driver specialty: {driverSpecialtyLabel(worker.specialty)}</Text>
          ) : null}
          {worker.phoneNumber ? <Text style={styles.muted}>{worker.phoneNumber}</Text> : null}
          {worker.email ? <Text style={styles.muted}>{worker.email}</Text> : null}
          <Text style={styles.muted}>
            Warehouses: {(worker.warehouseIds ?? [])
              .map((id) => {
                const warehouseId = String(id);
                return warehouses.find((warehouse) => String(warehouse._id).toLowerCase() === warehouseId.toLowerCase())?.name
                  ?? `Assigned warehouse (${warehouseId.slice(-6)})`;
              })
              .join(', ') || 'None assigned'}
          </Text>
          <Text style={worker.status === 'active' ? styles.activeTag : styles.disabledTag}>{worker.status.toUpperCase()}</Text>
          <View style={styles.actions}>
            <ActionButton label="Edit" disabled={busy} onPress={() => setEditing(true)} />
            <ActionButton label={worker.status === 'active' ? 'Disable' : 'Enable'} disabled={busy} onPress={() => void onUpdate(worker._id, { status: worker.status === 'active' ? 'suspended' : 'active' })} />
            <ActionButton label="Delete" disabled={busy} destructive onPress={() => void onDelete(worker._id)} />
          </View>
        </>
      )}
    </View>
  );
}

function CredentialNotice({ credentials }: { credentials: TemporaryCredentials | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!credentials) return;
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, [credentials]);
  if (!credentials) return null;
  const remainingHours = Math.max(0, Math.ceil((credentials.expiresAt - now) / (60 * 60 * 1000)));
  return (
    <View style={styles.credential}>
      <Text style={styles.sectionTitle}>Temporary sign-in details</Text>
      <Text style={styles.muted}>Username: @{credentials.username}</Text>
      <Text selectable style={styles.password}>{credentials.password}</Text>
      <Text style={styles.smallPrint}>
        Saved in this browser for up to 24 hours; the mobile app uses encrypted device storage. This notice expires automatically in {remainingHours} hour{remainingHours === 1 ? '' : 's'}.
      </Text>
    </View>
  );
}

function MessageScreen({
  title,
  message,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
}: {
  title: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}) {
  return (
    <View style={styles.messageScreen}>
      <BrandHeader subtitle={title} />
      <View style={styles.messageCard}>
        <View style={styles.messageMark}><Text style={styles.messageMarkText}>i</Text></View>
        <Text style={styles.messageTitle}>{title}</Text>
        <Text style={styles.messageCopy}>{message}</Text>
        <PrimaryButton label={actionLabel} onPress={onAction} disabled={false} />
        {secondaryActionLabel && onSecondaryAction ? (
          <ActionButton label={secondaryActionLabel} onPress={onSecondaryAction} disabled={false} />
        ) : null}
      </View>
    </View>
  );
}

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmChange, setConfirmChange] = useState(false);

  const updatePassword = useReverification(async (
    current: string,
    next: string,
  ) => {
    if (!user) throw new Error('Your signed-in account is not available.');
    return user.updatePassword({
      currentPassword: current,
      newPassword: next,
      signOutOfOtherSessions: true,
    });
  });

  const submit = async () => {
    setError('');
    setSuccess('');
    setConfirmChange(false);
    if (!currentPassword) {
      setError('Enter your current password.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Your new password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('Choose a new password that is different from your current one.');
      return;
    }

    Keyboard.dismiss();
    setConfirmChange(true);
  };

  const confirmPasswordChange = async () => {
    setBusy(true);
    try {
      await updatePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setConfirmChange(false);
      setSuccess('Password changed. Other active sessions have been signed out.');
    } catch (cause) {
      setError(clerkError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={[
        styles.passwordModalBackdrop,
        {
          paddingTop: Math.max(theme.spacing.md, insets.top + theme.spacing.sm),
          paddingBottom: Math.max(theme.spacing.md, insets.bottom + theme.spacing.sm),
          paddingLeft: Math.max(theme.spacing.md, insets.left + theme.spacing.md),
          paddingRight: Math.max(theme.spacing.md, insets.right + theme.spacing.md),
        },
      ]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.passwordModalLayout}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
        >
          <View style={styles.passwordModal}>
            <ScrollView
              style={styles.passwordModalScroll}
              contentContainerStyle={styles.passwordModalContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
            {confirmChange ? (
              <View style={styles.section}>
                <Text style={styles.cardEyebrow}>ACCOUNT SECURITY</Text>
                <Text style={styles.sectionTitle}>Confirm password change</Text>
                <Text style={styles.muted}>
                  Change the password for this account? Your other active sessions will be signed out.
                </Text>
                <ErrorText message={error} />
              </View>
            ) : (
              <>
                <Text style={styles.cardEyebrow}>ACCOUNT SECURITY</Text>
                <Text style={styles.sectionTitle}>Change your password</Text>
                <Text style={styles.muted}>
                  Confirm your current password, then choose a new one. You’ll stay signed in here; other sessions will be signed out.
                </Text>
                <TextInput
                  accessibilityLabel="Current password"
                  placeholder="Current password"
                  placeholderTextColor={theme.colors.secondaryText}
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  secureTextEntry
                  autoComplete="current-password"
                  textContentType="password"
                  editable={!busy && !success}
                  style={styles.input}
                />
                <TextInput
                  accessibilityLabel="New password"
                  placeholder="New password (at least 8 characters)"
                  placeholderTextColor={theme.colors.secondaryText}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  secureTextEntry
                  autoComplete="new-password"
                  textContentType="newPassword"
                  editable={!busy && !success}
                  style={styles.input}
                />
                <TextInput
                  accessibilityLabel="Confirm new password"
                  placeholder="Confirm new password"
                  placeholderTextColor={theme.colors.secondaryText}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry
                  autoComplete="new-password"
                  textContentType="newPassword"
                  editable={!busy && !success}
                  style={styles.input}
                  onSubmitEditing={() => void submit()}
                  returnKeyType="done"
                />
                <ErrorText message={error} />
                {success ? <Text style={styles.passwordSuccess}>{success}</Text> : null}
              </>
            )}
            </ScrollView>
            <View style={styles.passwordModalActions}>
              {confirmChange ? (
                <>
                  <ActionButton
                    label="Go back"
                    disabled={busy}
                    onPress={() => setConfirmChange(false)}
                  />
                  <PrimaryButton
                    label={busy ? 'Changing…' : 'Confirm and change password'}
                    disabled={busy}
                    onPress={() => void confirmPasswordChange()}
                    fullWidth
                  />
                </>
              ) : (
                <>
                  <ActionButton
                    label={success ? 'Done' : 'Cancel'}
                    disabled={busy}
                    onPress={onClose}
                  />
                  {!success ? (
                    <PrimaryButton
                      label={busy ? 'Checking…' : 'Confirm password change'}
                      disabled={busy}
                      onPress={() => void submit()}
                      fullWidth
                    />
                  ) : null}
                </>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function DashboardHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  const { width } = useWindowDimensions();
  const isPhone = width < 600;
  return (
    <View style={[styles.topBar, isPhone && styles.topBarPhone]}>
      <View style={styles.flex}>
        {!isPhone ? <Text style={styles.brandSmall}>ManageNest</Text> : null}
        <Text numberOfLines={1} style={[styles.pageTitle, isPhone && styles.pageTitlePhone]}>{title}</Text>
        <Text numberOfLines={1} style={[styles.muted, isPhone && styles.headerSubtitlePhone]}>{subtitle}</Text>
      </View>
    </View>
  );
}

function AccountSettingsScreen({
  name,
  username,
  email,
  phoneNumber,
  role,
  onChangePassword,
  onSignOut,
}: {
  name: string;
  username: string;
  email?: string | null;
  phoneNumber?: string | null;
  role: string;
  onChangePassword: () => void;
  onSignOut: () => void;
}) {
  return (
    <View style={styles.accountPage}>
      <View style={styles.section}>
        <Text style={styles.cardEyebrow}>YOUR PROFILE</Text>
        <Text style={styles.sectionTitle}>Account details</Text>
        <View style={styles.accountDetails}>
          <AccountDetailRow label="Name" value={name} />
          {username ? <AccountDetailRow label="Username" value={`@${username}`} /> : null}
          <AccountDetailRow label="Role" value={role} />
          {email ? <AccountDetailRow label="Email" value={email} /> : null}
          {phoneNumber ? <AccountDetailRow label="Phone" value={phoneNumber} /> : null}
        </View>
      </View>
      <View style={styles.section}>
        <Text style={styles.cardEyebrow}>SECURITY</Text>
        <Text style={styles.sectionTitle}>Password and access</Text>
        <Text style={styles.muted}>Manage your password or securely sign out of this account.</Text>
        <View style={styles.accountActions}>
          <ActionButton label="Change password" onPress={onChangePassword} />
          <ActionButton label="Sign out" onPress={onSignOut} destructive />
        </View>
      </View>
    </View>
  );
}

function AccountDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.accountDetailRow}>
      <Text style={styles.accountDetailLabel}>{label}</Text>
      <Text style={styles.accountDetailValue}>{value}</Text>
    </View>
  );
}

function Metric({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <View style={[styles.metric, compact && styles.metricPhone]}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function BrandHeader({ subtitle }: { subtitle: string }) {
  return (
    <View style={styles.brandBlock}>
      <View style={styles.logoMark}><Text style={styles.logoText}>C</Text></View>
      <Text style={styles.brand}>ManageNest</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      <View style={styles.secureLabel}><View style={styles.secureDot} /><Text style={styles.secureText}>SECURE COMPANY WORKSPACE</Text></View>
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled,
  fullWidth = false,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  fullWidth?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.button, fullWidth && styles.buttonFullWidth, disabled && styles.buttonDisabled, pressed && !disabled && styles.buttonPressed]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function ActionButton({
  label,
  onPress,
  disabled = false,
  destructive = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const { width } = useWindowDimensions();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.actionButton, width < 600 && styles.actionButtonPhone, destructive && styles.destructiveButton, disabled && styles.buttonDisabled, pressed && !disabled && styles.controlPressed]}>
      <Text style={[styles.actionText, destructive && styles.destructiveText]}>{label}</Text>
    </Pressable>
  );
}

function usePullToRefresh(refresh: () => Promise<void>) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const inFlight = useRef(false);
  const onRefresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    setRefreshError('');
    try {
      await refresh();
    } catch (cause) {
      setRefreshError(cause instanceof Error ? cause.message : 'Unable to refresh this screen');
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, [refresh]);
  return { refreshing, refreshError, onRefresh };
}

function createPullToRefreshControl(refreshing: boolean, onRefresh: () => void) {
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={() => void onRefresh()}
      colors={[theme.colors.primary]}
      tintColor={theme.colors.primary}
      progressBackgroundColor={theme.colors.white}
      title="Refreshing…"
      titleColor={theme.colors.secondaryText}
    />
  );
}

function ErrorText({ message }: { message: string }) {
  return message ? <View accessibilityRole="alert" style={styles.errorBox}><Text style={styles.error}>{message}</Text></View> : null;
}

function Loading() {
  return (
    <SafeAreaView style={styles.centered}>
      <View style={styles.loadingMark}><Text style={styles.logoText}>C</Text></View>
      <ActivityIndicator color={theme.colors.primary} size="small" />
      <Text style={styles.loadingText}>Preparing your workspace</Text>
    </SafeAreaView>
  );
}

function AppInput(props: TextInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      {...props}
      placeholderTextColor={theme.colors.secondaryText}
      onFocus={(event) => {
        setFocused(true);
        props.onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        props.onBlur?.(event);
      }}
      style={[styles.input, focused && styles.inputFocused, props.style]}
    />
  );
}

function clerkError(error: unknown) {
  if (typeof error === 'object' && error !== null && 'errors' in error) {
    const errors = error.errors;
    if (Array.isArray(errors) && errors[0] && 'longMessage' in errors[0]) {
      return String(errors[0].longMessage);
    }
  }
  return error instanceof Error ? error.message : 'Authentication failed';
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.colors.background },
  flex: { flex: 1 },
  centered: { flex: 1, backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl, gap: theme.spacing.md },
  page: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.xl },
  pagePhone: { justifyContent: 'flex-start', paddingHorizontal: 18, paddingVertical: 22 },
  dashboard: { width: '100%', maxWidth: 1120, alignSelf: 'center', padding: theme.spacing.lg, paddingBottom: theme.spacing.xxl, gap: theme.spacing.lg },
  dashboardShell: { flex: 1, flexDirection: 'row', backgroundColor: theme.colors.background },
  dashboardShellMobile: { flexDirection: 'column' },
  dashboardPhone: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 28, gap: 16 },
  dashboardMain: { flex: 1, minWidth: 0 },
  workerWorkspace: { flex: 1, width: '100%', maxWidth: 1120, alignSelf: 'center', padding: theme.spacing.lg, gap: theme.spacing.lg },
  workerWorkspacePhone: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8, gap: 14 },
  workerTaskList: { flexGrow: 1, gap: 14, paddingBottom: 28 },
  sidebar: { width: 264, flexShrink: 0, backgroundColor: theme.colors.white, borderRightWidth: 1, borderRightColor: theme.colors.border, paddingHorizontal: 17, paddingTop: 24, paddingBottom: 18 },
  sidebarBrand: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  sidebarLogo: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.ice },
  sidebarLogoText: { color: theme.colors.primary, fontSize: 20, fontWeight: '800' },
  sidebarBrandName: { color: theme.colors.navy, fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  sidebarCaption: { color: theme.colors.secondaryText, fontSize: 8, fontWeight: '700', letterSpacing: 1, marginTop: 3 },
  sidebarIdentity: { marginTop: 24, marginBottom: 18, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 14, backgroundColor: theme.colors.paleBlue },
  sidebarIdentityLabel: { color: theme.colors.secondaryText, fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  sidebarIdentityName: { color: theme.colors.text, fontSize: 12, fontWeight: '600', marginTop: 5 },
  sidebarItems: { flex: 1 },
  sidebarGroup: { marginBottom: 16 },
  sidebarGroupLabel: { color: theme.colors.secondaryText, fontSize: 9, fontWeight: '800', letterSpacing: 1.1, paddingHorizontal: 11, marginBottom: 6, marginTop: 9 },
  sidebarItem: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 11, marginBottom: 3 },
  sidebarItemMobile: { minHeight: 48 },
  sidebarItemActive: { backgroundColor: theme.colors.ice },
  sidebarItemText: { color: theme.colors.secondaryText, fontSize: 12, fontWeight: '500' },
  sidebarItemTextActive: { color: theme.colors.primaryDeep, fontWeight: '700' },
  sidebarFooter: { color: theme.colors.secondaryText, fontSize: 9, paddingHorizontal: 4, paddingTop: 12 },
  mobileNav: { minHeight: 68, width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: theme.colors.white, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  mobileNavBrand: { flex: 1, minWidth: 0 },
  mobileSidebarLogo: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: theme.colors.ice },
  mobileNavTitle: { color: theme.colors.navy, fontSize: 14, fontWeight: '700' },
  mobileNavSubtitle: { color: theme.colors.secondaryText, fontSize: 10, marginTop: 3 },
  mobileMenuButton: { minWidth: 84, minHeight: 44, flexShrink: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 13, backgroundColor: theme.colors.ice, borderWidth: 1, borderColor: theme.colors.softBorder },
  mobileMenuIcon: { width: 17, gap: 3 },
  mobileMenuLine: { height: 2, width: '100%', borderRadius: 2, backgroundColor: theme.colors.primaryDeep },
  mobileMenuLineShort: { width: '68%' },
  mobileMenuLabel: { color: theme.colors.primaryDeep, fontSize: 12, fontWeight: '700' },
  drawerBackdrop: { flex: 1, flexDirection: 'row' },
  drawerScrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(16, 29, 53, 0.46)' },
  drawer: { width: 304, maxWidth: '86%', height: '100%', backgroundColor: theme.colors.white, padding: 18, paddingTop: 26, shadowColor: theme.colors.navy, shadowOffset: { width: 8, height: 0 }, shadowOpacity: 0.12, shadowRadius: 22, elevation: 12 },
  managerWelcome: { padding: theme.spacing.xl, borderRadius: theme.radius.card, backgroundColor: theme.colors.navy, overflow: 'hidden' },
  managerWelcomePhone: { padding: 20 },
  welcomeTitle: { color: theme.colors.white, fontSize: 25, letterSpacing: -0.5, fontWeight: '700', marginBottom: 8 },
  chartGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md },
  chartGridPhone: { flexDirection: 'column' },
  chartPanel: { flexGrow: 1, flexBasis: 320 },
  chartPanelPhone: { width: '100%', flexBasis: 'auto', padding: 16 },
  dashboardMetricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  dashboardMetricGridPhone: { flexDirection: 'column' },
  dashboardMetric: { flexBasis: '22%', flexGrow: 1, minWidth: 145, minHeight: 88, justifyContent: 'center', padding: 16, borderRadius: 18, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border, shadowColor: theme.colors.shadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.035, shadowRadius: 12, elevation: 1 },
  dashboardMetricPhone: { width: '100%', minWidth: 0, flexBasis: 'auto', flexGrow: 0 },
  dashboardMetricValue: { color: theme.colors.navy, fontSize: 17, letterSpacing: -0.3, fontWeight: '700' },
  dashboardBarRow: { gap: 7 },
  roleOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  roleOption: { minHeight: 40, justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.pill, backgroundColor: theme.colors.white },
  roleOptionActive: { backgroundColor: theme.colors.ice, borderColor: theme.colors.primary },
  roleOptionText: { color: theme.colors.secondaryText, fontSize: 11, fontWeight: '600' },
  roleOptionTextActive: { color: theme.colors.primaryDeep },
  taskAssignees: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 7 },
  taskAssigneesPhone: { flexDirection: 'column' },
  taskCard: { gap: 9, padding: 16, marginTop: 8, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 18, backgroundColor: theme.colors.white, shadowColor: theme.colors.shadow, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.03, shadowRadius: 10, elevation: 1 },
  taskHeading: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  taskStatus: { color: theme.colors.primaryDeep, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  taskStatusComplete: { color: theme.colors.success },
  warehouseDetail: { marginTop: 12, gap: 13 },
  warehouseRecordsPanel: { gap: 10, padding: 14, borderRadius: 16, backgroundColor: theme.colors.paleBlue, borderWidth: 1, borderColor: theme.colors.border },
  moduleSelector: { flexGrow: 0 },
  moduleChip: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 12, marginRight: 7, borderRadius: theme.radius.pill, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border },
  moduleChipActive: { backgroundColor: theme.colors.ice, borderColor: theme.colors.primary },
  moduleChipText: { color: theme.colors.secondaryText, fontSize: 10, fontWeight: '600' },
  moduleChipTextActive: { color: theme.colors.primaryDeep },
  truckProfile: { gap: 8, padding: 14, marginTop: 12, borderRadius: 16, backgroundColor: theme.colors.paleBlue, borderWidth: 1, borderColor: theme.colors.border },
  warehouseHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  warehouseHeadingPhone: { flexDirection: 'column', alignItems: 'stretch' },
  warehouseTabs: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  warehouseTab: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 12, marginRight: 4, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  warehouseTabActive: { borderBottomColor: theme.colors.primary },
  warehouseTabText: { color: theme.colors.secondaryText, fontSize: 11, fontWeight: '600' },
  warehouseTabTextActive: { color: theme.colors.primaryDeep },
  detailLoading: { marginVertical: 18 },
  filterGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterGridPhone: { flexDirection: 'column' },
  datePickerTrigger: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 13, borderRadius: theme.radius.input, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border },
  datePickerIcon: { color: theme.colors.primary, fontSize: 17, fontWeight: '700' },
  datePickerClear: { alignSelf: 'flex-end', paddingVertical: 5, paddingHorizontal: 2 },
  datePickerModal: { maxWidth: 560, flexShrink: 1, padding: theme.spacing.md, borderRadius: theme.radius.panel, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border, shadowColor: theme.colors.navy, shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.14, shadowRadius: 28, elevation: 8 },
  datePickerPreview: { marginTop: -8, marginBottom: 10, color: theme.colors.primaryDeep, fontSize: 13, fontWeight: '700' },
  datePickerGroupTitle: { marginTop: 10, marginBottom: -3, color: theme.colors.secondaryText, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  datePickerGroup: { flexDirection: 'row', gap: 7 },
  datePickerColumn: { flex: 1, minWidth: 0, gap: 5 },
  datePickerColumnLabel: { color: theme.colors.secondaryText, fontSize: 8, fontWeight: '800', letterSpacing: 0.7, textAlign: 'center' },
  datePickerWheel: { height: DATE_PICKER_VIEW_HEIGHT, overflow: 'hidden', borderRadius: 12, backgroundColor: theme.colors.paleBlue, position: 'relative' },
  datePickerSelection: { position: 'absolute', zIndex: 1, top: (DATE_PICKER_VIEW_HEIGHT - DATE_PICKER_ROW_HEIGHT) / 2, left: 3, right: 3, height: DATE_PICKER_ROW_HEIGHT, borderRadius: 9, backgroundColor: theme.colors.ice, borderWidth: 1, borderColor: theme.colors.softBorder },
  datePickerScroll: { zIndex: 2, elevation: 2 },
  datePickerWheelItem: { height: DATE_PICKER_ROW_HEIGHT, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  datePickerWheelText: { color: '#536681', fontSize: 11, fontWeight: '600', textAlign: 'center' },
  datePickerWheelTextSelected: { color: theme.colors.navy, fontSize: 12, fontWeight: '800' },
  datePickerActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 14 },
  comparisonTable: { minWidth: 760 },
  comparisonHeader: { flexDirection: 'row', alignItems: 'center', minHeight: 38, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  comparisonHeaderText: { flex: 1, minWidth: 96, color: theme.colors.secondaryText, fontSize: 10, fontWeight: '700' },
  comparisonRow: { flexDirection: 'row', alignItems: 'center', minHeight: 64, gap: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  comparisonName: { flex: 1.5, minWidth: 130 },
  comparisonValue: { flex: 1, minWidth: 96, color: theme.colors.text, fontSize: 11, fontWeight: '600' },
  comparisonCards: { gap: 10, marginTop: 10 },
  comparisonCard: { padding: 14, gap: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 14, backgroundColor: theme.colors.paleBlue },
  comparisonCardHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  comparisonCardMetrics: { gap: 8 },
  comparisonCardMetric: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingVertical: 5, borderTopWidth: 1, borderTopColor: theme.colors.border },
  comparisonCardValue: { flexShrink: 1, color: theme.colors.text, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  linkText: { color: theme.colors.primary, fontSize: 10, fontWeight: '700' },
  warningBanner: { padding: 12, borderRadius: 12, backgroundColor: theme.colors.warningSurface, borderWidth: 1, borderColor: theme.colors.warning },
  successBanner: { padding: 12, borderRadius: 12, backgroundColor: theme.colors.successSurface, borderWidth: 1, borderColor: theme.colors.success },
  noticeText: { color: theme.colors.text, fontSize: 12, lineHeight: 18 },
  donutLayout: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.spacing.lg, marginTop: 8 },
  donutWrap: { width: 118, height: 118, alignItems: 'center', justifyContent: 'center' },
  donutWebFallback: { position: 'absolute', left: 0, right: 0, bottom: 14, height: 12, borderRadius: theme.radius.pill, flexDirection: 'row', overflow: 'hidden' },
  donutWebSegment: { height: '100%' },
  donutCenter: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  donutValue: { color: theme.colors.navy, fontSize: 23, fontWeight: '700' },
  donutCaption: { color: theme.colors.secondaryText, fontSize: 8, fontWeight: '700', letterSpacing: 1 },
  donutLegend: { flex: 1, minWidth: 140, gap: 11 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 8, height: 8, borderRadius: theme.radius.pill },
  legendLabel: { flex: 1, color: theme.colors.secondaryText, fontSize: 11 },
  legendValue: { color: theme.colors.text, fontSize: 12, fontWeight: '700' },
  chartEmpty: { minHeight: 136, justifyContent: 'center' },
  chartEmptyHint: { color: theme.colors.secondaryText, fontSize: 11, lineHeight: 17 },
  histogram: { gap: 17, marginTop: 12 },
  histogramRow: { gap: 7 },
  histogramHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  histogramLabel: { flex: 1, color: theme.colors.secondaryText, fontSize: 11, textTransform: 'capitalize' },
  histogramValue: { color: theme.colors.text, fontSize: 11, fontWeight: '700' },
  histogramTrack: { height: 8, borderRadius: theme.radius.pill, backgroundColor: theme.colors.paleBlue, overflow: 'hidden' },
  histogramFill: { height: '100%', borderRadius: theme.radius.pill, backgroundColor: theme.colors.primary },
  snapshotRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  snapshotLabel: { flex: 1, minWidth: 0, color: theme.colors.secondaryText, fontSize: 12 },
  snapshotValue: { flexShrink: 1, color: theme.colors.navy, fontSize: 14, fontWeight: '700', textAlign: 'right' },
  moduleState: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 12, padding: theme.spacing.lg },
  moduleSummary: { gap: 8, marginBottom: theme.spacing.md },
  moduleCount: { color: theme.colors.navy, fontSize: 30, fontWeight: '700', letterSpacing: -0.8 },
  moduleModalBackdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: theme.spacing.md, backgroundColor: 'rgba(16, 29, 53, 0.46)' },
  moduleEditorLayout: { width: '100%', maxWidth: 560, maxHeight: '100%', justifyContent: 'center' },
  moduleEditor: { width: '100%', maxWidth: 560, maxHeight: '90%', flexShrink: 1, padding: theme.spacing.lg, borderRadius: theme.radius.panel, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border, shadowColor: theme.colors.navy, shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.14, shadowRadius: 28, elevation: 8 },
  moduleEditorInput: { minHeight: 220, maxHeight: 380, paddingTop: 13, textAlignVertical: 'top', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12 },
  moduleRecord: { marginBottom: theme.spacing.md, padding: theme.spacing.md, borderRadius: theme.radius.card, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border, shadowColor: theme.colors.shadow, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.025, shadowRadius: 10, elevation: 1 },
  moduleRecordTitle: { color: theme.colors.navy, fontSize: 15, fontWeight: '700', marginBottom: 12 },
  moduleRecordFields: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  moduleRecordFieldsPhone: { flexDirection: 'column' },
  moduleRecordField: { minWidth: 120, flexGrow: 1, flexBasis: '40%', gap: 4 },
  moduleRecordFieldPhone: { width: '100%', minWidth: 0, flexBasis: 'auto' },
  moduleRecordLabel: { color: theme.colors.secondaryText, fontSize: 10, textTransform: 'capitalize' },
  moduleRecordValue: { color: theme.colors.text, fontSize: 12, fontWeight: '600' },
  moduleRecordDate: { marginTop: 12, color: theme.colors.secondaryText, fontSize: 10 },
  modulePagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: theme.spacing.sm },
  messageScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg, gap: theme.spacing.md, backgroundColor: theme.colors.background },
  brandBlock: { width: '100%', maxWidth: 440, alignItems: 'center', marginBottom: theme.spacing.lg },
  logoMark: { width: 62, height: 62, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.ice, borderWidth: 1, borderColor: theme.colors.softBorder, marginBottom: 18, shadowColor: theme.colors.primaryDeep, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 2 },
  logoText: { color: theme.colors.primary, fontWeight: '800', fontSize: 31, letterSpacing: -1 },
  brand: { color: theme.colors.navy, fontSize: 22, letterSpacing: 2.4, fontWeight: '800' },
  brandAccent: { color: theme.colors.primary },
  brandSmall: { color: theme.colors.primary, fontSize: 11, letterSpacing: 1.8, fontWeight: '800' },
  subtitle: { color: theme.colors.secondaryText, fontSize: 14, marginTop: 8, textAlign: 'center' },
  secureLabel: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 17 },
  secureDot: { width: 6, height: 6, borderRadius: theme.radius.pill, backgroundColor: theme.colors.success },
  secureText: { color: theme.colors.secondaryText, fontSize: 9, fontWeight: '700', letterSpacing: 1.2 },
  muted: { color: theme.colors.secondaryText, fontSize: 13, lineHeight: 20 },
  input: { width: '100%', minHeight: 52, borderWidth: 1, borderColor: '#DCE5F0', borderRadius: theme.radius.input, backgroundColor: '#FBFCFE', color: theme.colors.text, paddingHorizontal: 15, marginTop: 10, fontSize: 14 },
  inputFocused: { borderColor: theme.colors.primary, backgroundColor: theme.colors.white, shadowColor: theme.colors.primary, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.08, shadowRadius: 6 },
  authCard: { width: '100%', maxWidth: 440, padding: theme.spacing.lg, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.panel, shadowColor: theme.colors.shadow, shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.07, shadowRadius: 28, elevation: 4 },
  cardEyebrow: { color: theme.colors.primary, fontSize: 10, fontWeight: '800', letterSpacing: 1.3, marginBottom: 8 },
  formTitle: { color: theme.colors.navy, fontSize: 23, letterSpacing: -0.5, fontWeight: '700' },
  formDescription: { color: theme.colors.secondaryText, fontSize: 13, lineHeight: 20, marginTop: 7, marginBottom: 10 },
  inputLabel: { color: theme.colors.text, fontSize: 12, fontWeight: '700', marginTop: 16, marginBottom: 2 },
  moduleField: { marginBottom: 8 },
  moduleTextArea: { minHeight: 88, textAlignVertical: 'top', paddingTop: 12 },
  formHelp: { color: theme.colors.secondaryText, fontSize: 10, lineHeight: 15, marginTop: 5 },
  formCheckboxRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  formCheckbox: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 6, backgroundColor: theme.colors.white },
  formCheckboxChecked: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary },
  formCheckboxMark: { color: theme.colors.white, fontSize: 13, fontWeight: '800' },
  recordPicker: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 14, marginTop: 7, borderWidth: 1, borderColor: '#DCE5F0', borderRadius: theme.radius.input, backgroundColor: '#FBFCFE' },
  recordPickerValue: { flex: 1, color: theme.colors.text, fontSize: 13, fontWeight: '600' },
  recordPickerPlaceholder: { flex: 1, color: theme.colors.secondaryText, fontSize: 13 },
  currencySelect: { width: '100%', minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#DCE5F0', borderRadius: theme.radius.input, backgroundColor: '#FBFCFE', paddingHorizontal: 12, marginTop: 7 },
  currencySymbol: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: theme.colors.ice },
  currencySymbolText: { color: theme.colors.primary, fontSize: 16, fontWeight: '700' },
  currencySummary: { flex: 1 },
  currencyName: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
  currencyCode: { color: theme.colors.secondaryText, fontSize: 10, fontWeight: '600', letterSpacing: 0.6, marginTop: 3 },
  currencyChevron: { color: theme.colors.secondaryText, fontSize: 20, paddingHorizontal: 5 },
  currencyError: { marginTop: 8, padding: 11, borderRadius: theme.radius.input, backgroundColor: theme.colors.errorSurface },
  currencyRetry: { alignSelf: 'flex-start', marginTop: 8, paddingVertical: 5, paddingHorizontal: 8 },
  currencyRetryText: { color: theme.colors.primary, fontSize: 12, fontWeight: '700' },
  modalBackdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: theme.spacing.lg, backgroundColor: 'rgba(16, 29, 53, 0.46)' },
  modalKeyboardLayout: { width: '100%', maxWidth: 480, maxHeight: '100%', justifyContent: 'center' },
  currencyModal: { width: '100%', maxWidth: 480, maxHeight: '82%', padding: theme.spacing.lg, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.panel, shadowColor: theme.colors.navy, shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.16, shadowRadius: 28, elevation: 8 },
  modalHandle: { width: 34, height: 4, alignSelf: 'center', borderRadius: theme.radius.pill, backgroundColor: theme.colors.border, marginBottom: 18 },
  modalHeading: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  modalTitle: { color: theme.colors.navy, fontSize: 21, fontWeight: '700' },
  modalClose: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.pill, backgroundColor: theme.colors.background },
  modalCloseText: { color: theme.colors.secondaryText, fontSize: 22, lineHeight: 24 },
  currencyList: { maxHeight: 390, marginTop: 9 },
  moduleFormFields: { maxHeight: 430, flexShrink: 1, marginTop: 10 },
  currencyOption: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  currencyOptionSelected: { backgroundColor: theme.colors.paleBlue, borderRadius: 10 },
  currencyCheck: { color: theme.colors.primary, fontSize: 17, fontWeight: '700', paddingHorizontal: 5 },
  currencyLoading: { alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 130 },
  currencySource: { color: theme.colors.secondaryText, fontSize: 10, textAlign: 'center', marginTop: 12 },
  button: { minHeight: 52, borderRadius: 15, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 14, paddingHorizontal: 18, shadowColor: theme.colors.primaryDeep, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.18, shadowRadius: 11, elevation: 3 },
  buttonFullWidth: { width: '100%', marginTop: 0 },
  buttonDisabled: { opacity: 0.48, shadowOpacity: 0 },
  buttonPressed: { backgroundColor: theme.colors.primaryDeep, transform: [{ scale: 0.98 }] },
  controlPressed: { opacity: 0.76, transform: [{ scale: 0.985 }] },
  buttonText: { color: theme.colors.white, fontSize: 14, fontWeight: '700', letterSpacing: 0.1 },
  errorBox: { backgroundColor: theme.colors.errorSurface, borderColor: theme.colors.errorBorder, borderWidth: 1, borderRadius: theme.radius.input, paddingHorizontal: 14, paddingVertical: 12, marginTop: 12 },
  error: { color: theme.colors.error, fontSize: 12, lineHeight: 18 },
  smallPrint: { color: theme.colors.secondaryText, textAlign: 'center', fontSize: 11, lineHeight: 17, marginTop: 16, maxWidth: 420 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 14, paddingVertical: 8, marginBottom: 2 },
  topBarPhone: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  headerActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
  headerActionsPhone: { flexDirection: 'row', flexWrap: 'nowrap', flexShrink: 0, justifyContent: 'flex-start', gap: 6 },
  pageTitle: { color: theme.colors.navy, fontSize: 27, letterSpacing: -0.7, fontWeight: '700', marginTop: 6, marginBottom: 4 },
  pageTitlePhone: { fontSize: 17, letterSpacing: -0.25, marginTop: 0, marginBottom: 2 },
  headerSubtitlePhone: { fontSize: 10, lineHeight: 14 },
  signOut: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white },
  headerActionPhone: { flex: 0, minHeight: 40, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 9 },
  signOutText: { color: theme.colors.text, fontSize: 12, fontWeight: '600' },
  signOutTextPhone: { fontSize: 10 },
  accountPage: { gap: theme.spacing.md },
  accountDetails: { marginTop: 6 },
  accountDetailRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderTopWidth: 1, borderTopColor: theme.colors.border },
  accountDetailLabel: { color: theme.colors.secondaryText, fontSize: 12, fontWeight: '500' },
  accountDetailValue: { flexShrink: 1, color: theme.colors.text, fontSize: 13, fontWeight: '600', textAlign: 'right' },
  accountActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 },
  passwordModalBackdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: theme.spacing.md, backgroundColor: 'rgba(16, 29, 53, 0.46)' },
  passwordModalLayout: { width: '100%', maxWidth: 520, maxHeight: '100%', justifyContent: 'center' },
  passwordModal: { maxHeight: '90%', padding: theme.spacing.lg, borderRadius: theme.radius.panel, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border },
  passwordModalScroll: { flexShrink: 1 },
  passwordModalContent: { gap: 12 },
  passwordModalActions: { gap: 9, paddingTop: 14, borderTopWidth: 1, borderTopColor: theme.colors.border },
  passwordSuccess: { color: theme.colors.success, fontSize: 12, lineHeight: 18 },
  metrics: { flexDirection: 'row', gap: theme.spacing.md },
  metricsPhone: { flexDirection: 'column' },
  metric: { flex: 1, minHeight: 100, justifyContent: 'center', padding: theme.spacing.md, borderRadius: theme.radius.card, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border, shadowColor: theme.colors.shadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 14, elevation: 1 },
  metricPhone: { width: '100%', flex: 0, minHeight: 80 },
  metricValue: { color: theme.colors.navy, fontSize: 20, letterSpacing: -0.4, fontWeight: '700' },
  metricLabel: { color: theme.colors.secondaryText, fontSize: 11, marginTop: 6, fontWeight: '500' },
  section: { padding: theme.spacing.lg, backgroundColor: theme.colors.white, borderRadius: theme.radius.card, borderWidth: 1, borderColor: theme.colors.border, shadowColor: theme.colors.shadow, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.04, shadowRadius: 16, elevation: 1 },
  sectionTitle: { color: theme.colors.navy, fontSize: 18, letterSpacing: -0.25, fontWeight: '700', marginBottom: 7 },
  emptyState: { alignItems: 'center', paddingHorizontal: 20, paddingVertical: 30, borderRadius: 16, backgroundColor: theme.colors.paleBlue, marginTop: 10 },
  emptyMark: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: theme.colors.ice, marginBottom: 11 },
  emptyMarkText: { color: theme.colors.primary, fontSize: 14, fontWeight: '800' },
  emptyTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  emptyDescription: { color: theme.colors.secondaryText, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 5, maxWidth: 320 },
  inlineEmpty: { paddingVertical: 12 },
  record: { paddingVertical: 15, borderTopWidth: 1, borderTopColor: theme.colors.border, gap: 5 },
  warehouseRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  warehouseIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: theme.colors.ice, alignItems: 'center', justifyContent: 'center' },
  warehouseIconText: { color: theme.colors.primary, fontWeight: '800' },
  warehouseName: { color: theme.colors.text, fontWeight: '600', fontSize: 14, marginBottom: 3 },
  activeTag: { alignSelf: 'flex-start', color: theme.colors.success, backgroundColor: theme.colors.successSurface, overflow: 'hidden', borderRadius: theme.radius.pill, paddingHorizontal: 9, paddingVertical: 4, fontSize: 9, fontWeight: '800', letterSpacing: 0.7, marginTop: 4 },
  disabledTag: { alignSelf: 'flex-start', color: theme.colors.warning, backgroundColor: theme.colors.warningSurface, overflow: 'hidden', borderRadius: theme.radius.pill, paddingHorizontal: 9, paddingVertical: 4, fontSize: 9, fontWeight: '800', letterSpacing: 0.7, marginTop: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 10 },
  actionsPhone: { width: '100%' },
  actionButton: { minHeight: 40, justifyContent: 'center', paddingVertical: 9, paddingHorizontal: 14, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white },
  actionButtonPhone: { minHeight: 46, justifyContent: 'center', paddingHorizontal: 16 },
  actionText: { color: theme.colors.text, fontSize: 12, fontWeight: '600' },
  factorOption: { paddingVertical: 11, paddingHorizontal: 13, borderRadius: theme.radius.input, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.paleBlue, marginTop: 8 },
  destructiveButton: { borderColor: theme.colors.errorBorder, backgroundColor: theme.colors.dangerSurface },
  destructiveText: { color: theme.colors.error },
  credential: { padding: theme.spacing.lg, backgroundColor: theme.colors.successSurface, borderWidth: 1, borderColor: theme.colors.successBorder, borderRadius: theme.radius.card },
  password: { color: theme.colors.navy, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.successBorder, borderRadius: theme.radius.input, padding: 13, marginTop: 12, overflow: 'hidden', fontSize: 15, fontWeight: '700' },
  messageCard: { width: '100%', maxWidth: 460, padding: theme.spacing.xl, alignItems: 'center', backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.panel, shadowColor: theme.colors.shadow, shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.06, shadowRadius: 24, elevation: 3 },
  messageMark: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: theme.colors.ice, marginBottom: 14 },
  messageMarkText: { color: theme.colors.primary, fontSize: 20, fontWeight: '700' },
  messageTitle: { color: theme.colors.navy, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  messageCopy: { color: theme.colors.secondaryText, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 8 },
  loadingMark: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: theme.colors.ice },
  loadingText: { color: theme.colors.secondaryText, fontSize: 13 },
});

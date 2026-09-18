import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { LoginPage } from "@/features/auth/LoginPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { PosPage } from "@/features/pos/PosPage";
import { OrdersPage } from "@/features/orders/OrdersPage";
import { ProductsPage } from "@/features/products/ProductsPage";
import { CustomersPage } from "@/features/customers/CustomersPage";
import { ReturnsPage } from "@/features/returns/ReturnsPage";
import { ShiftPage } from "@/features/shifts/ShiftPage";
import { ReceiptPage } from "@/features/receipt/ReceiptPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { ReportsPage } from "@/features/reports/ReportsPage";
import { StockTakePage } from "@/features/products/StockTakePage";
import { AuditLogsPage } from "@/features/superAdmin/AuditLogsPage";
import { BranchesPage } from "@/features/superAdmin/BranchesPage";
import { PeoplePage } from "@/features/superAdmin/PeoplePage";
import { PlatformReportsPage } from "@/features/superAdmin/ReportsPage";
import { PlatformSettingsPage } from "@/features/superAdmin/PlatformSettingsPage";
import { StoresPage } from "@/features/superAdmin/StoresPage";
import { SubscriptionsPage } from "@/features/superAdmin/SubscriptionsPage";
import { SuperAdminPage } from "@/features/superAdmin/SuperAdminPage";
import { SynchronizationPage } from "@/features/superAdmin/SynchronizationPage";
import { SystemResourcesPage } from "@/features/superAdmin/SystemResourcesPage";
import { SyncPage } from "@/features/sync/SyncPage";
import { useSession } from "@/state/session";
import { startSyncScheduler } from "@/state/sync";

function Protected({ children }: { children: React.ReactNode }) {
  const user = useSession((s) => s.user);
  const booting = useSession((s) => s.booting);

  if (booting) return <div className="boot">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;

  return <AppShell>{children}</AppShell>;
}

export default function App() {
  const restore = useSession((s) => s.restore);

  useEffect(() => {
    void restore();
  }, [restore]);

  useEffect(() => startSyncScheduler(() => useSession.getState().storeId), []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* The till is the landing page: it is what the business runs on. */}
        <Route path="/" element={<Protected><PosPage /></Protected>} />
        <Route path="/dashboard" element={<Protected><DashboardPage /></Protected>} />
        <Route path="/orders" element={<Protected><OrdersPage /></Protected>} />
        <Route path="/products" element={<Protected><ProductsPage /></Protected>} />
        <Route path="/customers" element={<Protected><CustomersPage /></Protected>} />
        <Route path="/returns" element={<Protected><ReturnsPage /></Protected>} />
        <Route path="/shift" element={<Protected><ShiftPage /></Protected>} />
        <Route path="/receipt/:orderId" element={<Protected><ReceiptPage /></Protected>} />
        <Route path="/stock-take" element={<Protected><StockTakePage /></Protected>} />
        <Route path="/reports" element={<Protected><ReportsPage /></Protected>} />
        <Route path="/settings" element={<Protected><SettingsPage /></Protected>} />
        <Route path="/platform/*" element={<Protected><SuperAdminPage /></Protected>} />
        <Route path="/platform/resources" element={<Protected><SystemResourcesPage /></Protected>} />
        <Route path="/platform/stores" element={<Protected><StoresPage /></Protected>} />
        <Route path="/platform/branches" element={<Protected><BranchesPage /></Protected>} />
        <Route path="/platform/people" element={<Protected><PeoplePage /></Protected>} />
        <Route path="/platform/subscriptions" element={<Protected><SubscriptionsPage /></Protected>} />
        <Route path="/platform/synchronization" element={<Protected><SynchronizationPage /></Protected>} />
        <Route path="/platform/reports" element={<Protected><PlatformReportsPage /></Protected>} />
        <Route path="/platform/audit-logs" element={<Protected><AuditLogsPage /></Protected>} />
        <Route path="/platform/settings" element={<Protected><PlatformSettingsPage /></Protected>} />
        <Route path="/sync" element={<Protected><SyncPage /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

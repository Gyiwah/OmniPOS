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
        <Route path="/sync" element={<Protected><SyncPage /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

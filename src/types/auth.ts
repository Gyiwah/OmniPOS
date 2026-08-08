export type UserRole = "super_admin" | "admin" | "manager" | "cashier";

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
  storeId: string;
  isSuperAdmin?: boolean;
};

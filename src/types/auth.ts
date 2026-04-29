export type UserRole = "admin" | "manager" | "cashier";

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
  storeId: string;
};

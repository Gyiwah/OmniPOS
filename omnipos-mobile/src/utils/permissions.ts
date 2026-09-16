import { UserRole } from "@/src/types/auth";

export function canManageUsers(role: UserRole | null | undefined) {
  return role === "admin" || role === "manager" || role === "super_admin";
}

/**
 * Who may create or edit the catalogue.
 *
 * Matches the Laravel ProductHandler / ProductPolicy and the web Inventory
 * screen: cashiers sell and adjust stock, they do not invent products. The
 * phone used to offer Add Product to everyone, then report "synced" while the
 * server rejected the write — the product stayed on the device and never
 * appeared in the database.
 */
export function canEditCatalogue(role: UserRole | null | undefined) {
  return role === "admin" || role === "manager" || role === "super_admin";
}

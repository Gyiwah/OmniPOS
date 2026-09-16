import { canEditCatalogue, canManageUsers } from "../utils/permissions";

describe("catalogue permissions", () => {
  it("matches the server rule: managers and admins edit the catalogue", () => {
    expect(canEditCatalogue("admin")).toBe(true);
    expect(canEditCatalogue("manager")).toBe(true);
    expect(canEditCatalogue("super_admin")).toBe(true);
    expect(canEditCatalogue("cashier")).toBe(false);
    expect(canEditCatalogue(null)).toBe(false);
  });

  it("keeps staff management on the same roles", () => {
    expect(canManageUsers("manager")).toBe(true);
    expect(canManageUsers("cashier")).toBe(false);
  });
});

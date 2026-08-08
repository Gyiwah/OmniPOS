export type SystemStore = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  taxProfile: string;
  ownerUserId: string;
  createdAt: string;
  ownerName?: string;
  ownerEmail?: string;
};

export type ProvisionStoreInput = {
  storeName: string;
  currency?: string;
  timezone?: string;
  taxProfile?: string;
  adminFullName: string;
  adminEmail: string;
  adminPassword?: string;
};

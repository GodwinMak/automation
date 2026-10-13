export type SmsMode = "bySwitch" | "byServiceType" | "byDowntime";

export type ServiceType = "DIA" | "IPT" | "SHARED" | "L3VPN" | "L2VPN" | "FTTH";

export const NON_FTTH_TYPES: ServiceType[] = ["DIA", "IPT", "SHARED", "L3VPN"];
export const SWITCH_SERVICE_TYPES: ServiceType[] = [...NON_FTTH_TYPES, "L2VPN"];
export const ALL_SERVICE_TYPES: ServiceType[] = [...NON_FTTH_TYPES, "FTTH"];

export type Recipient = {
  key: string;
  customerType: ServiceType;
  customerName: string | null;
  cid: string | null;
  interface: string | null;
  switchName: string | null;
  nbr: string | null;
  phoneNumber: string | null;
  hasPhone: boolean;
  lastDownAt?: string;
};

export type PreviewResponse = {
  mode: SmsMode;
  recipients: Recipient[];
  total: number;
  withPhone: number;
  withoutPhone: number;
  meta: Record<string, any>;
};

export type SwitchOption = {
  switchName: string;
  totalCustomers: number;
  byType: Partial<Record<ServiceType, number>>;
};

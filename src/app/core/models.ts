export interface Envelope<T> {
  success: boolean;
  message: string;
  data: T;
  errors?: Record<string, string>;
}
export interface Page<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}
export interface User {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  role: 'ADMIN' | 'USER';
  status: string;
  created_at: string;
}
export interface Contact {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  country_code: string | null;
  preferred_currency: string | null;
  notes: string | null;
  is_active: boolean;
}
export interface Catalog {
  id: number;
  name: string;
  icon: string | null;
  is_system: boolean;
  is_active: boolean;
}
export interface Transaction {
  id: number;
  contact_id: number | null;
  transaction_type: string;
  amount: string;
  currency: string;
  settled_amount: string;
  outstanding_amount: string;
  purpose: string;
  description: string | null;
  category_id: number | null;
  payment_method_id: number | null;
  reference_number: string | null;
  transaction_date: string;
  due_date: string | null;
  status: string;
  notify_email: boolean;
  notify_sms: boolean;
}
export interface Settlement {
  id: number;
  amount: string;
  currency: string;
  settlement_date: string;
  notes: string | null;
}
export interface Activity {
  id: number;
  transaction_id: number | null;
  group_id: number | null;
  kind: string;
  title: string;
  amount: string;
  currency: string;
  date: string;
  status: string;
}
export type Balances = Record<string, string>;
export interface Ledger {
  contact: Contact;
  receivables: Balances;
  payables: Balances;
  history: Page<Activity>;
}
export interface Group {
  id: number;
  owner_user_id: number;
  name: string;
  description: string | null;
  default_currency: string | null;
  is_active: boolean;
  member_count: number;
  expense_count: number;
}
export interface Member {
  id: number;
  user_id: number | null;
  contact_id: number | null;
  display_name: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
}
export interface Split {
  group_member_id: number;
  share_amount: string;
  settled_amount?: string;
}
export interface GroupExpense {
  id: number;
  title: string;
  amount: string;
  currency: string;
  paid_by_member_id: number;
  expense_date: string;
  split_type: string;
  description: string | null;
  category_id: number | null;
  payment_method_id: number | null;
  splits: Split[];
}
export interface Settings {
  default_currency: string;
  timezone: string;
  default_reminder_days_before: number;
  email_transaction_notifications: boolean;
  sms_transaction_notifications: boolean;
  email_due_reminders: boolean;
  sms_due_reminders: boolean;
  email_settlement_notifications: boolean;
  sms_settlement_notifications: boolean;
  email_group_notifications: boolean;
  sms_group_notifications: boolean;
}
export interface Reminder {
  id: number;
  transaction_id: number;
  reminder_type: string;
  scheduled_at: string;
  repeat_interval_days: number | null;
  email_enabled: boolean;
  sms_enabled: boolean;
  status: string;
}
export interface Notification {
  id: number;
  channel: string;
  notification_type: string;
  recipient: string;
  status: string;
  message: string;
  error_message: string | null;
  created_at: string;
}
export interface Dashboard {
  receivables: Balances;
  payables: Balances;
  personal_expenses_this_month: Balances;
  due_soon: Transaction[];
  overdue: Transaction[];
  recent_activity: Activity[];
  recent_settlements: Activity[];
  people_balances: {
    contact_id: number;
    name: string;
    currency: string;
    transaction_type: string;
    amount: string;
  }[];
  group_activity: Activity[];
}

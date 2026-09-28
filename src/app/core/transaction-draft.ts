import { Injectable } from '@angular/core';
// A temporary in-memory draft survives Add person navigation, without storing financial data on disk.
@Injectable({ providedIn: 'root' })
export class TransactionDraft {
  value: Record<string, any> | null = null;
  editId: number | null = null;
  clear() {
    this.value = null;
    this.editId = null;
  }
}

import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api, errorMessage, Toast } from '../core/api';
import { Reminder, Transaction, Page, Notification, Settings } from '../core/models';
import {
  StateComponent,
  PaginationComponent,
  LocalDatePipe,
  PrettyPipe,
  MoneyPipe,
} from '../shared/ui';

@Component({
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    StateComponent,
    PaginationComponent,
    LocalDatePipe,
    PrettyPipe,
    MoneyPipe,
  ],
  template: `<div class="page-heading">
      <div>
        <span class="eyebrow">A GENTLE NUDGE</span>
        <h1>Stay a step ahead.</h1>
        <p>Give important dates a little space in your day.</p>
      </div>
      <button class="primary" (click)="edit(null)">+ Add reminder</button>
    </div>
    @if (loading() || error()) {
      <app-state [loading]="loading()" [error]="error()" (retry)="load()" />
    } @else {
      <section class="panel">
        @for (r of data()?.items; track r.id) {
          <div class="record">
            <span class="record-icon">◷</span
            ><span class="record-main"
              ><strong
                ><a [routerLink]="['/transactions', r.transaction_id]">{{
                  transactionName(r.transaction_id)
                }}</a></strong
              ><small
                >{{ r.reminder_type | pretty }} · {{ r.scheduled_at | localDate }}</small
              ></span
            ><span class="pill">{{ r.status | pretty }}</span>
            @if (r.status === 'PENDING') {
              <button class="text-button" (click)="edit(r)">Edit</button
              ><button class="text-button danger" (click)="cancel(r)">Cancel</button>
            }
          </div>
        } @empty {
          <app-state
            title="Nothing to remember yet"
            message="Add a reminder for an outstanding transaction."
          />
        }
        <app-pagination
          [page]="data()?.page || 1"
          [totalPages]="data()?.total_pages || 0"
          (change)="load($event)"
        />
      </section>
    }
    @if (showForm()) {
      <div class="modal-backdrop">
        <section class="action-sheet" role="dialog" aria-modal="true" aria-label="Reminder">
          <div class="section-heading">
            <h2>{{ id ? 'Edit reminder' : 'Create reminder' }}</h2>
            <button class="icon-button" aria-label="Close" (click)="showForm.set(false)">×</button>
          </div>
          <form [formGroup]="form" (ngSubmit)="save()">
            <label
              >Transaction<select formControlName="transaction_id">
                <option [ngValue]="null">Choose a transaction</option>
                @for (t of transactions(); track t.id) {
                  <option [ngValue]="t.id">
                    {{ t.purpose }} · {{ t.outstanding_amount | money: t.currency }}
                  </option>
                }
              </select></label
            ><label
              >Type<select formControlName="reminder_type">
                @for (type of types; track type) {
                  <option [value]="type">{{ type | pretty }}</option>
                }
              </select></label
            ><label
              >Scheduled time (device timezone)<input
                type="datetime-local"
                formControlName="scheduled_at" /></label
            ><label
              >Repeat every days <small>(optional)</small
              ><input
                type="number"
                min="1"
                max="365"
                formControlName="repeat_interval_days" /></label
            ><label class="toggle"
              ><input type="checkbox" formControlName="email_enabled" />Email</label
            ><label class="toggle"
              ><input type="checkbox" formControlName="sms_enabled" />SMS</label
            >
            @if (formError()) {
              <p class="form-error" role="alert">{{ formError() }}</p>
            }
            <button class="primary full" [disabled]="busy() || form.invalid">Save reminder</button>
          </form>
        </section>
      </div>
    }`,
})
export class RemindersPage {
  private api = inject(Api);
  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private toast = inject(Toast);
  data = signal<Page<Reminder> | null>(null);
  transactions = signal<Transaction[]>([]);
  loading = signal(true);
  error = signal('');
  formError = signal('');
  busy = signal(false);
  showForm = signal(false);
  id: number | null = null;
  types = ['DUE_SOON', 'DUE_TODAY', 'OVERDUE', 'CUSTOM'];
  private defaults: Settings | null = null;
  form = this.fb.group({
    transaction_id: [null as number | null, Validators.required],
    reminder_type: ['CUSTOM'],
    scheduled_at: ['', Validators.required],
    repeat_interval_days: [null as number | null],
    email_enabled: [false],
    sms_enabled: [false],
  });
  constructor() {
    void this.initialize();
  }
  async initialize() {
    await this.load();
    if (this.route.snapshot.queryParamMap.has('transaction')) this.edit(null);
  }
  transactionName(id: number) {
    return this.transactions().find((t) => t.id === id)?.purpose || `Transaction #${id}`;
  }
  async load(page = 1) {
    this.loading.set(true);
    this.error.set('');
    try {
      const [r, t, settings] = await Promise.all([
        this.api.get<Page<Reminder>>('/reminders', { page }),
        this.api.all<Transaction>('/transactions'),
        this.api.get<Settings>('/settings'),
      ]);
      this.data.set(r);
      this.transactions.set(
        t.filter(
          (t) =>
            t.transaction_type !== 'PERSONAL_EXPENSE' &&
            !['SETTLED', 'CANCELLED'].includes(t.status),
        ),
      );
      this.defaults = settings;
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
  edit(reminder: Reminder | null) {
    this.id = reminder?.id || null;
    this.formError.set('');
    const date = reminder ? new Date(reminder.scheduled_at) : new Date(Date.now() + 3600000);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    this.form.reset({
      transaction_id:
        reminder?.transaction_id ||
        Number(this.route.snapshot.queryParamMap.get('transaction')) ||
        null,
      reminder_type: reminder?.reminder_type || 'CUSTOM',
      scheduled_at: local,
      repeat_interval_days: reminder?.repeat_interval_days || null,
      email_enabled: reminder?.email_enabled ?? this.defaults?.email_due_reminders ?? false,
      sms_enabled: reminder?.sms_enabled ?? this.defaults?.sms_due_reminders ?? false,
    });
    this.showForm.set(true);
  }
  async save() {
    if (this.form.invalid) return;
    this.busy.set(true);
    try {
      const v = this.form.getRawValue();
      await this.api.send(this.id ? 'PATCH' : 'POST', `/reminders${this.id ? '/' + this.id : ''}`, {
        ...v,
        scheduled_at: new Date(v.scheduled_at!).toISOString(),
        status: 'PENDING',
      });
      this.showForm.set(false);
      this.toast.show('Reminder saved');
      await this.load();
    } catch (e) {
      this.formError.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
  async cancel(r: Reminder) {
    if (!confirm('Cancel this reminder?')) return;
    try {
      await this.api.send('DELETE', `/reminders/${r.id}`);
      await this.load();
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}

@Component({
  standalone: true,
  imports: [StateComponent, PaginationComponent, LocalDatePipe, PrettyPipe, RouterLink],
  template: `<a class="back-link" routerLink="/profile">← Profile</a>
    <div class="page-heading">
      <div>
        <span class="eyebrow">KEEPING YOU POSTED</span>
        <h1>Notification history.</h1>
        <p>Delivery attempts, including skipped and failed messages.</p>
      </div>
    </div>
    @if (error() || loading()) {
      <app-state [loading]="loading()" [error]="error()" (retry)="load()" />
    } @else {
      <section class="panel">
        @for (n of data()?.items; track n.id) {
          <div class="record">
            <span class="record-icon">{{ n.channel === 'EMAIL' ? '✉' : '▣' }}</span
            ><span class="record-main"
              ><strong
                >{{ n.notification_type | pretty }} · {{ n.recipient || 'No recipient' }}</strong
              ><small
                >{{ n.created_at | localDate }} · {{ n.error_message || n.message }}</small
              ></span
            ><span class="pill">{{ n.status | pretty }}</span>
          </div>
        } @empty {
          <app-state title="No notifications yet" />
        }
        <app-pagination
          [page]="data()?.page || 1"
          [totalPages]="data()?.total_pages || 0"
          (change)="load($event)"
        />
      </section>
    }`,
})
export class NotificationsPage {
  private api = inject(Api);
  data = signal<Page<Notification> | null>(null);
  loading = signal(true);
  error = signal('');
  constructor() {
    void this.load();
  }
  async load(page = 1) {
    this.loading.set(true);
    this.error.set('');
    try {
      this.data.set(await this.api.get('/notifications', { page }));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
}

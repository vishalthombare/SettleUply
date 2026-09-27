import { Component, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators, FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, errorMessage, Toast } from '../core/api';
import { Preferences } from '../core/preferences';
import { Contact, Catalog, Transaction, Settlement, Page, Settings } from '../core/models';
import {
  MoneyPipe,
  PrettyPipe,
  LocalDatePipe,
  StateComponent,
  PaginationComponent,
} from '../shared/ui';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  template: ` <a class="back-link" routerLink="/activity">← Activity</a>
    <div class="page-heading">
      <div>
        <span class="eyebrow">A LITTLE RECORD GOES A LONG WAY</span>
        <h1>{{ title() }}</h1>
        <p>
          {{
            form.controls.transaction_type.value === 'PERSONAL_EXPENSE'
              ? 'Keep track of something you spent.'
              : 'Keep your shared money clear.'
          }}
        </p>
      </div>
    </div>
    <form class="panel form-panel" [formGroup]="form" (ngSubmit)="save()">
      <div class="segmented">
        @for (t of types; track t.value) {
          <button
            type="button"
            [class.selected]="form.controls.transaction_type.value === t.value"
            (click)="setType(t.value)"
          >
            {{ t.label }}
          </button>
        }
      </div>
      <div class="form-grid">
        <label
          >Amount<input
            class="money-field"
            formControlName="amount"
            inputmode="decimal"
            placeholder="0.00"
            required /></label
        ><label
          >Currency<select formControlName="currency">
            @for (c of currencies(); track c) {
              <option [value]="c">{{ c }}</option>
            }
          </select></label
        >
      </div>
      @if (form.controls.transaction_type.value !== 'PERSONAL_EXPENSE') {
        <label
          >Person<select formControlName="contact_id">
            <option [ngValue]="null">Choose a person</option>
            @for (p of contacts(); track p.id) {
              <option [ngValue]="p.id">{{ p.name }}</option>
            }
          </select></label
        ><a class="small-link" routerLink="/people/new">+ Add a new person</a>
      }
      <label
        >Purpose<input
          formControlName="purpose"
          placeholder="What was it for?"
          required
          maxlength="200"
      /></label>
      <div class="form-grid">
        <label
          >Category<select formControlName="category_id">
            <option [ngValue]="null">No category</option>
            @for (c of categories(); track c.id) {
              <option [ngValue]="c.id">{{ c.name }}</option>
            }
          </select></label
        ><label
          >Payment method<select formControlName="payment_method_id">
            <option [ngValue]="null">Not specified</option>
            @for (p of methods(); track p.id) {
              <option [ngValue]="p.id">{{ p.name }}</option>
            }
          </select></label
        ><label>Date<input type="date" formControlName="transaction_date" required /></label>
        @if (form.controls.transaction_type.value !== 'PERSONAL_EXPENSE') {
          <label
            >Due date <small>(optional)</small><input type="date" formControlName="due_date"
          /></label>
        }
      </div>
      <label>Description<textarea formControlName="description" rows="3"></textarea></label
      ><label>Reference number<input formControlName="reference_number" /></label>
      @if (form.controls.transaction_type.value !== 'PERSONAL_EXPENSE') {
        <fieldset>
          <legend>Notify this person</legend>
          <label class="toggle"
            ><input type="checkbox" formControlName="notify_email" />Email notification</label
          ><label class="toggle"
            ><input type="checkbox" formControlName="notify_sms" />SMS notification</label
          >
        </fieldset>
      }
      @if (error()) {
        <p class="form-error" role="alert">{{ error() }}</p>
      }
      <div class="form-actions">
        <a class="button secondary" routerLink="/activity">Cancel</a
        ><button class="primary" [disabled]="busy() || form.invalid || !ready()">
          {{ busy() ? 'Saving…' : 'Save record' }}
        </button>
      </div>
    </form>`,
})
export class TransactionForm {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private toast = inject(Toast);
  private preferences = inject(Preferences);
  private fb = inject(FormBuilder);
  id = Number(this.route.snapshot.paramMap.get('id')) || null;
  busy = signal(false);
  ready = signal(false);
  error = signal('');
  contacts = signal<Contact[]>([]);
  categories = signal<Catalog[]>([]);
  methods = signal<Catalog[]>([]);
  currencies = signal<string[]>([]);
  types = [
    { value: 'PERSONAL_EXPENSE', label: 'Personal expense' },
    { value: 'MONEY_LENT', label: 'Give money' },
    { value: 'MONEY_BORROWED', label: 'Borrow money' },
  ];
  form = this.fb.group({
    transaction_type: [
      this.route.snapshot.queryParamMap.get('type') || 'PERSONAL_EXPENSE',
      Validators.required,
    ],
    contact_id: [
      Number(this.route.snapshot.queryParamMap.get('contact')) || (null as number | null),
    ],
    amount: ['', [Validators.required, Validators.pattern(/^\d+(\.\d{1,4})?$/)]],
    currency: [this.preferences.currency(), Validators.required],
    purpose: ['', Validators.required],
    category_id: [null as number | null],
    payment_method_id: [null as number | null],
    description: [''],
    reference_number: [''],
    transaction_date: [this.preferences.today(), Validators.required],
    due_date: [''],
    notify_email: [false],
    notify_sms: [false],
  });
  constructor() {
    void this.load();
  }
  title() {
    return this.id
      ? 'Edit your record.'
      : this.types.find((t) => t.value === this.form.controls.transaction_type.value)?.label + '.';
  }
  setType(value: string) {
    this.form.controls.transaction_type.setValue(value);
    if (value === 'PERSONAL_EXPENSE') this.form.controls.contact_id.setValue(null);
  }
  async load() {
    try {
      const [contacts, categories, methods, currencies, settings] = await Promise.all([
        this.api.all<Contact>('/contacts'),
        this.api.all<Catalog>('/categories'),
        this.api.all<Catalog>('/payment-methods'),
        this.api.get<Record<string, number>>('/currencies'),
        this.api.get<Settings>('/settings'),
      ]);
      this.contacts.set(contacts);
      this.categories.set(categories);
      this.methods.set(methods);
      this.currencies.set(Object.keys(currencies));
      this.form.patchValue({
        currency: settings.default_currency,
        notify_email: settings.email_transaction_notifications,
        notify_sms: settings.sms_transaction_notifications,
      });
      if (this.id) {
        const tx = await this.api.get<Transaction>(`/transactions/${this.id}`);
        this.form.patchValue({
          ...tx,
          description: tx.description || '',
          reference_number: tx.reference_number || '',
          due_date: tx.due_date || '',
        });
      }
      this.ready.set(true);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
  async save() {
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const v = this.form.getRawValue();
      const result = await this.api.send<Transaction>(
        this.id ? 'PATCH' : 'POST',
        `/transactions${this.id ? '/' + this.id : ''}`,
        {
          ...v,
          contact_id: v.transaction_type === 'PERSONAL_EXPENSE' ? null : v.contact_id,
          due_date: v.due_date || null,
          description: v.description || null,
          reference_number: v.reference_number || null,
        },
      );
      this.toast.show('Record saved');
      await this.router.navigate(['/transactions', result.id]);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}

@Component({
  standalone: true,
  imports: [RouterLink, MoneyPipe, PrettyPipe, LocalDatePipe, StateComponent, PaginationComponent],
  template: ` <a class="back-link" routerLink="/activity">← Activity</a>
    @if (transaction(); as t) {
      <div class="page-heading">
        <div>
          <span class="eyebrow">{{ t.transaction_type | pretty }}</span>
          <h1>{{ t.purpose }}</h1>
          <span class="pill">{{ t.status | pretty }}</span>
        </div>
        <a class="button secondary" [routerLink]="['/transactions', id, 'edit']">Edit record</a>
      </div>
      <section class="panel detail-panel">
        <div class="detail-money">{{ t.amount | money: t.currency }}</div>
        <div class="detail-grid">
          <div>
            <small>Date</small><strong>{{ t.transaction_date | localDate }}</strong>
          </div>
          <div>
            <small>Due date</small><strong>{{ t.due_date | localDate }}</strong>
          </div>
          @if (t.transaction_type !== 'PERSONAL_EXPENSE') {
            <div>
              <small>Already settled</small
              ><strong>{{ t.settled_amount | money: t.currency }}</strong>
            </div>
            <div>
              <small>Outstanding</small
              ><strong>{{ t.outstanding_amount | money: t.currency }}</strong>
            </div>
          }
          <div>
            <small>Reference</small><strong>{{ t.reference_number || '—' }}</strong>
          </div>
        </div>
        @if (t.description) {
          <p>{{ t.description }}</p>
        }
        @if (t.contact_id) {
          <a [routerLink]="['/people', t.contact_id]">View person ledger →</a>
        }
        <div class="form-actions">
          @if (
            t.transaction_type !== 'PERSONAL_EXPENSE' &&
            t.status !== 'SETTLED' &&
            t.status !== 'CANCELLED'
          ) {
            <a class="button primary" [routerLink]="['/transactions', id, 'settle']"
              >✓ Record repayment</a
            ><a class="button secondary" routerLink="/reminders" [queryParams]="{ transaction: id }"
              >Add reminder</a
            >
          }
        </div>
      </section>
      @if (t.transaction_type !== 'PERSONAL_EXPENSE') {
        <section class="panel">
          <div class="section-heading"><h2>Repayment history</h2></div>
          @for (s of settlements()?.items; track s.id) {
            <div class="record">
              <span class="record-icon lent">✓</span
              ><span class="record-main"
                ><strong>{{ s.settlement_date | localDate }}</strong
                ><small>{{ s.notes || 'Repayment recorded' }}</small></span
              ><strong>{{ s.amount | money: s.currency }}</strong>
            </div>
          } @empty {
            <p class="padded muted">No repayments yet.</p>
          }
          <app-pagination
            [page]="settlements()?.page || 1"
            [totalPages]="settlements()?.total_pages || 0"
            (change)="loadSettlements($event)"
          />
        </section>
      }
      <button class="text-button danger" (click)="remove()">Delete record</button>
    }
    @if (loading() || error()) {
      <app-state [loading]="loading()" [error]="error()" (retry)="load()" />
    }`,
})
export class TransactionPage {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  id = Number(this.route.snapshot.paramMap.get('id'));
  transaction = signal<Transaction | null>(null);
  settlements = signal<Page<Settlement> | null>(null);
  loading = signal(true);
  error = signal('');
  constructor() {
    void this.load();
  }
  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.transaction.set(await this.api.get<Transaction>(`/transactions/${this.id}`));
      await this.loadSettlements();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
  async loadSettlements(page = 1) {
    try {
      this.settlements.set(await this.api.get(`/transactions/${this.id}/settlements`, { page }));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
  async remove() {
    if (!confirm('Delete this record? Transactions with repayments cannot be deleted.')) return;
    try {
      await this.api.send('DELETE', `/transactions/${this.id}`);
      await this.router.navigateByUrl('/activity');
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}

function units(value: string): bigint {
  const [a, b = ''] = value.split('.');
  return BigInt(a || '0') * 10000n + BigInt(b.padEnd(4, '0'));
}

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, FormsModule, RouterLink, MoneyPipe],
  template: ` <a class="back-link" routerLink="/activity">← Activity</a>
    <div class="page-heading">
      <div>
        <span class="eyebrow">ONE STEP CLOSER TO EVEN</span>
        <h1>Settle up.</h1>
        <p>Record a partial or full repayment.</p>
      </div>
    </div>
    @if (!id) {
      <section class="panel form-panel">
        <label
          >Choose a record<select [ngModel]="selected" (ngModelChange)="choose($event)">
            <option [ngValue]="null">Choose an outstanding transaction</option>
            @for (t of choices(); track t.id) {
              <option [ngValue]="t.id">
                {{ t.purpose }} · {{ t.outstanding_amount | money: t.currency }}
              </option>
            }
          </select></label
        >
      </section>
    }
    @if (transaction(); as t) {
      <form class="panel form-panel" [formGroup]="form" (ngSubmit)="save()">
        <h2>{{ t.purpose }}</h2>
        <div class="settlement-summary">
          <div>
            <small>Original amount</small><strong>{{ t.amount | money: t.currency }}</strong>
          </div>
          <div>
            <small>Already settled</small
            ><strong>{{ t.settled_amount | money: t.currency }}</strong>
          </div>
          <div>
            <small>Outstanding</small
            ><strong>{{ t.outstanding_amount | money: t.currency }}</strong>
          </div>
        </div>
        <label
          >Repayment amount ({{ t.currency }})<input
            class="money-field"
            formControlName="amount"
            inputmode="decimal"
            placeholder="0.00" /></label
        ><button
          type="button"
          class="text-button"
          (click)="form.controls.amount.setValue(t.outstanding_amount)"
        >
          Use full outstanding amount
        </button>
        <div class="form-grid">
          <label
            >Payment method<select formControlName="payment_method_id">
              <option [ngValue]="null">Not specified</option>
              @for (m of methods(); track m.id) {
                <option [ngValue]="m.id">{{ m.name }}</option>
              }
            </select></label
          ><label>Settlement date<input type="date" formControlName="settlement_date" /></label>
        </div>
        <label>Reference<input formControlName="reference_number" /></label
        ><label>Notes<textarea formControlName="notes" rows="3"></textarea></label>
        <div class="form-actions">
          <button class="primary" [disabled]="busy() || form.invalid">
            {{ busy() ? 'Saving…' : 'Record repayment' }}
          </button>
        </div>
      </form>
    }
    @if (error()) {
      <p class="form-error" role="alert">{{ error() }}</p>
    }`,
})
export class SettlementForm {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private toast = inject(Toast);
  private preferences = inject(Preferences);
  private fb = inject(FormBuilder);
  id = Number(this.route.snapshot.paramMap.get('id')) || null;
  selected: number | null = null;
  transaction = signal<Transaction | null>(null);
  choices = signal<Transaction[]>([]);
  methods = signal<Catalog[]>([]);
  error = signal('');
  busy = signal(false);
  form = this.fb.group({
    amount: ['', [Validators.required, Validators.pattern(/^\d+(\.\d{1,4})?$/)]],
    payment_method_id: [null as number | null],
    settlement_date: [this.preferences.today(), Validators.required],
    reference_number: [''],
    notes: [''],
  });
  constructor() {
    void this.load();
  }
  async load() {
    try {
      this.methods.set(await this.api.all<Catalog>('/payment-methods'));
      if (this.id) await this.choose(this.id);
      else {
        const contact = this.route.snapshot.queryParamMap.get('contact');
        const rows = await this.api.all<Transaction>(
          '/transactions' + (contact ? '?contact_id=' + contact : ''),
        );
        this.choices.set(
          rows.filter(
            (t) =>
              t.transaction_type !== 'PERSONAL_EXPENSE' &&
              t.status !== 'CANCELLED' &&
              units(t.outstanding_amount) > 0n,
          ),
        );
      }
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
  async choose(id: number | null) {
    this.selected = id;
    this.transaction.set(null);
    if (id) {
      try {
        this.transaction.set(await this.api.get<Transaction>(`/transactions/${id}`));
      } catch (e) {
        this.error.set(errorMessage(e));
      }
    }
  }
  async save() {
    const t = this.transaction();
    if (!t || this.form.invalid) return;
    const v = this.form.getRawValue();
    if (units(v.amount!) <= 0n || units(v.amount!) > units(t.outstanding_amount)) {
      this.error.set('Enter an amount greater than zero and no more than the outstanding balance.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.send('POST', `/transactions/${t.id}/settlements`, {
        ...v,
        currency: t.currency,
        reference_number: v.reference_number || null,
        notes: v.notes || null,
      });
      this.toast.show('Repayment recorded');
      await this.router.navigate(['/transactions', t.id]);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}

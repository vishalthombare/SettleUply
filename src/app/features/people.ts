import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, FormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, errorMessage, Toast } from '../core/api';
import { Contact, Page, Ledger } from '../core/models';
import {
  StateComponent,
  PaginationComponent,
  BalancesComponent,
  ActivityListComponent,
  MoneyPipe,
} from '../shared/ui';

@Component({
  standalone: true,
  imports: [RouterLink, FormsModule, StateComponent, PaginationComponent, MoneyPipe],
  template: ` <div class="page-heading">
      <div>
        <span class="eyebrow">MONEY BETWEEN PEOPLE</span>
        <h1>Your people.</h1>
        <p>Good relationships start with a little clarity.</p>
      </div>
      <a class="button primary" routerLink="/people/new">+ Add person</a>
    </div>
    <div class="toolbar">
      <input
        class="search"
        [(ngModel)]="search"
        (keyup.enter)="load(1)"
        placeholder="Search people…"
        aria-label="Search people"
      /><button class="secondary" (click)="load(1)">Search</button
      ><select [(ngModel)]="filter" (change)="load(1)" aria-label="Balance filter">
        <option value="">All people</option>
        <option value="owes_me">Owes me</option>
        <option value="i_owe">I owe</option>
        <option value="settled">Balanced</option>
        <option value="overdue">Overdue</option>
      </select>
    </div>
    @if (loading() || error()) {
      <app-state [loading]="loading()" [error]="error()" (retry)="load()" />
    } @else {
      <div class="people-grid">
        @for (p of data()?.items; track p.id) {
          <a class="person-card" [routerLink]="['/people', p.id]"
            ><span class="avatar large">{{ p.name.slice(0, 1) }}</span
            ><span class="card-arrow">↗</span>
            <h2>{{ p.name }}</h2>
            <p class="muted">{{ p.email || p.phone || 'Your contact' }}</p>
            <div class="person-balances">
              @for (b of p.balances || []; track b.currency + b.direction) {
                <div>
                  <small>{{ b.direction === 'receivable' ? 'You’ll receive' : 'You owe' }}</small
                  ><strong
                    [class.amount-receivable]="b.direction === 'receivable'"
                    [class.amount-payable]="b.direction === 'payable'"
                    >{{ b.amount | money: b.currency }}</strong
                  >
                </div>
              } @empty {
                <small class="muted">No net outstanding</small>
              }
            </div></a
          >
        } @empty {
          <app-state
            title="Room for your people"
            message="Add a contact to start a shared money history."
          />
        }
      </div>
      <app-pagination
        [page]="data()?.page || 1"
        [totalPages]="data()?.total_pages || 0"
        (change)="load($event)"
      />
    }`,
})
export class PeoplePage {
  private api = inject(Api);
  search = '';
  filter = '';
  data = signal<Page<
    Contact & { balances?: { currency: string; direction: string; amount: string }[] }
  > | null>(null);
  loading = signal(true);
  error = signal('');
  constructor() {
    void this.load();
  }
  async load(page = 1) {
    this.loading.set(true);
    this.error.set('');
    try {
      this.data.set(
        await this.api.get('/contacts', { page, search: this.search, balance_filter: this.filter }),
      );
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
}

@Component({
  standalone: true,
  imports: [
    RouterLink,
    StateComponent,
    PaginationComponent,
    BalancesComponent,
    ActivityListComponent,
  ],
  template: ` @if (data(); as d) {
      <a class="back-link" routerLink="/people">← Your people</a>
      <div class="page-heading">
        <div class="identity-heading">
          <span class="avatar large">{{ d.contact.name.slice(0, 1) }}</span>
          <div>
            <h1>{{ d.contact.name }}</h1>
            <p>
              {{ d.contact.email || d.contact.phone || 'Your shared history, all in one place.' }}
            </p>
          </div>
        </div>
        <a class="button secondary" [routerLink]="['/people', id, 'edit']">Edit person</a>
      </div>
      <div class="balance-grid two">
        <app-balances
          label="YOU’LL RECEIVE"
          [values]="d.receivables"
          tone="receivable"
        /><app-balances label="YOU OWE" [values]="d.payables" tone="payable" />
      </div>
      <p class="muted">
        Net outstanding per currency. Individual loan records remain in your history.
      </p>
      <div class="quick-strip">
        <a routerLink="/transactions/new" [queryParams]="{ type: 'MONEY_LENT', contact: id }"
          >↗ Give money</a
        ><a routerLink="/transactions/new" [queryParams]="{ type: 'MONEY_BORROWED', contact: id }"
          >↙ Borrow money</a
        ><a routerLink="/settlements/new" [queryParams]="{ contact: id, direction: 'receive' }"
          >✓ Receive repayment</a
        >
        <a routerLink="/settlements/new" [queryParams]="{ contact: id, direction: 'pay' }"
          >✓ Repay this person</a
        >
      </div>
      <section class="panel">
        <div class="section-heading"><h2>Your shared history</h2></div>
        <app-activity-list [items]="d.history.items" /><app-pagination
          [page]="d.history.page"
          [totalPages]="d.history.total_pages"
          (change)="load($event)"
        />
      </section>
      @if (d.contact.notes) {
        <p class="note">{{ d.contact.notes }}</p>
      }
      <button class="text-button danger" (click)="archive()">Archive person</button>
    }
    @if (loading() || error()) {
      <app-state [loading]="loading()" [error]="error()" (retry)="load()" />
    }`,
})
export class PersonPage {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  id = Number(this.route.snapshot.paramMap.get('id'));
  data = signal<Ledger | null>(null);
  loading = signal(true);
  error = signal('');
  constructor() {
    void this.load();
  }
  async load(page = 1) {
    this.loading.set(true);
    this.error.set('');
    try {
      this.data.set(await this.api.get<Ledger>(`/contacts/${this.id}/ledger`, { page }));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
  async archive() {
    if (!confirm('Archive this person? Their financial history will be retained.')) return;
    try {
      await this.api.send('DELETE', `/contacts/${this.id}`);
      await this.router.navigateByUrl('/people');
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  template: `<a class="back-link" routerLink="/people">← Your people</a>
    <div class="page-heading">
      <div>
        <span class="eyebrow">YOUR CIRCLE</span>
        <h1>{{ id ? 'Edit person.' : 'Someone to remember.' }}</h1>
        <p>They don’t need a SettleUply account.</p>
      </div>
    </div>
    <form class="panel form-panel" [formGroup]="form" (ngSubmit)="save()">
      <label>Name<input formControlName="name" required /></label>
      <div class="form-grid">
        <label>Email<input type="email" formControlName="email" /></label
        ><label>Phone<input type="tel" formControlName="phone" /></label
        ><label>Country code<input formControlName="country_code" placeholder="+60" /></label
        ><label
          >Preferred currency<select formControlName="preferred_currency">
            <option value="">Use my default</option>
            @for (c of currencies(); track c) {
              <option [value]="c">{{ c }}</option>
            }
          </select></label
        >
      </div>
      <label>Notes<textarea formControlName="notes" rows="3"></textarea></label>
      @if (error()) {
        <p class="form-error" role="alert">{{ error() }}</p>
      }
      <div class="form-actions">
        <a routerLink="/people" class="button secondary">Cancel</a
        ><button class="primary" [disabled]="busy() || form.invalid">
          {{ busy() ? 'Saving…' : 'Save person' }}
        </button>
      </div>
    </form>`,
})
export class ContactForm {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private toast = inject(Toast);
  private fb = inject(FormBuilder);
  id = Number(this.route.snapshot.paramMap.get('id')) || null;
  busy = signal(false);
  error = signal('');
  currencies = signal<string[]>([]);
  form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    email: ['', Validators.email],
    phone: [''],
    country_code: [''],
    preferred_currency: [''],
    notes: [''],
    is_active: [true],
  });
  constructor() {
    void this.load();
  }
  async load() {
    try {
      this.currencies.set(Object.keys(await this.api.get<Record<string, number>>('/currencies')));
      if (this.id) {
        const c = await this.api.get<Contact>(`/contacts/${this.id}`);
        this.form.patchValue({
          ...c,
          email: c.email || '',
          phone: c.phone || '',
          country_code: c.country_code || '',
          preferred_currency: c.preferred_currency || '',
          notes: c.notes || '',
        });
      }
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
  async save() {
    if (this.form.invalid) return;
    this.busy.set(true);
    try {
      const v = this.form.getRawValue();
      const result = await this.api.send<Contact>(
        this.id ? 'PATCH' : 'POST',
        `/contacts${this.id ? '/' + this.id : ''}`,
        {
          ...v,
          email: v.email || null,
          phone: v.phone || null,
          country_code: v.country_code || null,
          preferred_currency: v.preferred_currency || null,
          notes: v.notes || null,
        },
      );
      this.toast.show('Person saved');
      await this.router.navigate(['/people', result.id]);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}

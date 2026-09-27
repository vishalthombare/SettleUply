import { Component, inject, signal, OnDestroy } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators, FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { debounceTime, Subscription } from 'rxjs';
import { Api, errorMessage, Toast } from '../core/api';
import { Auth } from '../core/auth';
import { Preferences } from '../core/preferences';
import { Group, GroupExpense, Member, Catalog, Split } from '../core/models';
import { MoneyPipe, LocalDatePipe, PrettyPipe } from '../shared/ui';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, FormsModule, RouterLink, MoneyPipe],
  template: ` <a class="back-link" [routerLink]="['/groups', groupId]">← Back to group</a>
    <div class="page-heading">
      <div>
        <span class="eyebrow">SHARE THE MOMENT, SPLIT THE COST</span>
        <h1>{{ id ? 'Edit shared expense.' : 'Something shared.' }}</h1>
      </div>
    </div>
    <form class="panel form-panel" [formGroup]="form" (ngSubmit)="save()">
      <label
        >Title<input formControlName="title" placeholder="Dinner, a place to stay, the journey…"
      /></label>
      <div class="form-grid">
        <label
          >Amount<input
            class="money-field"
            inputmode="decimal"
            formControlName="amount"
            placeholder="0.00" /></label
        ><label
          >Currency<select formControlName="currency">
            @for (c of currencies(); track c) {
              <option [value]="c">{{ c }}</option>
            }
          </select></label
        ><label
          >Paid by<select formControlName="paid_by_member_id">
            <option [ngValue]="null">Choose payer</option>
            @for (m of members(); track m.id) {
              <option [ngValue]="m.id">{{ m.display_name }}</option>
            }
          </select></label
        ><label>Date<input type="date" formControlName="expense_date" /></label
        ><label
          >Category<select formControlName="category_id">
            <option [ngValue]="null">No category</option>
            @for (c of categories(); track c.id) {
              <option [ngValue]="c.id">{{ c.name }}</option>
            }
          </select></label
        ><label
          >Payment method<select formControlName="payment_method_id">
            <option [ngValue]="null">Not specified</option>
            @for (m of methods(); track m.id) {
              <option [ngValue]="m.id">{{ m.name }}</option>
            }
          </select></label
        >
      </div>
      <label>Description<textarea formControlName="description" rows="2"></textarea></label>
      <fieldset>
        <legend>How are we splitting it?</legend>
        <div class="segmented">
          <button
            type="button"
            [class.selected]="form.controls.split_type.value === 'EQUAL'"
            (click)="form.controls.split_type.setValue('EQUAL')"
          >
            Equally</button
          ><button
            type="button"
            [class.selected]="form.controls.split_type.value === 'EXACT'"
            (click)="form.controls.split_type.setValue('EXACT')"
          >
            Exact amounts
          </button>
        </div>
        @for (m of members(); track m.id) {
          <div class="split-row">
            <label class="toggle"
              ><input
                type="checkbox"
                [ngModel]="selected[m.id]"
                (ngModelChange)="selected[m.id] = $event; schedulePreview()"
                [ngModelOptions]="{ standalone: true }"
              />{{ m.display_name }}</label
            >
            @if (selected[m.id] && form.controls.split_type.value === 'EXACT') {
              <input
                class="share-input"
                inputmode="decimal"
                [ngModel]="shares[m.id]"
                (ngModelChange)="shares[m.id] = $event; schedulePreview()"
                [ngModelOptions]="{ standalone: true }"
                [attr.aria-label]="m.display_name + ' share'"
                placeholder="0.00"
              />
            } @else if (selected[m.id]) {
              <strong>{{ previewAmount(m.id) | money: form.controls.currency.value! }}</strong>
            }
          </div>
        }
        <p class="muted">
          Rounding is assigned deterministically. Your shares always add up to the full amount.
        </p>
        @if (previewError()) {
          <p class="form-error">{{ previewError() }}</p>
        }
        @if (previewing()) {
          <p class="muted" role="status">Calculating shares…</p>
        }
      </fieldset>
      @if (error()) {
        <p class="form-error" role="alert">{{ error() }}</p>
      }
      <div class="form-actions">
        <a class="button secondary" [routerLink]="['/groups', groupId]">Cancel</a
        ><button class="primary" [disabled]="busy() || form.invalid || !ready()">
          {{ busy() ? 'Saving…' : 'Save shared expense' }}
        </button>
      </div>
    </form>`,
})
export class GroupExpenseForm implements OnDestroy {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private toast = inject(Toast);
  private preferences = inject(Preferences);
  private fb = inject(FormBuilder);
  groupId = Number(this.route.snapshot.paramMap.get('groupId'));
  id = Number(this.route.snapshot.paramMap.get('expenseId')) || null;
  members = signal<Member[]>([]);
  categories = signal<Catalog[]>([]);
  methods = signal<Catalog[]>([]);
  currencies = signal<string[]>([]);
  selected: Record<number, boolean> = {};
  shares: Record<number, string> = {};
  preview = signal<Split[]>([]);
  previewError = signal('');
  previewing = signal(false);
  busy = signal(false);
  ready = signal(false);
  error = signal('');
  private version = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private subscription: Subscription;
  form = this.fb.group({
    title: ['', Validators.required],
    amount: ['', [Validators.required, Validators.pattern(/^\d+(\.\d{1,4})?$/)]],
    currency: [this.preferences.currency(), Validators.required],
    paid_by_member_id: [null as number | null, Validators.required],
    expense_date: [this.preferences.today(), Validators.required],
    category_id: [null as number | null],
    payment_method_id: [null as number | null],
    description: [''],
    split_type: ['EQUAL'],
  });
  constructor() {
    this.subscription = this.form.valueChanges.pipe(debounceTime(400)).subscribe(() => {
      void this.calculate();
    });
    void this.load();
  }
  ngOnDestroy() {
    this.subscription.unsubscribe();
    clearTimeout(this.timer);
    this.version++;
  }
  previewAmount(id: number) {
    return this.preview().find((s) => s.group_member_id === id)?.share_amount;
  }
  schedulePreview() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.calculate();
    }, 400);
  }
  body() {
    const v = this.form.getRawValue();
    return {
      ...v,
      description: v.description || null,
      splits: this.members()
        .filter((m) => this.selected[m.id])
        .map((m) => ({
          group_member_id: m.id,
          share_amount: v.split_type === 'EXACT' ? this.shares[m.id] || '0' : null,
        })),
    };
  }
  async load() {
    try {
      const [g, members, categories, methods, currencies] = await Promise.all([
        this.api.get<Group>(`/groups/${this.groupId}`),
        this.api.all<Member>(`/groups/${this.groupId}/members`),
        this.api.all<Catalog>('/categories'),
        this.api.all<Catalog>('/payment-methods'),
        this.api.get<Record<string, number>>('/currencies'),
      ]);
      this.members.set(members.filter((m) => m.is_active));
      this.categories.set(categories);
      this.methods.set(methods);
      this.currencies.set(Object.keys(currencies));
      this.form.controls.currency.setValue(g.default_currency || this.preferences.currency());
      for (const m of this.members()) this.selected[m.id] = true;
      if (this.id) {
        const e = await this.api.get<GroupExpense>(`/groups/${this.groupId}/expenses/${this.id}`);
        this.form.patchValue({ ...e, description: e.description || '' });
        for (const m of this.members()) {
          const s = e.splits.find((s) => s.group_member_id === m.id);
          this.selected[m.id] = !!s;
          this.shares[m.id] = s?.share_amount || '0';
        }
      }
      this.ready.set(true);
      await this.calculate();
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
  async calculate() {
    const version = ++this.version;
    this.preview.set([]);
    this.previewError.set('');
    if (!this.ready() || this.form.invalid) return;
    this.previewing.set(true);
    try {
      const result = await this.api.send<Split[]>(
        'POST',
        `/groups/${this.groupId}/expenses/preview`,
        this.body(),
      );
      if (version === this.version) this.preview.set(result);
    } catch (e) {
      if (version === this.version) this.previewError.set(errorMessage(e));
    } finally {
      if (version === this.version) this.previewing.set(false);
    }
  }
  async save() {
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const result = await this.api.send<GroupExpense>(
        this.id ? 'PATCH' : 'POST',
        `/groups/${this.groupId}/expenses${this.id ? '/' + this.id : ''}`,
        this.body(),
      );
      this.toast.show('Shared expense saved');
      await this.router.navigate(['/groups', this.groupId, 'expenses', result.id]);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}

@Component({
  standalone: true,
  imports: [RouterLink, MoneyPipe, PrettyPipe, LocalDatePipe],
  template: `<a class="back-link" [routerLink]="['/groups', groupId]">← Back to group</a>
    @if (expense(); as e) {
      <div class="page-heading">
        <div>
          <span class="eyebrow">SHARED EXPENSE</span>
          <h1>{{ e.title }}</h1>
          <p>Paid by {{ name(e.paid_by_member_id) }} · {{ e.expense_date | localDate }}</p>
        </div>
        @if (owner()) {
          <a class="button secondary" [routerLink]="['/groups', groupId, 'expenses', id, 'edit']"
            >Edit expense</a
          >
        }
      </div>
      <section class="panel detail-panel">
        <div class="detail-money">{{ e.amount | money: e.currency }}</div>
        <p>{{ e.description }}</p>
        <span class="pill">{{ e.split_type | pretty }} split</span>
        @for (s of e.splits; track s.group_member_id) {
          <div class="record">
            <span class="avatar">{{ name(s.group_member_id).slice(0, 1) }}</span
            ><span class="record-main"
              ><strong>{{ name(s.group_member_id) }}</strong
              ><small>{{
                s.group_member_id === e.paid_by_member_id ? 'Payer’s own share' : 'Share of expense'
              }}</small></span
            ><strong>{{ s.share_amount | money: e.currency }}</strong>
          </div>
        }
      </section>
      @if (owner()) {
        <button class="text-button danger" (click)="remove()">Delete shared expense</button>
      }
    }
    @if (error()) {
      <p class="form-error" role="alert">{{ error() }}</p>
    }`,
})
export class GroupExpensePage {
  private api = inject(Api);
  private auth = inject(Auth);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  groupId = Number(this.route.snapshot.paramMap.get('groupId'));
  id = Number(this.route.snapshot.paramMap.get('expenseId'));
  expense = signal<GroupExpense | null>(null);
  members = signal<Member[]>([]);
  group = signal<Group | null>(null);
  error = signal('');
  constructor() {
    void this.load();
  }
  name(id: number) {
    return this.members().find((m) => m.id === id)?.display_name || 'Member';
  }
  owner() {
    return this.group()?.owner_user_id === this.auth.user()?.id;
  }
  async load() {
    try {
      const [e, m, g] = await Promise.all([
        this.api.get<GroupExpense>(`/groups/${this.groupId}/expenses/${this.id}`),
        this.api.all<Member>(`/groups/${this.groupId}/members`),
        this.api.get<Group>(`/groups/${this.groupId}`),
      ]);
      this.expense.set(e);
      this.members.set(m);
      this.group.set(g);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
  async remove() {
    if (!confirm('Delete this shared expense? It will no longer affect group balances.')) return;
    try {
      await this.api.send('DELETE', `/groups/${this.groupId}/expenses/${this.id}`);
      await this.router.navigate(['/groups', this.groupId]);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}

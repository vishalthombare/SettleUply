import { Component, inject, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, errorMessage, Toast } from '../core/api';
import { Auth } from '../core/auth';
import { Preferences } from '../core/preferences';
import { Group, Member, GroupExpense, Contact, Catalog, Split, Page } from '../core/models';
import {
  StateComponent,
  PaginationComponent,
  MoneyPipe,
  LocalDatePipe,
  PrettyPipe,
} from '../shared/ui';

@Component({
  standalone: true,
  imports: [RouterLink, FormsModule, StateComponent, PaginationComponent],
  template: `<div class="page-heading">
      <div>
        <span class="eyebrow">BETTER TOGETHER</span>
        <h1>Shared moments.<br />Simple splits.</h1>
        <p>Trips, dinners, and the everyday things.</p>
      </div>
      <a class="button primary" routerLink="/groups/new">+ Create group</a>
    </div>
    @if (addingExpense) {
      <p class="note">Choose a group below, then select “Add expense”.</p>
    }
    <div class="toolbar">
      <input
        class="search"
        [(ngModel)]="search"
        (keyup.enter)="load(1)"
        placeholder="Find a group…"
        aria-label="Search groups"
      /><button class="secondary" (click)="load(1)">Search</button>
    </div>
    @if (loading() || error()) {
      <app-state [loading]="loading()" [error]="error()" (retry)="load()" />
    } @else {
      <div class="groups-grid">
        @for (g of data()?.items; track g.id; let i = $index) {
          <a class="group-card" [routerLink]="['/groups', g.id]"
            ><div class="group-art" [class.peach]="i % 2 === 1">
              <span>{{ i % 2 === 0 ? '◎' : '✳' }}</span
              ><small>{{ g.default_currency || 'MULTI-CURRENCY' }}</small>
            </div>
            <div class="group-info">
              <h2>{{ g.name }} <span>↗</span></h2>
              <p>{{ g.member_count }} members <span>·</span> {{ g.expense_count }} expenses</p>
              <small>{{ g.description || 'A little shared history.' }}</small>
            </div></a
          >
        } @empty {
          <app-state title="Make a little group" message="Bring your shared expenses together." />
        }
      </div>
      <app-pagination
        [page]="data()?.page || 1"
        [totalPages]="data()?.total_pages || 0"
        (change)="load($event)"
      />
    }`,
})
export class GroupsPage {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  addingExpense = this.route.snapshot.queryParamMap.has('addExpense');
  search = '';
  data = signal<Page<Group> | null>(null);
  loading = signal(true);
  error = signal('');
  constructor() {
    void this.load();
  }
  async load(page = 1) {
    this.loading.set(true);
    this.error.set('');
    try {
      this.data.set(await this.api.get('/groups', { page, search: this.search }));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
}

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  template: `<a class="back-link" routerLink="/groups">← Groups</a>
    <div class="page-heading">
      <div>
        <span class="eyebrow">A SPACE FOR YOUR PEOPLE</span>
        <h1>{{ id ? 'Edit your group.' : 'Start something shared.' }}</h1>
      </div>
    </div>
    <form class="panel form-panel" [formGroup]="form" (ngSubmit)="save()">
      <label
        >Group name<input
          formControlName="name"
          placeholder="Malaysia trip, home expenses…" /></label
      ><label>Description<textarea formControlName="description" rows="3"></textarea></label
      ><label
        >Default currency<select formControlName="default_currency">
          @for (c of currencies(); track c) {
            <option [value]="c">{{ c }}</option>
          }
        </select></label
      >
      @if (error()) {
        <p class="form-error" role="alert">{{ error() }}</p>
      }
      <div class="form-actions">
        <button class="primary" [disabled]="busy() || form.invalid">Save group</button>
      </div>
    </form>`,
})
export class GroupForm {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private preferences = inject(Preferences);
  private fb = inject(FormBuilder);
  id = Number(this.route.snapshot.paramMap.get('id')) || null;
  currencies = signal<string[]>([]);
  busy = signal(false);
  error = signal('');
  form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    description: [''],
    default_currency: [this.preferences.currency()],
    is_active: [true],
  });
  constructor() {
    void this.load();
  }
  async load() {
    try {
      this.currencies.set(Object.keys(await this.api.get<Record<string, number>>('/currencies')));
      if (this.id) {
        const g = await this.api.get<Group>(`/groups/${this.id}`);
        this.form.patchValue({
          ...g,
          description: g.description || '',
          default_currency: g.default_currency || this.preferences.currency(),
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
      const g = await this.api.send<Group>(
        this.id ? 'PATCH' : 'POST',
        `/groups${this.id ? '/' + this.id : ''}`,
        this.form.getRawValue(),
      );
      await this.router.navigate(['/groups', g.id]);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}

@Component({
  standalone: true,
  imports: [
    RouterLink,
    FormsModule,
    ReactiveFormsModule,
    MoneyPipe,
    LocalDatePipe,
    PrettyPipe,
    StateComponent,
    PaginationComponent,
  ],
  template: ` <a class="back-link" routerLink="/groups">← Your groups</a>
    @if (group(); as g) {
      <div class="page-heading">
        <div>
          <span class="eyebrow">BETTER TOGETHER</span>
          <h1>{{ g.name }}</h1>
          <p>{{ g.description || 'Your shared expenses, kept simple.' }}</p>
        </div>
        @if (owner()) {
          <a class="button primary" [routerLink]="['/groups', id, 'expenses', 'new']"
            >+ Add expense</a
          >
        }
      </div>
      <div class="tabs">
        @for (tab of tabs; track tab) {
          <button [class.active]="activeTab() === tab" (click)="activeTab.set(tab)">
            {{ tab }}
          </button>
        }
      </div>
      @if (activeTab() === 'Overview') {
        <div class="overview-numbers">
          <div>
            <strong>{{ members().length }}</strong
            ><span>People together</span>
          </div>
          <div>
            <strong>{{ expenses()?.total || 0 }}</strong
            ><span>Shared expenses</span>
          </div>
          <div>
            <strong>{{ g.default_currency || '—' }}</strong
            ><span>Default currency</span>
          </div>
        </div>
        <section class="panel">
          <div class="section-heading"><h2>Latest shared expenses</h2></div>
          @for (e of expenses()?.items; track e.id) {
            <a class="record" [routerLink]="['/groups', id, 'expenses', e.id]"
              ><span class="record-icon">◎</span
              ><span class="record-main"
                ><strong>{{ e.title }}</strong
                ><small
                  >{{ memberName(e.paid_by_member_id) }} paid ·
                  {{ e.expense_date | localDate }}</small
                ></span
              ><strong>{{ e.amount | money: e.currency }}</strong></a
            >
          } @empty {
            <app-state
              title="Your first shared moment"
              message="Add an expense to see everyone’s share."
            />
          }
        </section>
      }
      @if (activeTab() === 'Expenses') {
        <section class="panel">
          @for (e of expenses()?.items; track e.id) {
            <a class="record" [routerLink]="['/groups', id, 'expenses', e.id]"
              ><span class="record-icon">◎</span
              ><span class="record-main"
                ><strong>{{ e.title }}</strong
                ><small
                  >{{ memberName(e.paid_by_member_id) }} paid ·
                  {{ e.split_type | pretty }} split</small
                ></span
              ><strong>{{ e.amount | money: e.currency }}</strong></a
            >
          } @empty {
            <app-state title="No expenses yet" />
          }
          <app-pagination
            [page]="expenses()?.page || 1"
            [totalPages]="expenses()?.total_pages || 0"
            (change)="loadExpenses($event)"
          />
        </section>
      }
      @if (activeTab() === 'Members') {
        <section class="panel">
          <div class="section-heading">
            <h2>The people in this group</h2>
            @if (owner()) {
              <button class="secondary" (click)="editMember(null)">+ Add member</button>
            }
          </div>
          @for (m of members(); track m.id) {
            <div class="record">
              <span class="avatar">{{ m.display_name.slice(0, 1) }}</span
              ><span class="record-main"
                ><strong>{{ m.display_name }}</strong
                ><small>{{
                  m.is_active
                    ? m.user_id
                      ? 'Registered member'
                      : 'Guest member'
                    : 'Archived · history retained'
                }}</small></span
              >
              @if (owner() && m.user_id !== g.owner_user_id) {
                <button class="text-button" (click)="editMember(m)">Edit</button>
                @if (m.is_active) {
                  <button class="text-button danger" (click)="removeMember(m)">Archive</button>
                }
              }
            </div>
          }
        </section>
      }
      @if (activeTab() === 'Balances') {
        <p class="note">
          Positive amounts are owed to the member. Negative amounts are what the member owes. Each
          currency stays separate.
        </p>
        @for (entry of balanceEntries(); track entry[0]) {
          <section class="panel">
            <div class="section-heading">
              <h2>{{ entry[0] }}</h2>
            </div>
            @for (b of memberBalances(entry[1]); track b[0]) {
              <div class="record">
                <span class="record-main"
                  ><strong>{{ memberName(+b[0]) }}</strong
                  ><small>{{ b[1].startsWith('-') ? 'Owes' : 'Will receive' }}</small></span
                ><strong>{{ b[1] | money: entry[0] }}</strong>
              </div>
            }
          </section>
        } @empty {
          <app-state title="All clear" message="Balances appear when you add shared expenses." />
        }
      }
      @if (owner()) {
        <div class="form-actions">
          <a class="button secondary" [routerLink]="['/groups', id, 'edit']">Edit group</a
          ><button class="text-button danger" (click)="archive()">Archive group</button>
        </div>
      }
    }
    @if (error()) {
      <p class="form-error" role="alert">{{ error() }}</p>
    }
    @if (showMember()) {
      <div class="modal-backdrop">
        <section class="action-sheet" role="dialog" aria-modal="true" aria-label="Group member">
          <div class="section-heading">
            <h2>{{ memberId ? 'Edit member' : 'Add a member' }}</h2>
            <button class="icon-button" aria-label="Close" (click)="showMember.set(false)">
              ×
            </button>
          </div>
          <form [formGroup]="memberForm" (ngSubmit)="saveMember()">
            <label>Display name<input formControlName="display_name" /></label>
            @if (!memberId) {
              <label
                >Existing contact<select formControlName="contact_id">
                  <option [ngValue]="null">Manual or registered person</option>
                  @for (c of contacts(); track c.id) {
                    <option [ngValue]="c.id">{{ c.name }}</option>
                  }
                </select></label
              ><label
                >Registered account email <small>(optional)</small
                ><input formControlName="registered_email" type="email"
              /></label>
            }
            <label>Email<input formControlName="email" type="email" /></label
            ><label>Phone<input formControlName="phone" /></label
            ><label class="toggle"
              ><input type="checkbox" formControlName="is_active" />Active member</label
            >
            @if (memberError()) {
              <p class="form-error" role="alert">{{ memberError() }}</p>
            }
            <button class="primary full" [disabled]="busy() || memberForm.invalid">
              Save member
            </button>
          </form>
        </section>
      </div>
    }`,
})
export class GroupPage {
  private api = inject(Api);
  private auth = inject(Auth);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  id = Number(this.route.snapshot.paramMap.get('id'));
  group = signal<Group | null>(null);
  members = signal<Member[]>([]);
  expenses = signal<Page<GroupExpense> | null>(null);
  balances = signal<Record<string, Record<string, string>>>({});
  contacts = signal<Contact[]>([]);
  error = signal('');
  memberError = signal('');
  busy = signal(false);
  showMember = signal(false);
  memberId: number | null = null;
  activeTab = signal('Overview');
  tabs = ['Overview', 'Members', 'Expenses', 'Balances'];
  memberForm = this.fb.group({
    display_name: ['', Validators.required],
    contact_id: [null as number | null],
    registered_email: [''],
    email: [''],
    phone: [''],
    is_active: [true],
  });
  constructor() {
    void this.load();
  }
  owner() {
    return this.group()?.owner_user_id === this.auth.user()?.id;
  }
  memberName(id: number) {
    return this.members().find((m) => m.id === id)?.display_name || 'Member';
  }
  balanceEntries() {
    return Object.entries(this.balances());
  }
  memberBalances(value: Record<string, string>) {
    return Object.entries(value);
  }
  async load() {
    this.error.set('');
    try {
      const [g, m, b] = await Promise.all([
        this.api.get<Group>(`/groups/${this.id}`),
        this.api.all<Member>(`/groups/${this.id}/members`),
        this.api.get<Record<string, Record<string, string>>>(`/groups/${this.id}/balances`),
      ]);
      this.group.set(g);
      this.members.set(m);
      this.balances.set(b);
      await this.loadExpenses();
      if (this.owner()) this.contacts.set(await this.api.all<Contact>('/contacts'));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
  async loadExpenses(page = 1) {
    try {
      this.expenses.set(await this.api.get(`/groups/${this.id}/expenses`, { page }));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
  editMember(member: Member | null) {
    this.memberId = member?.id || null;
    this.memberError.set('');
    this.memberForm.reset({
      display_name: member?.display_name || '',
      contact_id: member?.contact_id || null,
      registered_email: '',
      email: member?.email || '',
      phone: member?.phone || '',
      is_active: member?.is_active ?? true,
    });
    this.showMember.set(true);
  }
  async saveMember() {
    if (this.memberForm.invalid) return;
    this.busy.set(true);
    try {
      const v = this.memberForm.getRawValue();
      await this.api.send(
        this.memberId ? 'PATCH' : 'POST',
        `/groups/${this.id}/members${this.memberId ? '/' + this.memberId : ''}`,
        {
          ...v,
          registered_email: v.registered_email || null,
          email: v.email || null,
          phone: v.phone || null,
        },
      );
      this.showMember.set(false);
      await this.load();
    } catch (e) {
      this.memberError.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
  async removeMember(m: Member) {
    if (!confirm(`Archive ${m.display_name}? Their history will remain.`)) return;
    try {
      await this.api.send('DELETE', `/groups/${this.id}/members/${m.id}`);
      await this.load();
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
  async archive() {
    if (!confirm('Archive this group and retain its financial history?')) return;
    try {
      await this.api.send('DELETE', `/groups/${this.id}`);
      await this.router.navigateByUrl('/groups');
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}

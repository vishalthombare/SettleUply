import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../core/api';
import { Auth } from '../core/auth';
import { Dashboard } from '../core/models';
import { NetBalanceComponent } from '../shared/net-balance';
import {
  BalancesComponent,
  StateComponent,
  ActivityListComponent,
  MoneyPipe,
  LocalDatePipe,
} from '../shared/ui';

@Component({
  standalone: true,
  imports: [
    RouterLink,
    BalancesComponent,
    NetBalanceComponent,
    StateComponent,
    ActivityListComponent,
    MoneyPipe,
    LocalDatePipe,
  ],
  template: ` <div class="page-heading">
      <div>
        <span class="eyebrow">YOUR MONEY AT A GLANCE</span>
        <h1>Good {{ greeting }}, {{ firstName }} <span class="wave">✳</span></h1>
        <p>A clear view. A lighter mind.</p>
      </div>
      <a class="button secondary" routerLink="/activity">View activity ↗</a>
    </div>
    @if (data(); as d) {
      <div class="balance-grid dashboard-balances">
        <app-net-balance [values]="d.net_balances" />
        <app-balances label="↗  YOU’LL RECEIVE" [values]="d.receivables" tone="receivable" />
        <app-balances label="↙  YOU OWE" [values]="d.payables" tone="payable" />
      </div>
      <app-balances
        class="monthly-spending"
        label="THIS MONTH SPENT"
        [values]="d.personal_expenses_this_month"
        [compact]="true"
      />
      <div class="quick-strip">
        <span>Keep things up to date</span
        ><a routerLink="/transactions/new" [queryParams]="{ type: 'PERSONAL_EXPENSE' }"
          >− Add expense</a
        ><a routerLink="/transactions/new" [queryParams]="{ type: 'MONEY_LENT' }">↗ Give money</a
        ><a routerLink="/settlements/new">✓ Settle up</a>
      </div>
      <div class="dashboard-grid">
        <section class="panel">
          <div class="section-heading">
            <h2>Recent activity</h2>
            <a routerLink="/activity">See all →</a>
          </div>
          <app-activity-list [items]="d.recent_activity" />
        </section>
        <section class="panel due-panel">
          <div class="section-heading">
            <h2>On the horizon</h2>
            <span class="pill">Next 7 days</span>
          </div>
          @for (t of d.overdue; track t.id) {
            <a class="due-item" [routerLink]="['/transactions', t.id]"
              ><span class="due-dot overdue"></span>
              <div>
                <strong>{{ t.purpose }}</strong
                ><small class="danger">Overdue · {{ t.due_date | localDate }}</small>
              </div>
              <strong
                [class.amount-receivable]="t.transaction_type === 'MONEY_LENT'"
                [class.amount-payable]="t.transaction_type === 'MONEY_BORROWED'"
                >{{ t.outstanding_amount | money: t.currency }}</strong
              ></a
            >
          }
          @for (t of d.due_soon; track t.id) {
            <a class="due-item" [routerLink]="['/transactions', t.id]"
              ><span class="due-dot"></span>
              <div>
                <strong>{{ t.purpose }}</strong
                ><small>{{ t.due_date | localDate }}</small>
              </div>
              <strong
                [class.amount-receivable]="t.transaction_type === 'MONEY_LENT'"
                [class.amount-payable]="t.transaction_type === 'MONEY_BORROWED'"
                >{{ t.outstanding_amount | money: t.currency }}</strong
              ></a
            >
          }
          @if (!d.overdue.length && !d.due_soon.length) {
            <app-state
              title="Nothing coming due"
              message="A little breathing room for your week."
            />
          }
          <a class="panel-link" routerLink="/reminders">Manage reminders →</a>
        </section>
        <section class="panel">
          <div class="section-heading">
            <h2>People & balances</h2>
            <a routerLink="/people">All people →</a>
          </div>
          @for (
            person of d.people_balances;
            track person.contact_id + person.currency + person.transaction_type
          ) {
            <a class="record" [routerLink]="['/people', person.contact_id]"
              ><span class="avatar">{{ person.name.slice(0, 1) }}</span
              ><span class="record-main"
                ><strong>{{ person.name }}</strong
                ><small>{{
                  person.transaction_type === 'MONEY_LENT' ? 'You’ll receive' : 'You owe'
                }}</small></span
              ><strong
                [class.amount-receivable]="person.transaction_type === 'MONEY_LENT'"
                [class.amount-payable]="person.transaction_type === 'MONEY_BORROWED'"
                >{{ person.amount | money: person.currency }}</strong
              ></a
            >
          } @empty {
            <app-state
              title="Start with a person"
              message="Add someone to keep your shared money clear."
            />
          }
        </section>
        <section class="panel">
          <div class="section-heading">
            <h2>Together, in balance</h2>
            <a routerLink="/groups">Groups →</a>
          </div>
          <app-activity-list [items]="d.group_activity" />
          <div class="gentle-note">
            Shared moments.<br /><strong>Simply split.</strong
            ><a routerLink="/groups/new">Create a group ↗</a>
          </div>
        </section>
        <section class="panel">
          <div class="section-heading"><h2>Recent settlements</h2></div>
          <app-activity-list [items]="d.recent_settlements" />
        </section>
      </div>
    } @else {
      <app-state [loading]="loading()" [error]="error()" (retry)="load()" />
    }`,
})
export class DashboardPage {
  private api = inject(Api);
  private auth = inject(Auth);
  data = signal<Dashboard | null>(null);
  loading = signal(true);
  error = signal('');
  firstName = this.auth.user()?.name.split(' ')[0] || 'there';
  greeting =
    new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening';
  constructor() {
    void this.load();
  }
  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.data.set(await this.api.get<Dashboard>('/dashboard'));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
}

import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api, errorMessage, Toast } from '../core/api';
import { User, Page } from '../core/models';
import { StateComponent, PaginationComponent, PrettyPipe, LocalDatePipe } from '../shared/ui';

@Component({
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    StateComponent,
    PaginationComponent,
    PrettyPipe,
    LocalDatePipe,
  ],
  template: `<div class="page-heading">
      <div>
        <span class="eyebrow">ADMINISTRATOR SPACE</span>
        <h1>A thoughtful welcome.</h1>
        <p>Review registrations and manage account access.</p>
      </div>
      <a class="button secondary" routerLink="/admin/users/pending">Pending registrations</a>
    </div>
    <div class="admin-stats">
      @for (s of statLabels; track s.key) {
        <div class="panel">
          <span>{{ s.label }}</span
          ><strong>{{ stats()[s.key] || 0 }}</strong>
        </div>
      }
    </div>
    <div class="toolbar wrap admin-filters">
      <input
        class="search"
        [(ngModel)]="search"
        placeholder="Search by name or email…"
        aria-label="Search users"
        (keyup.enter)="load(1)"
      /><select [(ngModel)]="status" aria-label="User status">
        <option value="">All statuses</option>
        @for (s of statuses; track s) {
          <option [value]="s">{{ s | pretty }}</option>
        }</select
      ><button class="primary" (click)="load(1)">Apply</button>
    </div>
    @if (loading() || error()) {
      <app-state [loading]="loading()" [error]="error()" (retry)="load()" />
    } @else {
      <section class="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th>Phone</th>
              <th>Registered</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            @for (u of data()?.items; track u.id) {
              <tr>
                <td>
                  <button class="text-button" (click)="details(u.id)">
                    <strong>{{ u.name }}</strong></button
                  ><small>{{ u.email }}</small>
                </td>
                <td>{{ u.phone || '—' }}</td>
                <td>{{ u.created_at | localDate }}</td>
                <td>
                  <span class="pill">{{ u.status | pretty }}</span>
                </td>
                <td>
                  <div class="row-actions">
                    @if (u.role !== 'ADMIN') {
                      @if (u.status === 'PENDING_APPROVAL') {
                        <button
                          class="secondary"
                          [disabled]="busy()"
                          (click)="action(u, 'approve')"
                        >
                          Approve</button
                        ><button
                          class="text-button danger"
                          [disabled]="busy()"
                          (click)="action(u, 'reject')"
                        >
                          Reject
                        </button>
                      } @else if (u.status === 'ACTIVE') {
                        <button
                          class="text-button danger"
                          [disabled]="busy()"
                          (click)="action(u, 'suspend')"
                        >
                          Suspend
                        </button>
                      } @else if (u.status === 'SUSPENDED' || u.status === 'REJECTED') {
                        <button
                          class="secondary"
                          [disabled]="busy()"
                          (click)="action(u, 'reactivate')"
                        >
                          Reactivate
                        </button>
                      }
                    } @else {
                      <span class="muted">Administrator</span>
                    }
                  </div>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="5">No users match these filters.</td>
              </tr>
            }
          </tbody>
        </table>
        <app-pagination
          [page]="data()?.page || 1"
          [totalPages]="data()?.total_pages || 0"
          (change)="load($event)"
        />
      </section>
    }
    @if (selected(); as u) {
      <div class="modal-backdrop">
        <section class="action-sheet" role="dialog" aria-modal="true" aria-label="User details">
          <div class="section-heading">
            <h2>{{ u.name }}</h2>
            <button class="icon-button" aria-label="Close" (click)="selected.set(null)">×</button>
          </div>
          <dl>
            <dt>Email</dt>
            <dd>{{ u.email }}</dd>
            <dt>Phone</dt>
            <dd>{{ u.phone || '—' }}</dd>
            <dt>Status</dt>
            <dd>{{ u.status | pretty }}</dd>
            <dt>Role</dt>
            <dd>{{ u.role }}</dd>
            <dt>Registered</dt>
            <dd>{{ u.created_at | localDate }}</dd>
          </dl>
        </section>
      </div>
    }`,
})
export class AdminPage {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private toast = inject(Toast);
  stats = signal<Record<string, number>>({});
  data = signal<Page<User> | null>(null);
  loading = signal(true);
  error = signal('');
  busy = signal(false);
  selected = signal<User | null>(null);
  search = '';
  status = this.route.snapshot.data['pending'] ? 'PENDING_APPROVAL' : '';
  statuses = ['PENDING_VERIFICATION', 'PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'REJECTED'];
  statLabels = [
    { key: 'total', label: 'Total people' },
    { key: 'PENDING_APPROVAL', label: 'Pending approval' },
    { key: 'ACTIVE', label: 'Active' },
    { key: 'SUSPENDED', label: 'Suspended' },
    { key: 'REJECTED', label: 'Rejected' },
  ];
  constructor() {
    void this.load();
  }
  async load(page = 1) {
    this.loading.set(true);
    this.error.set('');
    try {
      const [stats, users] = await Promise.all([
        this.api.get<Record<string, number>>('/admin'),
        this.api.get<Page<User>>('/admin/users', {
          page,
          search: this.search,
          status: this.status,
        }),
      ]);
      this.stats.set(stats);
      this.data.set(users);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
  async action(user: User, action: string) {
    if (
      !confirm(
        `${action[0].toUpperCase() + action.slice(1)} ${user.name} (${user.email})? This changes their account access.`,
      )
    )
      return;
    this.busy.set(true);
    try {
      await this.api.send('POST', `/admin/users/${user.id}/${action}`);
      this.toast.show('Account updated');
      await this.load(this.data()?.page || 1);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
  async details(id: number) {
    try {
      this.selected.set(await this.api.get<User>(`/admin/users/${id}`));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}

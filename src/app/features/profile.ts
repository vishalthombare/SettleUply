import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, FormsModule, Validators } from '@angular/forms';
import { RouterLink, Router } from '@angular/router';
import { Api, errorMessage, Toast } from '../core/api';
import { Auth } from '../core/auth';
import { Preferences } from '../core/preferences';
import { Settings, User, Catalog } from '../core/models';
import { PasswordFieldComponent } from '../shared/password-field';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, FormsModule, RouterLink, PasswordFieldComponent],
  template: `<div class="page-heading">
      <div>
        <span class="eyebrow">MAKE YOURSELF AT HOME</span>
        <h1>Your space.</h1>
        <p>The little details that make it yours.</p>
      </div>
      <button class="secondary" (click)="logout()">Sign out ↗</button>
    </div>
    <div class="settings-grid">
      <div>
        <form class="panel form-panel" [formGroup]="profile" (ngSubmit)="saveProfile()">
          <h2>Personal information</h2>
          <label>Full name<input formControlName="name" /></label
          ><label>Email<input [value]="auth.user()?.email" disabled /></label
          ><label>Phone<input formControlName="phone" type="tel" /></label
          ><button class="primary" [disabled]="busy() || profile.invalid">Save profile</button>
        </form>
        <form class="panel form-panel" [formGroup]="security" (ngSubmit)="changePassword()">
          <h2>Security</h2>
          <app-password-field
            inputId="current-password"
            label="Current password"
            [control]="security.controls.current_password"
            autocomplete="current-password"
          />
          <app-password-field
            inputId="new-password"
            label="New password"
            [control]="security.controls.new_password"
            autocomplete="new-password"
          />
          <small class="muted"
            >10+ characters, uppercase, lowercase, and a number. Changing your password signs out
            all sessions.</small
          ><button class="secondary" [disabled]="busy() || security.invalid">
            Change password
          </button>
        </form>
      </div>
      <form class="panel form-panel" [formGroup]="settings" (ngSubmit)="saveSettings()">
        <h2>Preferences</h2>
        <div class="form-grid">
          <label
            >Default currency<select formControlName="default_currency">
              @for (c of currencies(); track c) {
                <option [value]="c">{{ c }}</option>
              }
            </select></label
          ><label
            >Timezone<input
              formControlName="timezone"
              list="timezones"
              placeholder="Asia/Kuala_Lumpur" /><datalist id="timezones">
              @for (z of zones; track z) {
                <option [value]="z"></option>
              }</datalist
          ></label>
        </div>
        <label
          >Default reminder lead time (days)<input
            type="number"
            min="0"
            max="365"
            formControlName="default_reminder_days_before"
        /></label>
        <h2>Stay in the loop</h2>
        <p class="muted">
          Choose your default notification preferences. Each transaction can override these.
        </p>
        <div class="preference-heading">
          <span>Notification</span><span>Email</span><span>SMS</span>
        </div>
        @for (p of preferencesList; track p.key) {
          <div class="preference-row">
            <strong>{{ p.label }}</strong
            ><input
              type="checkbox"
              [formControlName]="'email_' + p.key"
              [attr.aria-label]="p.label + ' email'"
            /><input
              type="checkbox"
              [formControlName]="'sms_' + p.key"
              [attr.aria-label]="p.label + ' SMS'"
            />
          </div>
        }
        <div class="form-actions">
          <button class="primary" [disabled]="busy() || !ready()">Save preferences</button>
        </div>
        <a routerLink="/notifications">View notification history →</a>
      </form>
    </div>
    <section class="panel form-panel">
      <h2>Your categories & payment methods</h2>
      <div class="toolbar">
        <select [(ngModel)]="catalogType" (change)="loadCatalog()" aria-label="Catalog type">
          <option value="categories">Categories</option>
          <option value="payment-methods">Payment methods</option></select
        ><input
          [(ngModel)]="catalogName"
          placeholder="Name for a new item"
          aria-label="New item name"
        /><button
          class="secondary"
          (click)="saveCatalog()"
          [disabled]="busy() || !catalogName.trim()"
        >
          {{ editingCatalog ? 'Save change' : '+ Add' }}
        </button>
      </div>
      <div class="catalog-list">
        @for (item of catalog(); track item.id) {
          <div>
            <span>{{ item.name }}</span>
            @if (item.is_system) {
              <small class="pill">Default</small>
            } @else {
              <button class="text-button" (click)="editCatalog(item)">Edit</button
              ><button class="text-button danger" (click)="archiveCatalog(item)">Archive</button>
            }
          </div>
        }
      </div>
    </section>
    @if (error()) {
      <p class="form-error" role="alert">{{ error() }}</p>
    }`,
})
export class ProfilePage {
  auth = inject(Auth);
  private api = inject(Api);
  private fb = inject(FormBuilder);
  private toast = inject(Toast);
  private prefs = inject(Preferences);
  private router = inject(Router);
  busy = signal(false);
  ready = signal(false);
  error = signal('');
  currencies = signal<string[]>([]);
  catalog = signal<Catalog[]>([]);
  catalogType = 'categories';
  catalogName = '';
  editingCatalog: number | null = null;
  zones = [
    'UTC',
    'Asia/Kuala_Lumpur',
    'Asia/Kolkata',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Europe/London',
    'America/New_York',
    'Australia/Sydney',
  ];
  preferencesList = [
    { key: 'transaction_notifications', label: 'Transactions' },
    { key: 'due_reminders', label: 'Due reminders' },
    { key: 'settlement_notifications', label: 'Settlements' },
    { key: 'group_notifications', label: 'Group activity' },
  ];
  profile = this.fb.nonNullable.group({
    name: [this.auth.user()?.name || '', Validators.required],
    phone: [this.auth.user()?.phone || ''],
  });
  security = this.fb.nonNullable.group({
    current_password: ['', Validators.required],
    new_password: ['', Validators.required],
  });
  settings = this.fb.nonNullable.group({
    default_currency: ['MYR'],
    timezone: ['Asia/Kuala_Lumpur'],
    default_reminder_days_before: [3],
    email_transaction_notifications: [false],
    sms_transaction_notifications: [false],
    email_due_reminders: [false],
    sms_due_reminders: [false],
    email_settlement_notifications: [false],
    sms_settlement_notifications: [false],
    email_group_notifications: [false],
    sms_group_notifications: [false],
  });
  constructor() {
    void this.load();
  }
  async load() {
    try {
      this.settings.patchValue(await this.prefs.load());
      this.currencies.set(Object.keys(await this.api.get<Record<string, number>>('/currencies')));
      await this.loadCatalog();
      this.ready.set(true);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
  async run(action: () => Promise<void>) {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await action();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
  async saveProfile() {
    this.profile.markAllAsTouched();
    if (this.profile.invalid || !this.profile.controls.name.value.trim()) return;
    await this.run(async () => {
      const u = await this.api.send<User>('PATCH', '/users/me', this.profile.getRawValue());
      this.auth.user.set(u);
      this.toast.show('Profile saved');
    });
  }
  async saveSettings() {
    this.settings.markAllAsTouched();
    if (!this.ready() || this.settings.invalid) return;
    await this.run(async () => {
      const s = await this.api.send<Settings>('PATCH', '/settings', this.settings.getRawValue());
      this.prefs.apply(s);
      this.toast.show('Preferences saved');
    });
  }
  async changePassword() {
    this.security.markAllAsTouched();
    if (
      this.security.invalid ||
      !this.security.controls.current_password.value.trim() ||
      !this.security.controls.new_password.value.trim()
    )
      return;
    await this.run(async () => {
      await this.api.send('POST', '/auth/change-password', this.security.getRawValue());
      this.auth.clear();
      this.toast.show('Password changed. Please sign in again.');
      await this.router.navigateByUrl('/auth/login');
    });
  }
  async logout() {
    await this.run(() => this.auth.logout());
  }
  async loadCatalog() {
    try {
      this.catalog.set(await this.api.all<Catalog>('/' + this.catalogType));
      this.editingCatalog = null;
      this.catalogName = '';
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
  editCatalog(item: Catalog) {
    this.editingCatalog = item.id;
    this.catalogName = item.name;
  }
  async saveCatalog() {
    if (!this.catalogName.trim()) return;
    await this.run(async () => {
      await this.api.send(
        this.editingCatalog ? 'PATCH' : 'POST',
        `/${this.catalogType}${this.editingCatalog ? '/' + this.editingCatalog : ''}`,
        { name: this.catalogName, is_active: true },
      );
      await this.loadCatalog();
      this.toast.show('Saved');
    });
  }
  async archiveCatalog(item: Catalog) {
    if (!confirm(`Archive ${item.name}?`)) return;
    await this.run(async () => {
      await this.api.send('DELETE', `/${this.catalogType}/${item.id}`);
      await this.loadCatalog();
    });
  }
}

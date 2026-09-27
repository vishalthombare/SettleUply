import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Auth } from '../core/auth';
import { Preferences } from '../core/preferences';

@Component({
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  styles: `
    .mobile-brand .mobile-admin-brand {
      color: inherit;
    }
    .mobile-admin-brand small {
      display: block;
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 10px;
      font-weight: 400;
      letter-spacing: 0;
      color: var(--muted);
      margin-top: 3px;
    }
  `,
  template: ` <div class="app-shell">
    <aside class="sidebar">
      <a class="brand" [routerLink]="auth.homeUrl()"
        ><img src="/icon.svg" alt="" />SettleUply<span>®</span></a
      ><span class="eyebrow nav-caption">{{
        auth.isAdmin() ? 'ADMINISTRATOR SPACE' : 'YOUR MONEY, IN BALANCE'
      }}</span>
      <nav aria-label="Main navigation">
        @for (link of links(); track link.path) {
          <a
            [routerLink]="link.path"
            routerLinkActive="active"
            [routerLinkActiveOptions]="{ exact: auth.isAdmin() }"
            ><span>{{ link.icon }}</span
            >{{ link.label }}</a
          >
        }
        @if (!auth.isAdmin()) {
          <a routerLink="/reminders" routerLinkActive="active"><span>◷</span>Reminders</a>
        }
      </nav>
      <div class="sidebar-note">
        @if (auth.isAdmin()) {
          <span>Review accounts.<br />Manage access.</span>
          <p>Welcome new users.<br />Keep account access up to date.</p>
        } @else {
          <span>Little records.<br />Clearer relationships.</span>
          <p>Keep track today.<br />Settle up with confidence.</p>
        }
      </div>
      @if (auth.isAdmin()) {
        <div class="sidebar-user">
          <span class="avatar">{{ auth.user()?.name?.slice(0, 1) }}</span>
          <span
            ><strong>{{ auth.user()?.name }}</strong
            ><small>Administrator</small></span
          >
        </div>
      } @else {
        <a routerLink="/profile" class="sidebar-user"
          ><span class="avatar">{{ auth.user()?.name?.slice(0, 1) }}</span
          ><span
            ><strong>{{ auth.user()?.name }}</strong
            ><small>Your personal space</small></span
          ></a
        >
      }
    </aside>
    <div class="workspace">
      <header class="topbar">
        <a class="mobile-brand" [routerLink]="auth.homeUrl()">
          @if (auth.isAdmin()) {
            <span class="mobile-admin-brand"
              >SettleUply<small>{{ auth.user()?.name }} · Admin</small></span
            >
          } @else {
            SettleUply
          }
          <span>✳</span>
        </a>
        @if (auth.isAdmin()) {
          <span class="topbar-note">Administrator space</span>
          <button class="secondary" [disabled]="signingOut()" (click)="logout()">
            {{ signingOut() ? 'Signing out…' : 'Sign out' }}
          </button>
        } @else {
          <span class="topbar-note">A little clarity goes a long way.</span>
          <a routerLink="/reminders" class="icon-button" aria-label="Reminders">◷</a>
          <button class="primary desktop-add" (click)="actions.set(true)">+ Add new</button>
        }
      </header>
      <main id="main"><router-outlet /></main>
      <footer class="desktop-footer">
        SettleUply
        <span>{{
          auth.isAdmin() ? 'Account administration' : 'Keep money simple. Keep people close.'
        }}</span>
      </footer>
    </div>
    <nav class="bottom-nav" aria-label="Mobile navigation">
      @for (link of links(); track link.path) {
        <a
          [routerLink]="link.path"
          routerLinkActive="active"
          [routerLinkActiveOptions]="{ exact: auth.isAdmin() }"
          ><span>{{ link.icon }}</span
          >{{ link.mobile }}</a
        >
      }
    </nav>
    @if (!auth.isAdmin()) {
      <button class="fab" aria-label="Add a financial record" (click)="actions.set(true)">+</button>
    }
    @if (!auth.isAdmin() && actions()) {
      <div class="modal-backdrop" (click)="actions.set(false)">
        <section
          class="action-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="Add new"
          (click)="$event.stopPropagation()"
          (keydown.escape)="actions.set(false)"
        >
          <div class="section-heading">
            <h2>What’s happening?</h2>
            <button class="icon-button" aria-label="Close" (click)="actions.set(false)">×</button>
          </div>
          @for (action of quickActions; track action.label) {
            <a
              class="action-option"
              [routerLink]="action.path"
              [queryParams]="action.query"
              (click)="actions.set(false)"
              ><span>{{ action.icon }}</span>
              <div>
                <strong>{{ action.label }}</strong
                ><small>{{ action.hint }}</small>
              </div>
              <span>↗</span></a
            >
          }
        </section>
      </div>
    }
  </div>`,
})
export class Shell {
  auth = inject(Auth);
  actions = signal(false);
  signingOut = signal(false);
  private preferences = inject(Preferences);
  links = computed(() =>
    this.auth.isAdmin()
      ? [
          { path: '/admin', label: 'Admin overview', mobile: 'Overview', icon: '▦' },
          { path: '/admin/users', label: 'Users', mobile: 'Users', icon: '♧' },
          {
            path: '/admin/users/pending',
            label: 'Pending registrations',
            mobile: 'Pending',
            icon: '◷',
          },
        ]
      : [
          { path: '/dashboard', label: 'Overview', mobile: 'Home', icon: '⌂' },
          { path: '/people', label: 'People', mobile: 'People', icon: '♧' },
          { path: '/groups', label: 'Groups', mobile: 'Groups', icon: '◎' },
          { path: '/activity', label: 'Activity', mobile: 'Activity', icon: '↔' },
          { path: '/profile', label: 'Profile & settings', mobile: 'Profile', icon: '◉' },
        ],
  );
  quickActions = [
    {
      label: 'Personal expense',
      hint: 'Something you spent',
      icon: '−',
      path: '/transactions/new',
      query: { type: 'PERSONAL_EXPENSE' },
    },
    {
      label: 'Give money',
      hint: 'Someone owes you',
      icon: '↗',
      path: '/transactions/new',
      query: { type: 'MONEY_LENT' },
    },
    {
      label: 'Borrow money',
      hint: 'You owe someone',
      icon: '↙',
      path: '/transactions/new',
      query: { type: 'MONEY_BORROWED' },
    },
    {
      label: 'Add settlement',
      hint: 'Record a repayment',
      icon: '✓',
      path: '/settlements/new',
      query: {},
    },
    {
      label: 'Group expense',
      hint: 'Share a cost together',
      icon: '◎',
      path: '/groups',
      query: { addExpense: 'true' },
    },
  ];
  constructor() {
    if (!this.auth.isAdmin()) void this.preferences.load().catch(() => {});
  }
  async logout() {
    if (this.signingOut()) return;
    this.signingOut.set(true);
    try {
      await this.auth.logout();
    } catch {
      // Auth.logout clears the local session and redirects even if the server is unavailable.
    } finally {
      this.signingOut.set(false);
    }
  }
}

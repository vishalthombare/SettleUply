import { Routes } from '@angular/router';
import { authGuard, adminGuard, appSectionGuard } from './core/auth';
export const routes: Routes = [
  ...['login', 'register', 'verify', 'forgot', 'reset', 'pending'].map((mode) => ({
    path: 'auth/' + mode,
    loadComponent: () => import('./features/auth').then((m) => m.AuthPage),
    data: { mode },
  })),
  {
    path: 'forbidden',
    loadComponent: () => import('./features/error-page').then((m) => m.ErrorPage),
    data: { forbidden: true },
  },
  {
    path: '',
    canActivate: [authGuard],
    canActivateChild: [authGuard, appSectionGuard],
    loadComponent: () => import('./layouts/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard').then((m) => m.DashboardPage),
      },
      {
        path: 'people',
        loadComponent: () => import('./features/people').then((m) => m.PeoplePage),
      },
      {
        path: 'people/new',
        loadComponent: () => import('./features/people').then((m) => m.ContactForm),
      },
      {
        path: 'people/:id/edit',
        loadComponent: () => import('./features/people').then((m) => m.ContactForm),
      },
      {
        path: 'people/:id',
        loadComponent: () => import('./features/people').then((m) => m.PersonPage),
      },
      {
        path: 'transactions/new',
        loadComponent: () => import('./features/transactions').then((m) => m.TransactionForm),
      },
      {
        path: 'transactions/:id/edit',
        loadComponent: () => import('./features/transactions').then((m) => m.TransactionForm),
      },
      {
        path: 'transactions/:id/settle',
        loadComponent: () => import('./features/transactions').then((m) => m.SettlementForm),
      },
      {
        path: 'transactions/:id',
        loadComponent: () => import('./features/transactions').then((m) => m.TransactionPage),
      },
      {
        path: 'settlements/new',
        loadComponent: () => import('./features/transactions').then((m) => m.SettlementForm),
      },
      {
        path: 'groups',
        loadComponent: () => import('./features/groups').then((m) => m.GroupsPage),
      },
      {
        path: 'groups/new',
        loadComponent: () => import('./features/groups').then((m) => m.GroupForm),
      },
      {
        path: 'groups/:id/edit',
        loadComponent: () => import('./features/groups').then((m) => m.GroupForm),
      },
      {
        path: 'groups/:groupId/expenses/new',
        loadComponent: () => import('./features/group-expense').then((m) => m.GroupExpenseForm),
      },
      {
        path: 'groups/:groupId/expenses/:expenseId/edit',
        loadComponent: () => import('./features/group-expense').then((m) => m.GroupExpenseForm),
      },
      {
        path: 'groups/:groupId/expenses/:expenseId',
        loadComponent: () => import('./features/group-expense').then((m) => m.GroupExpensePage),
      },
      {
        path: 'groups/:id',
        loadComponent: () => import('./features/groups').then((m) => m.GroupPage),
      },
      {
        path: 'activity',
        loadComponent: () => import('./features/activity').then((m) => m.ActivityPage),
      },
      {
        path: 'profile',
        loadComponent: () => import('./features/profile').then((m) => m.ProfilePage),
      },
      {
        path: 'reminders',
        loadComponent: () => import('./features/reminders').then((m) => m.RemindersPage),
      },
      {
        path: 'notifications',
        loadComponent: () => import('./features/reminders').then((m) => m.NotificationsPage),
      },
      {
        path: 'admin',
        canActivate: [adminGuard],
        data: { adminOnly: true },
        loadComponent: () => import('./features/admin').then((m) => m.AdminPage),
      },
      {
        path: 'admin/users',
        canActivate: [adminGuard],
        data: { adminOnly: true },
        loadComponent: () => import('./features/admin').then((m) => m.AdminPage),
      },
      {
        path: 'admin/users/pending',
        canActivate: [adminGuard],
        data: { pending: true, adminOnly: true },
        loadComponent: () => import('./features/admin').then((m) => m.AdminPage),
      },
    ],
  },
  { path: '**', loadComponent: () => import('./features/error-page').then((m) => m.ErrorPage) },
];

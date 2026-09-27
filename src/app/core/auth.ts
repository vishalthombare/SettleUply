import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { Router, CanActivateFn, CanActivateChildFn } from '@angular/router';
import { firstValueFrom, catchError, from, switchMap, throwError } from 'rxjs';
import { environment } from './environment';
import { Envelope, User } from './models';
import { applicationType } from './application-type';

interface Tokens {
  access_token: string;
  user: User;
}

export interface LoginChallenge {
  challenge_token: string;
  expires_in: number;
  resend_after: number;
}

export const ACCESS_TOKEN_KEY = 'settleuply_access_token';

@Injectable({ providedIn: 'root' })
export class Auth {
  private http = inject(HttpClient);
  private router = inject(Router);
  user = signal<User | null>(null);
  token = signal<string | null>(null);
  isAdmin = computed(() => this.user()?.role === 'ADMIN');
  homeUrl = computed(() => (this.isAdmin() ? '/admin' : '/dashboard'));
  private refreshing: Promise<boolean> | null = null;
  private sessionVersion = 0;
  private pendingLoginToken: string | null = null;

  hasSavedSession(): boolean {
    try {
      const saved = localStorage.getItem(ACCESS_TOKEN_KEY)?.trim();
      return !!saved && saved !== 'null' && saved !== 'undefined';
    } catch {
      return false;
    }
  }

  private accept(data: Tokens) {
    // Persist only the access token. The refresh token stays in its HttpOnly cookie.
    try {
      localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
    } catch {
      this.clear();
      throw new Error('Unable to save your login. Allow browser storage and try again.');
    }
    this.token.set(data.access_token);
    this.user.set(data.user);
  }
  async login(body: { email: string; password: string }): Promise<LoginChallenge> {
    this.clear();
    const version = this.sessionVersion;
    const result = await firstValueFrom(
      this.http.post<Envelope<LoginChallenge>>(environment.API_BASE_URL + '/auth/login', body, {
        withCredentials: true,
      }),
    );
    if (version !== this.sessionVersion) throw new Error('This sign-in attempt was canceled.');
    this.pendingLoginToken = result.data.challenge_token;
    return result.data;
  }
  async verifyLogin(body: { challenge_token: string; otp: string }): Promise<void> {
    this.requireLoginChallenge(body.challenge_token);
    const version = this.sessionVersion;
    const result = await firstValueFrom(
      this.http.post<Envelope<Tokens>>(environment.API_BASE_URL + '/auth/verify-login-otp', body, {
        withCredentials: true,
      }),
    );
    if (version !== this.sessionVersion) throw new Error('This sign-in attempt was canceled.');
    this.requireLoginChallenge(body.challenge_token);
    this.pendingLoginToken = null;
    this.sessionVersion++;
    this.accept(result.data);
  }
  async resendLogin(challengeToken: string): Promise<LoginChallenge> {
    this.requireLoginChallenge(challengeToken);
    const version = this.sessionVersion;
    const result = await firstValueFrom(
      this.http.post<Envelope<LoginChallenge>>(
        environment.API_BASE_URL + '/auth/resend-login-otp',
        { challenge_token: challengeToken },
      ),
    );
    if (version !== this.sessionVersion) throw new Error('This sign-in attempt was canceled.');
    this.requireLoginChallenge(challengeToken);
    this.pendingLoginToken = result.data.challenge_token;
    return result.data;
  }
  cancelLogin() {
    this.sessionVersion++;
    this.pendingLoginToken = null;
  }
  private requireLoginChallenge(challengeToken: string) {
    if (!challengeToken || this.pendingLoginToken !== challengeToken) {
      throw new Error('Start again with your email and password to request a sign-in code.');
    }
  }
  restore(): Promise<boolean> {
    return this.refresh();
  }
  refresh(): Promise<boolean> {
    if (!this.hasSavedSession()) {
      this.clear();
      return Promise.resolve(false);
    }
    if (!this.refreshing) {
      const version = this.sessionVersion;
      this.refreshing = firstValueFrom(
        this.http.post<Envelope<Tokens>>(
          environment.API_BASE_URL + '/auth/refresh',
          {},
          { withCredentials: true },
        ),
      )
        .then((r) => {
          // A late refresh must not restore a session that was cleared while it ran.
          if (version !== this.sessionVersion || !this.hasSavedSession()) return false;
          this.accept(r.data);
          return true;
        })
        .catch(() => {
          if (version === this.sessionVersion) this.clear();
          return false;
        })
        .finally(() => {
          this.refreshing = null;
        });
    }
    return this.refreshing;
  }
  clear() {
    this.cancelLogin();
    try {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
    } catch {
      // Memory state must still be cleared if browser storage is unavailable.
    }
    this.token.set(null);
    this.user.set(null);
  }
  async logout() {
    this.sessionVersion++;
    try {
      if (this.hasSavedSession()) {
        await firstValueFrom(
          this.http.post(environment.API_BASE_URL + '/auth/logout', {}, { withCredentials: true }),
        );
      }
    } finally {
      this.clear();
      await this.router.navigateByUrl('/auth/login');
    }
  }
}

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(Auth),
    router = inject(Router);
  if (!request.url.startsWith(environment.API_BASE_URL + '/')) return next(request);
  request = request.clone({ setHeaders: { 'X-Application-Type': applicationType() } });
  const path = request.url.slice(environment.API_BASE_URL.length).split('?')[0];
  const publicAuthPaths = [
    '/auth/login',
    '/auth/verify-login-otp',
    '/auth/resend-login-otp',
    '/auth/register',
    '/auth/verify-otp',
    '/auth/resend-otp',
    '/auth/forgot-password',
    '/auth/reset-password',
  ];
  const isPublic =
    (request.method === 'POST' && publicAuthPaths.includes(path)) ||
    (request.method === 'GET' && path === '/currencies');
  if (isPublic) return next(request);

  const usesCookie = path === '/auth/refresh' || path === '/auth/logout';
  if (!auth.hasSavedSession() || (!usesCookie && !auth.token())) {
    auth.clear();
    void router.navigateByUrl('/auth/login');
    return throwError(
      () =>
        new HttpErrorResponse({
          status: 401,
          error: { message: 'Please sign in before continuing.' },
          url: request.url,
        }),
    );
  }
  const withToken = (token: string) =>
    request.clone({ setHeaders: { Authorization: `Bearer ${token}` }, withCredentials: true });
  const outgoing = auth.token() ? withToken(auth.token()!) : request;
  return next(outgoing).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status !== 401 || path.startsWith('/auth/')) return throwError(() => error);
      if (!auth.hasSavedSession()) {
        auth.clear();
        void router.navigateByUrl('/auth/login');
        return throwError(() => error);
      }
      if (auth.token() && outgoing.headers.get('Authorization') !== `Bearer ${auth.token()}`)
        return next(withToken(auth.token()!));
      return from(auth.refresh()).pipe(
        switchMap((success) => {
          if (success) return next(withToken(auth.token()!));
          void router.navigateByUrl('/auth/login');
          return throwError(() => error);
        }),
      );
    }),
  );
};
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(Auth),
    router = inject(Router);
  return (
    (auth.hasSavedSession() && !!auth.token() && auth.user()?.status === 'ACTIVE') ||
    router.createUrlTree(['/auth/login'], { queryParams: { returnUrl: state.url } })
  );
};
export const adminGuard: CanActivateFn = () =>
  inject(Auth).isAdmin() || inject(Router).createUrlTree(['/forbidden']);

export const appSectionGuard: CanActivateChildFn = (route) => {
  const auth = inject(Auth),
    router = inject(Router);
  const adminPage = route.data['adminOnly'] === true;
  if (auth.isAdmin() && !adminPage) return router.createUrlTree(['/admin']);
  if (!auth.isAdmin() && adminPage) return router.createUrlTree(['/forbidden']);
  return true;
};

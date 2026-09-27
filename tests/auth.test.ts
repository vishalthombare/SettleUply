import '@angular/compiler';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnvironmentInjector, runInInjectionContext } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpRequest, HttpResponse } from '@angular/common/http';
import {
  Router,
  ActivatedRoute,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
} from '@angular/router';
import { FormBuilder } from '@angular/forms';
import { Subject, firstValueFrom, map } from 'rxjs';
import {
  Auth,
  ACCESS_TOKEN_KEY,
  authInterceptor,
  authGuard,
  adminGuard,
  appSectionGuard,
} from '../src/app/core/auth';
import { AuthPage } from '../src/app/features/auth';
import { Api, Toast } from '../src/app/core/api';
import { environment } from '../src/app/core/environment';
import { applicationType } from '../src/app/core/application-type';
import { routes as appRoutes } from '../src/app/app.routes';
import { User } from '../src/app/core/models';
import { Preferences } from '../src/app/core/preferences';
import { Shell } from '../src/app/layouts/shell';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});
let injector: ReturnType<typeof createEnvironmentInjector>;
let auth: Auth;
let requests: { request: HttpRequest<unknown>; response: Subject<HttpResponse<unknown>> }[];
let routes: string[];
let route: {
  snapshot: { data: { mode: string }; queryParamMap: { get: (key: string) => string | null } };
};
let returnUrl: string | null;
let preferenceLoads: number;
let pages: AuthPage[];
const challenge = {
  challenge_token: 'test-login-challenge-token-1234567890',
  expires_in: 600,
  resend_after: 60,
};

function dispatch(method: string, url: string, body: unknown = {}) {
  return runInInjectionContext(injector, () =>
    authInterceptor(new HttpRequest(method, url, body), (request) => {
      const response = new Subject<HttpResponse<unknown>>();
      requests.push({ request, response });
      return response;
    }),
  ).pipe(map((event) => (event as HttpResponse<unknown>).body));
}
function respond(index: number, data: unknown = null) {
  requests[index].response.next(new HttpResponse({ body: { success: true, data } }));
  requests[index].response.complete();
}
const user: User = {
  id: 1,
  name: 'Test',
  email: 'test@example.com',
  phone: null,
  role: 'USER',
  status: 'ACTIVE',
  created_at: '',
};
async function login(role: User['role'] = 'USER') {
  const index = requests.length;
  const result = auth.login({ email: user.email, password: 'Password123' });
  respond(index, challenge);
  await result;
  const verified = auth.verifyLogin({ challenge_token: challenge.challenge_token, otp: '123456' });
  respond(index + 1, { access_token: 'saved-access', user: { ...user, role } });
  await verified;
}
function page(mode: string) {
  route.snapshot.data.mode = mode;
  const component = runInInjectionContext(injector, () => new AuthPage());
  pages.push(component);
  return component;
}
async function requestLoginCode(component: AuthPage, resendAfter = 60) {
  component.form.patchValue({ email: user.email, password: 'Password123' });
  const index = requests.length;
  const pending = component.submit();
  respond(index, { ...challenge, resend_after: resendAfter });
  await pending;
}

beforeEach(() => {
  storage.clear();
  requests = [];
  routes = [];
  returnUrl = null;
  preferenceLoads = 0;
  pages = [];
  route = {
    snapshot: {
      data: { mode: 'login' },
      queryParamMap: { get: (key) => (key === 'returnUrl' ? returnUrl : null) },
    },
  };
  injector = createEnvironmentInjector(
    [
      Auth,
      FormBuilder,
      {
        provide: HttpClient,
        useValue: { post: (url: string, body: unknown) => dispatch('POST', url, body) },
      },
      {
        provide: Router,
        useValue: {
          createUrlTree: (commands: string[], extras?: unknown) => ({ commands, extras }),
          navigateByUrl: async (url: string) => {
            routes.push(url);
            return true;
          },
          navigate: async (commands: string[]) => {
            routes.push(commands.join('/'));
            return true;
          },
        },
      },
      { provide: ActivatedRoute, useValue: route },
      { provide: Toast, useValue: { show: () => {} } },
      {
        provide: Preferences,
        useValue: {
          load: async () => {
            preferenceLoads++;
          },
        },
      },
      {
        provide: Api,
        useValue: {
          send: (method: string, path: string, body: unknown) =>
            firstValueFrom(dispatch(method, environment.API_BASE_URL + path, body)).then(
              (r: any) => r.data,
            ),
        },
      },
    ],
    null!,
  );
  auth = injector.get(Auth);
});
afterEach(() => {
  for (const component of pages) component.ngOnDestroy();
  injector.destroy();
});

test('fresh startup, refresh and logout make zero requests without a saved token', async () => {
  for (const value of [null, '', ' ', 'null', 'undefined']) {
    if (value !== null) storage.set(ACCESS_TOKEN_KEY, value);
    assert.equal(await auth.restore(), false);
    assert.equal(await auth.refresh(), false);
    await auth.logout();
  }
  assert.equal(requests.length, 0);
});

test('protected APIs and direct refresh/change-password requests are blocked before transport', async () => {
  for (const [method, path] of [
    ['GET', '/contacts'],
    ['GET', '/dashboard'],
    ['POST', '/auth/refresh'],
    ['POST', '/auth/change-password'],
  ]) {
    await assert.rejects(firstValueFrom(dispatch(method, environment.API_BASE_URL + path)), {
      status: 401,
    });
  }
  assert.equal(requests.length, 0);
});

test('verified login saves access token and authorizes protected requests; logout clears storage', async () => {
  await login();
  assert.equal(requests[0].request.headers.get('X-Application-Type'), 'WEB');
  assert.equal(storage.get(ACCESS_TOKEN_KEY), 'saved-access');
  const data = firstValueFrom(dispatch('GET', environment.API_BASE_URL + '/contacts'));
  assert.equal(requests[2].request.headers.get('Authorization'), 'Bearer saved-access');
  assert.equal(requests[2].request.headers.get('X-Application-Type'), 'WEB');
  respond(2);
  await data;
  const logout = auth.logout();
  respond(3);
  await logout;
  assert.equal(storage.has(ACCESS_TOKEN_KEY), false);
  assert.equal(auth.token(), null);
});

test('password login waits for OTP, clears the password, and allows invalid-code retries', async () => {
  const component = page('login');
  await requestLoginCode(component);
  assert.equal(component.loginChallenge()?.challenge_token, challenge.challenge_token);
  assert.equal(component.form.controls.password.value, '');
  assert.equal(auth.user(), null);
  assert.equal(auth.token(), null);
  assert.equal(storage.size, 0);
  assert.deepEqual(routes, []);
  for (const otp of ['', '123', 'abcdef']) {
    component.form.controls.otp.setValue(otp);
    await component.submit();
    assert.equal(requests.length, 1);
  }
  component.form.controls.otp.setValue('123456');
  const invalid = component.submit();
  await component.submit();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].request.url, environment.API_BASE_URL + '/auth/verify-login-otp');
  assert.equal(requests[1].request.headers.has('Authorization'), false);
  assert.deepEqual(requests[1].request.body, {
    challenge_token: challenge.challenge_token,
    otp: '123456',
  });
  requests[1].response.error(
    new HttpErrorResponse({
      status: 400,
      error: { message: 'Invalid or expired code.' },
    }),
  );
  await invalid;
  assert.equal(component.error(), 'Invalid or expired code.');
  assert.ok(component.loginChallenge());
  assert.equal(storage.size, 0);
  const retried = component.submit();
  respond(2, { access_token: 'verified-access', user });
  await retried;
  assert.equal(storage.get(ACCESS_TOKEN_KEY), 'verified-access');
  assert.equal(routes.at(-1), '/dashboard');
  component.ngOnDestroy();
  assert.equal(auth.token(), 'verified-access');
});

test('login resend waits for cooldown, replaces the challenge, and sends only once', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1000 });
  const component = page('login');
  await requestLoginCode(component);
  await component.resendLogin();
  assert.equal(requests.length, 1);
  context.mock.timers.tick(59000);
  assert.equal(component.resendSeconds(), 1);
  await component.resendLogin();
  assert.equal(requests.length, 1);
  context.mock.timers.tick(1000);
  assert.equal(component.resendSeconds(), 0);
  component.form.controls.otp.setValue('123456');
  const resent = component.resendLogin();
  await component.resendLogin();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].request.url, environment.API_BASE_URL + '/auth/resend-login-otp');
  assert.equal(requests[1].request.headers.has('Authorization'), false);
  assert.deepEqual(requests[1].request.body, { challenge_token: challenge.challenge_token });
  const replacement = { ...challenge, challenge_token: 'replacement-login-challenge-token-12345' };
  respond(1, replacement);
  await resent;
  assert.equal(component.loginChallenge()?.challenge_token, replacement.challenge_token);
  assert.equal(component.form.controls.otp.value, '');
  assert.equal(component.resendSeconds(), 60);
  assert.equal(storage.size, 0);
  await assert.rejects(
    auth.verifyLogin({ challenge_token: challenge.challenge_token, otp: '123456' }),
  );
  assert.equal(requests.length, 2);
  component.form.controls.otp.setValue('654321');
  const verified = component.submit();
  assert.deepEqual(requests[2].request.body, {
    challenge_token: replacement.challenge_token,
    otp: '654321',
  });
  respond(2, { access_token: 'new-access', user });
  await verified;
  assert.equal(auth.token(), 'new-access');
});

test('changing login details requires the password again and keeps the email', async () => {
  const component = page('login');
  await requestLoginCode(component);
  component.form.controls.otp.setValue('123456');
  component.backToLogin();
  assert.equal(component.loginChallenge(), null);
  assert.equal(component.resendSeconds(), 0);
  assert.equal(component.form.controls.email.value, user.email);
  assert.equal(component.form.controls.password.value, '');
  assert.equal(component.form.controls.otp.value, '');
  await component.submit();
  assert.equal(requests.length, 1);
  await assert.rejects(
    auth.verifyLogin({ challenge_token: challenge.challenge_token, otp: '123456' }),
  );
  assert.equal(requests.length, 1);
});

test('resend delivery failure returns to password entry and shows the server message', async () => {
  const component = page('login');
  await requestLoginCode(component, 0);
  const resent = component.resendLogin();
  const message = 'We could not send the sign-in code. Wait one minute, then sign in again.';
  requests[1].response.error(new HttpErrorResponse({ status: 503, error: { message } }));
  await resent;
  assert.equal(component.loginChallenge(), null);
  assert.equal(component.error(), message);
  assert.equal(component.busy(), false);
  assert.equal(component.form.controls.password.invalid, true);
  assert.equal(storage.size, 0);
});

for (const action of ['login', 'verify', 'resend'] as const) {
  test(`a late ${action} response cannot revive a canceled sign-in`, async () => {
    const component = page('login');
    if (action !== 'login') await requestLoginCode(component, 0);
    else component.form.patchValue({ email: user.email, password: 'Password123' });
    component.form.controls.otp.setValue('123456');
    const index = requests.length;
    const pending = action === 'resend' ? component.resendLogin() : component.submit();
    component.backToLogin();
    respond(index, action === 'verify' ? { access_token: 'late-access', user } : challenge);
    await pending;
    assert.equal(component.loginChallenge(), null);
    assert.equal(component.error(), '');
    assert.equal(component.busy(), false);
    assert.equal(auth.user(), null);
    assert.equal(auth.token(), null);
    assert.equal(storage.size, 0);
    assert.deepEqual(routes, []);
  });
}

test('leaving the login page ignores a late verification response', async () => {
  const component = page('login');
  await requestLoginCode(component);
  component.form.controls.otp.setValue('123456');
  const pending = component.submit();
  component.ngOnDestroy();
  respond(1, { access_token: 'late-access', user });
  await pending;
  assert.equal(auth.token(), null);
  assert.equal(storage.size, 0);
  assert.deepEqual(routes, []);
});

test('OTP verification cannot start from a reloaded or absent login challenge', async () => {
  await assert.rejects(
    auth.verifyLogin({ challenge_token: challenge.challenge_token, otp: '123456' }),
  );
  await assert.rejects(auth.resendLogin(challenge.challenge_token));
  assert.equal(requests.length, 0);
});

test('saved login restores once, rotates stored access token, and clears it on refresh failure', async () => {
  storage.set(ACCESS_TOKEN_KEY, 'old-access');
  const restore = auth.restore();
  const concurrent = auth.refresh();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].request.url, environment.API_BASE_URL + '/auth/refresh');
  assert.equal(requests[0].request.headers.get('X-Application-Type'), 'WEB');
  respond(0, { access_token: 'rotated-access', user });
  assert.deepEqual(await Promise.all([restore, concurrent]), [true, true]);
  assert.equal(storage.get(ACCESS_TOKEN_KEY), 'rotated-access');
  const failed = auth.refresh();
  requests[1].response.error(new HttpErrorResponse({ status: 401 }));
  assert.equal(await failed, false);
  assert.equal(storage.has(ACCESS_TOKEN_KEY), false);
  assert.equal(await auth.restore(), false);
  assert.equal(requests.length, 2);
});

test('clearing storage blocks even a previously logged-in tab and suppresses refresh', async () => {
  await login();
  storage.delete(ACCESS_TOKEN_KEY);
  await assert.rejects(firstValueFrom(dispatch('GET', environment.API_BASE_URL + '/contacts')), {
    status: 401,
  });
  assert.equal(await auth.refresh(), false);
  assert.equal(requests.length, 2);
  assert.equal(auth.user(), null);
});

test('late refresh response cannot restore a cleared session', async () => {
  storage.set(ACCESS_TOKEN_KEY, 'saved-access');
  const restoring = auth.restore();
  auth.clear();
  respond(0, { access_token: 'late-access', user });
  assert.equal(await restoring, false);
  assert.equal(storage.has(ACCESS_TOKEN_KEY), false);
  assert.equal(auth.user(), null);
});

test('empty and invalid auth form submissions never reach the API', async () => {
  for (const mode of ['login', 'register', 'verify', 'forgot', 'reset']) {
    const component = page(mode);
    await component.submit();
    assert.equal(requests.length, 0, mode);
    component.form.controls.email.setValue('invalid');
    await component.submit();
    assert.equal(requests.length, 0, mode);
    component.form.controls.email.setValue(user.email);
    if (mode === 'register') component.form.patchValue({ name: '  ', password: 'weak' });
    if (mode === 'login') component.form.controls.password.setValue('   ');
    if (mode === 'verify' || mode === 'reset')
      component.form.patchValue({ otp: '12ab', password: 'weak' });
    if (mode !== 'forgot') {
      await component.submit();
      assert.equal(requests.length, 0, mode);
    }
  }
});

test('resend validates email only; a valid email sends once without needing an OTP', async () => {
  const component = page('verify');
  for (const email of ['', ' ', 'invalid']) {
    component.form.controls.email.setValue(email);
    await component.resend();
    assert.equal(requests.length, 0);
  }
  component.form.controls.email.setValue(user.email);
  const first = component.resend();
  await component.resend();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].request.url, environment.API_BASE_URL + '/auth/resend-otp');
  assert.equal(requests[0].request.headers.has('Authorization'), false);
  respond(0);
  await first;
});

test('valid auth forms still submit explicitly and duplicate clicks do not send twice', async () => {
  for (const [mode, path] of [
    ['login', 'login'],
    ['register', 'register'],
    ['verify', 'verify-otp'],
    ['forgot', 'forgot-password'],
    ['reset', 'reset-password'],
  ]) {
    const component = page(mode);
    component.form.patchValue({
      name: 'Test User',
      email: user.email,
      password: 'Password123',
      otp: '123456',
    });
    const index = requests.length;
    const pending = component.submit();
    await component.submit();
    assert.equal(requests.length, index + 1);
    assert.equal(requests[index].request.url, environment.API_BASE_URL + '/auth/' + path);
    respond(index, mode === 'login' ? challenge : null);
    await pending;
    assert.equal(component.error(), '');
  }
});

test('application source detects mobile devices and permits explicit client configuration', () => {
  assert.equal(
    applicationType('AUTO', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }),
    'WEB',
  );
  assert.equal(
    applicationType('AUTO', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)' }),
    'MOBILE',
  );
  assert.equal(applicationType('AUTO', { userAgent: 'Mozilla/5.0 (Linux; Android 15)' }), 'MOBILE');
  assert.equal(
    applicationType('AUTO', { userAgent: 'Safari', platform: 'MacIntel', maxTouchPoints: 5 }),
    'MOBILE',
  );
  assert.equal(applicationType('MOBILE', { userAgent: 'Native client' }), 'MOBILE');
  assert.equal(applicationType('WEB', { userAgent: 'iPhone' }), 'WEB');
});

test('the application-source header is not sent to unrelated origins', async () => {
  const result = firstValueFrom(dispatch('GET', 'https://example.com/public'));
  assert.equal(requests[0].request.headers.has('X-Application-Type'), false);
  respond(0);
  await result;
});

test('mobile auth and protected calls carry MOBILE without changing token gating', async () => {
  const original = environment.APPLICATION_TYPE;
  environment.APPLICATION_TYPE = 'MOBILE';
  try {
    assert.equal(await auth.restore(), false);
    assert.equal(requests.length, 0);
    await login();
    assert.equal(requests[0].request.headers.get('X-Application-Type'), 'MOBILE');
    const result = firstValueFrom(dispatch('GET', environment.API_BASE_URL + '/contacts'));
    assert.equal(requests[1].request.headers.get('X-Application-Type'), 'MOBILE');
    assert.equal(requests[2].request.headers.get('X-Application-Type'), 'MOBILE');
    respond(2);
    await result;
  } finally {
    environment.APPLICATION_TYPE = original;
  }
});

test('admin login opens the admin screen even with a saved personal return URL', async () => {
  for (const target of [null, '/dashboard', '/people/12', '/groups/4', '/profile']) {
    returnUrl = target;
    const component = page('login');
    const priorRoutes = routes.length;
    await requestLoginCode(component);
    assert.equal(routes.length, priorRoutes);
    assert.equal(auth.user(), null);
    component.form.controls.otp.setValue('123456');
    const index = requests.length;
    const pending = component.submit();
    respond(index, { access_token: 'admin-access', user: { ...user, role: 'ADMIN' } });
    await pending;
    assert.equal(component.error(), '');
    assert.equal(routes.at(-1), '/admin');
    assert.equal(auth.homeUrl(), '/admin');
  }
});

test('regular login keeps personal return URLs and defaults safely to the dashboard', async () => {
  for (const [target, expected] of [
    [null, '/dashboard'],
    ['/groups/4', '/groups/4'],
    ['https://example.com', '/dashboard'],
    ['//example.com', '/dashboard'],
  ]) {
    returnUrl = target;
    const component = page('login');
    const priorRoutes = routes.length;
    await requestLoginCode(component);
    assert.equal(routes.length, priorRoutes);
    assert.equal(auth.user(), null);
    component.form.controls.otp.setValue('123456');
    const index = requests.length;
    const pending = component.submit();
    respond(index, { access_token: 'user-access', user });
    await pending;
    assert.equal(component.error(), '');
    assert.equal(routes.at(-1), expected);
  }
});

for (const role of ['ADMIN', 'USER'] as const) {
  test(`${role} direct routes are restricted to the correct application area`, async () => {
    await login(role);
    const shellRoute = appRoutes.find((item) => item.children)!;
    assert.ok(shellRoute.canActivate?.includes(authGuard));
    assert.ok(shellRoute.canActivateChild?.includes(authGuard));
    assert.ok(shellRoute.canActivateChild?.includes(appSectionGuard));
    for (const child of shellRoute.children!) {
      if (child.redirectTo) continue;
      const isAdminRoute = child.path === 'admin' || child.path?.startsWith('admin/');
      const snapshot = { data: child.data || {} } as ActivatedRouteSnapshot;
      const state = { url: '/' + child.path } as RouterStateSnapshot;
      const allowed = runInInjectionContext(injector, () => appSectionGuard(snapshot, state));
      const expected =
        role === 'ADMIN'
          ? isAdminRoute
            ? true
            : { commands: ['/admin'], extras: undefined }
          : isAdminRoute
            ? { commands: ['/forbidden'], extras: undefined }
            : true;
      assert.deepEqual(allowed, expected, `${role}: ${child.path}`);
      if (isAdminRoute) {
        assert.ok(child.canActivate?.includes(adminGuard));
        assert.deepEqual(
          runInInjectionContext(injector, () => adminGuard(snapshot, state)),
          role === 'ADMIN' ? true : { commands: ['/forbidden'], extras: undefined },
        );
      }
    }
  });
}

test('restored admin sessions redirect personal bookmarks to admin before rendering', async () => {
  storage.set(ACCESS_TOKEN_KEY, 'old-admin-access');
  const restoring = auth.restore();
  respond(0, { access_token: 'fresh-admin-access', user: { ...user, role: 'ADMIN' } });
  assert.equal(await restoring, true);
  const snapshot = { data: {} } as ActivatedRouteSnapshot;
  const state = { url: '/transactions/new' } as RouterStateSnapshot;
  assert.equal(
    runInInjectionContext(injector, () => authGuard(snapshot, state)),
    true,
  );
  assert.deepEqual(
    runInInjectionContext(injector, () => appSectionGuard(snapshot, state)),
    {
      commands: ['/admin'],
      extras: undefined,
    },
  );
  assert.equal(requests.length, 1);

  auth.clear();
  assert.deepEqual(
    runInInjectionContext(injector, () => authGuard(snapshot, state)),
    {
      commands: ['/auth/login'],
      extras: { queryParams: { returnUrl: state.url } },
    },
  );
});

test('admin shell exposes only admin links, skips personal settings, and can sign out', async () => {
  await login('ADMIN');
  const shell = runInInjectionContext(injector, () => new Shell());
  assert.deepEqual(
    shell.links().map((link) => link.path),
    ['/admin', '/admin/users', '/admin/users/pending'],
  );
  assert.equal(preferenceLoads, 0);
  const pending = shell.logout();
  respond(2);
  await pending;
  assert.equal(auth.user(), null);
  assert.equal(storage.has(ACCESS_TOKEN_KEY), false);
  assert.equal(routes.at(-1), '/auth/login');
});

test('regular shell retains personal navigation and loads preferences', async () => {
  await login();
  const shell = runInInjectionContext(injector, () => new Shell());
  assert.deepEqual(
    shell.links().map((link) => link.path),
    ['/dashboard', '/people', '/groups', '/activity', '/profile'],
  );
  assert.equal(preferenceLoads, 1);
  assert.equal(auth.homeUrl(), '/dashboard');
});

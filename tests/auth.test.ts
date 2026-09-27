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
  respond(index, { access_token: 'saved-access', user: { ...user, role } });
  await result;
}
function page(mode: string) {
  route.snapshot.data.mode = mode;
  return runInInjectionContext(injector, () => new AuthPage());
}

beforeEach(() => {
  storage.clear();
  requests = [];
  routes = [];
  returnUrl = null;
  preferenceLoads = 0;
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
afterEach(() => injector.destroy());

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

test('login saves access token and authorizes protected requests; logout clears storage', async () => {
  await login();
  assert.equal(requests[0].request.headers.get('X-Application-Type'), 'WEB');
  assert.equal(storage.get(ACCESS_TOKEN_KEY), 'saved-access');
  const data = firstValueFrom(dispatch('GET', environment.API_BASE_URL + '/contacts'));
  assert.equal(requests[1].request.headers.get('Authorization'), 'Bearer saved-access');
  assert.equal(requests[1].request.headers.get('X-Application-Type'), 'WEB');
  respond(1);
  await data;
  const logout = auth.logout();
  respond(2);
  await logout;
  assert.equal(storage.has(ACCESS_TOKEN_KEY), false);
  assert.equal(auth.token(), null);
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
  assert.equal(requests.length, 1);
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
    respond(index, mode === 'login' ? { access_token: 'saved-access', user } : null);
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
    respond(1);
    await result;
  } finally {
    environment.APPLICATION_TYPE = original;
  }
});

test('admin login opens the admin screen even with a saved personal return URL', async () => {
  for (const target of [null, '/dashboard', '/people/12', '/groups/4', '/profile']) {
    returnUrl = target;
    const component = page('login');
    component.form.patchValue({ email: user.email, password: 'Password123' });
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
    component.form.patchValue({ email: user.email, password: 'Password123' });
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
  respond(1);
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

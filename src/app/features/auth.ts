import { Component, inject, OnDestroy, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, errorMessage, Toast } from '../core/api';
import { Auth, LoginChallenge } from '../core/auth';
import { PasswordFieldComponent } from '../shared/password-field';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, PasswordFieldComponent],
  template: ` <div class="auth-page">
    <aside class="auth-story">
      <a class="brand" routerLink="/"><img src="/icon.svg" alt="" />SettleUply</a>
      <div>
        <span class="eyebrow">MONEY, WITHOUT THE AWKWARD.</span>
        <h1>Good friends.<br />Clear balances.</h1>
        <p>
          From a shared dinner to a helping hand.<br />A thoughtful space for the money in your
          life.
        </p>
        <div class="auth-art">
          <span>↗</span>
          <div>Less wondering.<br /><strong>More living.</strong></div>
          <span>↙</span>
        </div>
      </div>
      <small>Your records. Your space. Your peace of mind.</small>
    </aside>
    <main class="auth-main">
      <a class="mobile-brand" routerLink="/">SettleUply ✳</a>
      <section class="auth-card">
        @if (mode === 'pending') {
          <span class="success-icon">✓</span>
          <h1>You’re on the list.</h1>
          <p class="muted">
            Your email is verified. An administrator will review your registration before you can
            sign in.
          </p>
          <a class="button primary" routerLink="/auth/login">Back to sign in</a>
        } @else {
          <span class="eyebrow">YOUR PERSONAL MONEY SPACE</span>
          <h1>{{ title() }}</h1>
          <p class="muted">{{ subtitle() }}</p>
          <form [formGroup]="form" (ngSubmit)="submit()">
            @if (mode === 'register') {
              <label>Full name<input formControlName="name" autocomplete="name" required /></label>
            }
            @if (!loginChallenge()) {
              <label
                >Email address<input
                  type="email"
                  formControlName="email"
                  autocomplete="email"
                  required
                  placeholder="you@example.com"
              /></label>
            }
            @if (mode === 'verify' || mode === 'reset' || loginChallenge()) {
              <label
                >Verification code<input
                  formControlName="otp"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  maxlength="6"
                  placeholder="6-digit code"
              /></label>
            }
            @if (
              (mode === 'login' && !loginChallenge()) || mode === 'register' || mode === 'reset'
            ) {
              <app-password-field
                inputId="auth-password"
                [label]="mode === 'reset' ? 'New password' : 'Password'"
                [control]="form.controls.password"
                [autocomplete]="mode === 'login' ? 'current-password' : 'new-password'"
              />
              @if (mode !== 'login') {
                <small class="muted">10+ characters, uppercase, lowercase and a number.</small>
              }
            }
            @if (mode === 'register') {
              <label
                >Phone <span class="muted">(optional)</span
                ><input formControlName="phone" type="tel" autocomplete="tel"
              /></label>
            }
            @if (error()) {
              <p class="form-error" role="alert">{{ error() }}</p>
            } @else if (form.invalid && form.touched) {
              <p class="form-error" role="alert">{{ validationMessage() }}</p>
            }
            <button class="primary full" [disabled]="busy() || form.invalid">
              {{ busy() ? 'Please wait…' : button() }} <span>→</span>
            </button>
          </form>
          @if (loginChallenge()) {
            <div class="auth-links">
              <button type="button" class="text-button" (click)="backToLogin()">
                Change email or password
              </button>
              <button
                type="button"
                class="text-button"
                [disabled]="busy() || resendSeconds() > 0"
                (click)="resendLogin()"
              >
                {{ resendSeconds() > 0 ? 'Resend in ' + resendSeconds() + 's' : 'Send a new code' }}
              </button>
            </div>
          } @else if (mode === 'login') {
            <div class="auth-links">
              <a routerLink="/auth/forgot">Forgot password?</a
              ><a routerLink="/auth/verify">Verify email</a>
            </div>
            <p class="auth-switch">
              New here? <a routerLink="/auth/register">Create an account</a>
            </p>
          } @else {
            <p class="auth-switch"><a routerLink="/auth/login">Back to sign in</a></p>
          }
          @if (mode === 'verify') {
            <button
              type="button"
              class="text-button"
              [disabled]="busy() || form.controls.email.invalid"
              (click)="resend()"
            >
              Send a new code
            </button>
          }
        }
      </section>
    </main>
  </div>`,
})
export class AuthPage implements OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private api = inject(Api);
  private auth = inject(Auth);
  private toast = inject(Toast);
  private fb = inject(FormBuilder);
  mode = this.route.snapshot.data['mode'] as string;
  busy = signal(false);
  error = signal('');
  loginChallenge = signal<LoginChallenge | null>(null);
  resendSeconds = signal(0);
  private requestVersion = 0;
  private resendTimer: ReturnType<typeof setInterval> | null = null;
  form = this.fb.nonNullable.group({
    name: [''],
    email: [
      this.route.snapshot.queryParamMap.get('email') || '',
      [Validators.required, Validators.email],
    ],
    password: [''],
    otp: [''],
    phone: [''],
  });
  constructor() {
    const controls = this.form.controls;
    if (this.mode === 'register') {
      controls.name.setValidators([
        Validators.required,
        Validators.pattern(/\S/),
        Validators.maxLength(120),
      ]);
      controls.phone.setValidators(Validators.maxLength(30));
    }
    if (['login', 'register', 'reset'].includes(this.mode)) {
      controls.password.setValidators([
        Validators.required,
        Validators.pattern(/\S/),
        Validators.maxLength(128),
      ]);
      if (this.mode !== 'login') {
        controls.password.addValidators([
          Validators.minLength(10),
          Validators.pattern(/(?=[\s\S]*[a-z])(?=[\s\S]*[A-Z])(?=[\s\S]*\d)[\s\S]*/),
        ]);
      }
    }
    if (this.mode === 'verify' || this.mode === 'reset') {
      controls.otp.setValidators([Validators.required, Validators.pattern(/^\d{6}$/)]);
    }
    for (const control of Object.values(controls)) control.updateValueAndValidity();
  }

  protected validationMessage(): string {
    const controls = this.form.controls;
    if (controls.name.invalid) return 'Enter your full name (up to 120 characters).';
    if (controls.email.invalid) return 'Enter a valid email address.';
    if (controls.otp.invalid) return 'Enter the six-digit verification code.';
    if (controls.password.invalid) {
      return this.mode === 'login'
        ? 'Enter your password (up to 128 characters).'
        : 'Use a password of 10–128 characters with uppercase, lowercase and a number.';
    }
    return 'Please check the submitted fields.';
  }
  title() {
    if (this.loginChallenge()) return 'Check your inbox.';
    return (
      {
        login: 'Welcome back.',
        register: 'Make room for clarity.',
        verify: 'Check your inbox.',
        forgot: 'Let’s get you back in.',
        reset: 'A fresh start.',
      } as Record<string, string>
    )[this.mode];
  }
  subtitle() {
    if (this.loginChallenge()) {
      return `Enter the six-digit sign-in code sent to ${this.form.controls.email.value}.`;
    }
    return (
      {
        login: 'Enter your email and password. We’ll email you a code to finish signing in.',
        register: 'Create your account. Verify your email. Get approved.',
        verify: 'Enter the six-digit code sent to your email.',
        forgot: 'We’ll send a code to reset your password.',
        reset: 'Enter your reset code and a strong new password.',
      } as Record<string, string>
    )[this.mode];
  }
  button() {
    if (this.loginChallenge()) return 'Verify and sign in';
    return (
      {
        login: 'Send sign-in code',
        register: 'Create account',
        verify: 'Verify email',
        forgot: 'Send reset code',
        reset: 'Reset password',
      } as Record<string, string>
    )[this.mode];
  }
  async submit() {
    if (this.busy() || this.mode === 'pending') return;
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.error.set(this.validationMessage());
      return;
    }
    this.busy.set(true);
    this.error.set('');
    const version = this.requestVersion;
    const v = this.form.getRawValue();
    try {
      if (this.mode === 'login') {
        const challenge = this.loginChallenge();
        if (!challenge) {
          const next = await this.auth.login({ email: v.email, password: v.password });
          if (version !== this.requestVersion) return;
          // Keep the challenge only in memory and discard the password after the first step.
          this.form.controls.password.clearValidators();
          this.form.controls.password.reset('');
          this.form.controls.otp.setValidators([
            Validators.required,
            Validators.pattern(/^\d{6}$/),
          ]);
          this.form.controls.otp.reset('');
          this.form.markAsUntouched();
          this.loginChallenge.set(next);
          this.startResendCountdown(next.resend_after);
          return;
        }
        await this.auth.verifyLogin({ challenge_token: challenge.challenge_token, otp: v.otp });
        if (version !== this.requestVersion) return;
        this.loginChallenge.set(null);
        this.stopResendCountdown();
        const target = this.route.snapshot.queryParamMap.get('returnUrl');
        await this.router.navigateByUrl(
          this.auth.isAdmin()
            ? this.auth.homeUrl()
            : target?.startsWith('/') && !target.startsWith('//')
              ? target
              : this.auth.homeUrl(),
        );
      } else if (this.mode === 'register') {
        await this.api.send('POST', '/auth/register', {
          name: v.name,
          email: v.email,
          password: v.password,
          phone: v.phone || null,
        });
        await this.router.navigate(['/auth/verify'], { queryParams: { email: v.email } });
      } else if (this.mode === 'verify') {
        await this.api.send('POST', '/auth/verify-otp', { email: v.email, otp: v.otp });
        await this.router.navigateByUrl('/auth/pending');
      } else if (this.mode === 'forgot') {
        await this.api.send('POST', '/auth/forgot-password', { email: v.email });
        await this.router.navigate(['/auth/reset'], { queryParams: { email: v.email } });
      } else {
        await this.api.send('POST', '/auth/reset-password', {
          email: v.email,
          otp: v.otp,
          password: v.password,
        });
        this.toast.show('Password reset. Sign in with your new password.');
        await this.router.navigateByUrl('/auth/login');
      }
    } catch (error) {
      if (version === this.requestVersion) this.error.set(errorMessage(error));
    } finally {
      if (version === this.requestVersion) this.busy.set(false);
    }
  }
  backToLogin() {
    this.requestVersion++;
    this.auth.cancelLogin();
    this.loginChallenge.set(null);
    this.stopResendCountdown();
    this.error.set('');
    this.busy.set(false);
    this.form.controls.otp.clearValidators();
    this.form.controls.otp.reset('');
    this.form.controls.password.setValidators([
      Validators.required,
      Validators.pattern(/\S/),
      Validators.maxLength(128),
    ]);
    this.form.controls.password.reset('');
    this.form.markAsUntouched();
  }
  async resendLogin() {
    const challenge = this.loginChallenge();
    if (!challenge || this.busy() || this.resendSeconds() > 0) return;
    const version = this.requestVersion;
    this.busy.set(true);
    this.error.set('');
    try {
      const next = await this.auth.resendLogin(challenge.challenge_token);
      if (version !== this.requestVersion) return;
      this.loginChallenge.set(next);
      this.form.controls.otp.reset('');
      this.startResendCountdown(next.resend_after);
      this.toast.show('A new sign-in code was sent. Use the latest code in your inbox.');
    } catch (error) {
      if (version === this.requestVersion) {
        // A failed delivery can invalidate the old challenge on the server.
        if (error instanceof HttpErrorResponse && error.status === 503) this.backToLogin();
        this.error.set(errorMessage(error));
      }
    } finally {
      if (version === this.requestVersion) this.busy.set(false);
    }
  }
  private startResendCountdown(seconds: number) {
    this.stopResendCountdown();
    const deadline = Date.now() + seconds * 1000;
    this.resendSeconds.set(Math.max(0, Math.ceil(seconds)));
    if (seconds <= 0) return;
    this.resendTimer = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      this.resendSeconds.set(remaining);
      if (!remaining) this.stopResendCountdown();
    }, 1000);
  }
  private stopResendCountdown() {
    if (this.resendTimer !== null) clearInterval(this.resendTimer);
    this.resendTimer = null;
    this.resendSeconds.set(0);
  }
  ngOnDestroy() {
    this.requestVersion++;
    this.stopResendCountdown();
    if (this.mode === 'login') this.auth.cancelLogin();
    this.loginChallenge.set(null);
    this.form.controls.password.reset('');
  }
  async resend() {
    if (this.busy()) return;
    this.form.controls.email.markAsTouched();
    if (this.form.controls.email.invalid) {
      this.error.set('Enter a valid email address before requesting a new code.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.send('POST', '/auth/resend-otp', { email: this.form.controls.email.value });
      this.toast.show('If eligible, a new code will be sent.');
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}

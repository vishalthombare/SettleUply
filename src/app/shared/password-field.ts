import { Component, input, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

@Component({
  selector: 'app-password-field',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <label class="password-label" [for]="inputId()">{{ label() }}</label>
    <div class="password-input">
      <input
        class="password-value"
        [id]="inputId()"
        [type]="visible() ? 'text' : 'password'"
        [formControl]="control()"
        [autocomplete]="autocomplete()"
        autocapitalize="off"
        [spellcheck]="false"
        required
      />
      <button
        type="button"
        class="password-toggle"
        [attr.aria-label]="(visible() ? 'Hide ' : 'Show ') + label().toLowerCase()"
        [attr.aria-controls]="inputId()"
        [disabled]="control().disabled"
        (click)="visible.set(!visible())"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          @if (visible()) {
            <path d="m3 3 18 18" />
          }
        </svg>
        <span>{{ visible() ? 'Hide' : 'Show' }}</span>
      </button>
    </div>
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: 19px;
    }
    .password-label {
      margin-bottom: 8px;
    }
    .password-input {
      position: relative;
    }
    .password-input .password-value {
      margin-top: 0;
      padding-right: 100px;
      min-height: 48px;
    }
    .password-toggle {
      position: absolute;
      top: 50%;
      right: 4px;
      transform: translateY(-50%);
      width: 84px;
      min-height: 40px;
      padding: 8px;
      gap: 6px;
      border-radius: 5px;
      background: transparent;
      color: var(--green);
      font-size: 12px;
    }
    .password-toggle:not(:disabled):hover {
      background: #edf2e5;
    }
    .password-toggle:focus-visible {
      outline-offset: 0;
    }
    .password-toggle svg {
      flex-shrink: 0;
    }
  `,
})
export class PasswordFieldComponent {
  control = input.required<FormControl<string>>();
  inputId = input.required<string>();
  label = input('Password');
  autocomplete = input<'current-password' | 'new-password'>('current-password');
  protected visible = signal(false);
}

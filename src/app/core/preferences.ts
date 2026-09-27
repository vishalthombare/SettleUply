import { Injectable, inject, signal } from '@angular/core';
import { Api } from './api';
import { Settings } from './models';
@Injectable({ providedIn: 'root' })
export class Preferences {
  private api = inject(Api);
  timezone = signal(Intl.DateTimeFormat().resolvedOptions().timeZone);
  currency = signal('MYR');
  async load() {
    const settings = await this.api.get<Settings>('/settings');
    this.apply(settings);
    return settings;
  }
  apply(settings: Settings) {
    this.timezone.set(settings.timezone);
    this.currency.set(settings.default_currency);
  }
  today() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timezone(),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }
}

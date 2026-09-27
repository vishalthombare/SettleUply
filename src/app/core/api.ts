import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, map } from 'rxjs';
import { environment } from './environment';
import { Envelope, Page } from './models';

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);
  get<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
    let query = new HttpParams();
    for (const [key, value] of Object.entries(params))
      if (value !== null && value !== undefined && value !== '')
        query = query.set(key, String(value));
    return firstValueFrom(
      this.http
        .get<Envelope<T>>(environment.API_BASE_URL + path, { params: query, withCredentials: true })
        .pipe(map((r) => r.data)),
    );
  }
  send<T>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(
      this.http
        .request<Envelope<T>>(method, environment.API_BASE_URL + path, {
          body,
          withCredentials: true,
        })
        .pipe(map((r) => r.data)),
    );
  }
  async all<T>(path: string): Promise<T[]> {
    const first = await this.get<Page<T>>(path, { page_size: 100 });
    const result = [...first.items];
    for (let page = 2; page <= first.total_pages; page++)
      result.push(...(await this.get<Page<T>>(path, { page, page_size: 100 })).items);
    return result;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const fields = error.error?.errors as Record<string, string> | undefined;
    if (fields && Object.keys(fields).length) return Object.values(fields).join('. ');
    return (
      error.error?.message ||
      (error.status === 0
        ? 'Cannot connect. Check your connection and try again.'
        : 'Unable to complete this request.')
    );
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

@Injectable({ providedIn: 'root' })
export class Toast {
  message = signal('');
  show(message: string) {
    this.message.set(message);
    setTimeout(() => this.message.set(''), 4500);
  }
}
